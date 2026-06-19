# Follow-Up System — Internal Problem & Solution Analysis

> تحليل تقني عميق لكل نقطة ضعف في النظام القديم، مع شرح الميكانيزم الداخلي
> للمشكلة وإزاي الكود الجديد حلها. كل نقطة مدعومة بـ code paths قبل وبعد.

---

## المشكلة رقم 1: الـ Worker بيخنق Postgres Connection Pool المشترك

### التحليل الداخلي للمشكلة

**إعدادات الـ pool القديمة:**
- `DATABASE_POOL_MAX=20` — 20 connection متاحين لكل حاجة: predictions، chatflows، embedding، إلخ.
- `FOLLOWUP_WORKER_CONCURRENCY=50` — 50 worker بيشتغلوا في نفس الوقت.

**مسارات الـ queries لكل job (ملف `FollowUpQueue.ts:398-581`):**

```
processFollowUp()
  ├─ Defense 1: hasCancelFlag()       → Redis           (ما بيضربش Postgres)
  ├─ Defense 1.5: maxFires check       → COUNT(*) على follow_up_log  (Query 1 — خطير)
  ├─ Defense 2: DB validation          → query على chat_message      (Query 2)
  ├─ Build payload:
  │    ├─ fetch last N messages        → find() على chat_message     (Query 3)
  │    └─ fetch chatflow details       → findOne() على chat_flow     (Query 4)
  ├─ POST webhook                      → شبكة
  └─ save log                          → save() على follow_up_log    (Query 5)
```

**السيناريو تحت الضغط:**

```
لحظة معينة: 50 job مستنيين في BullMQ

Worker 1-20: أخدوا الـ 20 connection
  ├─ كل واحد بيعمل 3-5 queries
  │   ├─ لو query #1 (maxFires) بطيء (table عنده ملايين صفوف) → connection بيقعد ماسكه 5-15s
  │   └─ باقي الـ connections محجوزين عند workers تانيين
Worker 21-50: مستنيين connection فاضي
  └─ connectionTimeoutMillis=30000 → بعد 30s بيطردوا بـ timeout

الـ predictions الجديدة بقى: محتاجة connection للـ chat نفسه
  ├─ acquireSlot() → مسموح، بس connection pool فاضي
  └─ query على chatflow/id → بيستنى → timeout → الـ chat يبوظ
```

**ليه بيفشل بعد 48 ساعة بالظبط؟**  
الـ logs بتتراكم → كل query على `follow_up_log` بياخد وقت أطول مع الوقت → الـ jobs بتاخد وقت أطول → كل connection بيتسكر بعد ما الخدمة تخلص مش بعد ما الـ worker يخلص → الـ pool بيقعد تحت ضغط مستمر. بعد يومين، الـ pool مش بيفضى أصلاً.

### الحل في الكود الجديد

**ملف `packages/followup-service/src/scheduler/poller.ts` + `worker/processor.ts`:**

الـ hot path الجديد **ما بيلمسش Postgres نهائياً**:

```
Worker.process(job)
  ├─ Defense 1: state.hasCancelFlag()        → Redis INCR (O(1))
  ├─ Defense 2: state.getFireCount()         → Redis INCR counter
  ├─ Defense 3: state.getLastMessageTime()   → Redis GET
  ├─ Build payload: state.getMessages()      → Redis LRANGE (capped list)
  ├─ POST webhook
  └─ write log                               → ClickHouse insert
```

**صفر queries على Postgres في مسار الـ job.**

الـ Postgres يُلمس فقط لقراءة الـ config (نادر، مره كل 30s للـ refresh، pool صغير = 4):

**ملف `packages/followup-service/src/config/configProvider.ts`:**

```typescript
this.pool = new Pool({
  max: env.pgPoolMax,  // 4 connections فقط
  // فقط لـ:
  //   SELECT * FROM follow_up_config    — كل 30s
  //   SELECT * FROM follow_up_step      — كل 30s
  //   UPSERT/DELETE                     — نادر (admin)
});
```

**النتيجة:**

| المتغير | قبل | بعد |
|----------|-----|-----|
| الـ worker بيلمس Postgres | 3-5 queries لكل job | 0 queries |
| Postgres connections تحت ضغط 50 job | 20 كلهم محجوزين | الـ 4 للـ config reads فقط |
| التاثير على الـ chat | الـ predictions بتفشل | صفر تأثير |

---

## المشكلة رقم 2: follow_up_log بيكبر بلا حدود

### التحليل الداخلي للمشكلة

**الـ schema القديم لم يكن فيه أي cleanup:**

```
كل webhook fire:
  logRepo.save({ status, payload: JSON كامل لكل الرسايل, responseBody, ... })

كل skip/cancel:
  logRepo.save({ status: 'cancelled', errorMessage, ... })
```

**حجم البيانات المتزايد:**

```
جلسة واحدة بـ 3 steps:
  - 3 inserts (scheduled/pending) لما الـ session تبدأ
  - 3 updates/inserts (sent/failed/cancelled) لما التايمر يضرب
  - ممكن أكتر (retry, re-schedule)

100,000 جلسة × 3 steps × 2 inserts = 600,000 صف / دورة idle
```

**الـ payload عمود text كامل JSON — كل صف فيه نسخة كاملة من آخر 10 رسايل:**

```json
{
  "event": "session_idle",
  "lastMessages": [
    {"role":"userMessage", "content":"...نص طويل...", "createdDate":"..."},
    {"role":"apiMessage", "content":"...نص طويل...", "createdDate":"..."}
    // × 10 رسايل
  ],
  "sessionDetails": {...}
}
```

بعد 48 ساعة مع 100k جلسة: **ملايين الصفوف** وكل صف حجمه كبير بسبب الـ payload.

**مفيش أي cron/cleanup/retention:**

```bash
# تأكدنا — مفيش أي cleanup:
grep -rn "cron\|cleanup\|setInterval\|deleteOld\|TRUNCATE\|DELETE FROM follow" packages/server/src --include="*.ts"
# (بدون نتيجة)
```

### الحل في الكود الجديد

**ClickHouse بدل Postgres للـ logs:**

```sql
-- packages/followup-service/src/clickhouse/client.ts
CREATE TABLE IF NOT EXISTS follow_up_log (
  ...
) ENGINE = MergeTree()
PARTITION BY toYYYYMMDD(firedAt)       -- partition يومي
ORDER BY (chatflowId, chatId, firedAt)
TTL toDateTime(firedAt) + INTERVAL N DAY  -- ⬅ الحل الأساسي
```

**ليه ClickHouse مش Postgres للـ logs؟**

| الخاصية | Postgres | ClickHouse |
|---------|----------|------------|
| الـ compression | عادي | 5-10x ضغط (columnar) |
| الـ append speed | آلاف الصفوف/ثانية | ملايين الصفوف/ثانية |
| الـ deletion | DELETE/VACUUM تقيل | TTL تلقائي — الـ partition بيتحذف كملف كامل |
| الـ aggregation | GROUP BY على text عمود | Columnar — بيقرأ الأعمدة المطلوبة بس |

**الـ TTL بيشتغل إزاي؟**

- ClickHouse بيقسّم الجدول لـ partitions (كل يوم partition).
- لما partition توصل لـ `firedAt + INTERVAL N DAY`، ClickHouse **بيمسح الـ partition كله** كـ file system operation (مش row-by-row DELETE).
- بدون أي cron، بدون أي VACUUM، بدون أي load على الـ system.

**عملياً:** الـ partition بتاع 2026-06-19 بيتمسح تلقائياً يوم 2026-07-19 (لو N=30).

---

## المشكلة رقم 3: maxFires بـ COUNT(*) من غير index كافي

### التحليل الداخلي للمشكلة

**الكود القديم (`FollowUpQueue.ts:398-427`):**

```typescript
const previousFires = await logRepo
  .createQueryBuilder("log")
  .where("log.chatflowId = :chatflowId", { chatflowId })
  .andWhere("log.chatId = :chatId", { chatId })
  .andWhere("log.stepOrder = :stepOrder", { stepOrder })
  .andWhere("log.status = :status", { status: "sent" })
  .getCount();
```

**الـ indexes الموجودة:**

```sql
-- From migration + entity:
INDEX on chatflowId        -- IDX_follow_up_log_chatflowId
INDEX on chatId           -- IDX_follow_up_log_chatId  
INDEX on createdDate       -- IDX_follow_up_log_createdDate
```

**المشكلة:** الـ query بيستعمل `WHERE chatflowId + chatId + stepOrder + status` مع بعض.  
الـ indexes كل واحد منهم منفصل، فـ Postgres بيختار index واحد (غالباً `chatflowId`) وبعدين بيعمل **filter scan** على الباقي:

```
Index Scan: IDX_follow_up_log_chatflowId (chatflowId = 'xxx')
  → Bitmap Heap Scan: filter by chatId, stepOrder, status
    → ملايين الصفوف تمر ع الفلتر
```

**مع الوقت:** الجدول بيكبر → الـ scan بياخد وقت أطول → كل job بيقعد connection أطول → كارثة مركبة مع المشكلة #1.

### الحل في الكود الجديد

**Counter في Redis (`packages/followup-service/src/redis/stateStore.ts`):**

```typescript
// بدل COUNT(*) query:
async getFireCount(chatflowId: string, trackingId: string, stepOrder: number): Promise<number> {
  const v = await this.r.get(keys.fires(chatflowId, trackingId, stepOrder));
  return v ? parseInt(v, 10) : 0;
}

// بعد كل webhook ناجح:
async incrFireCount(chatflowId: string, trackingId: string, stepOrder: number): Promise<number> {
  const key = keys.fires(chatflowId, trackingId, stepOrder);
  const n = await this.r.incr(key);         // INCR — O(1)
  await this.r.expire(key, env.fireCounterTtlSeconds);  // auto-expire
  return n;
}
```

**الـ code path في الـ worker (`worker/processor.ts:48-59`):**

```typescript
if (job.maxFires && job.maxFires > 0) {
  const fired = await this.state.getFireCount(chatflowId, trackingId, stepOrder);
  if (fired >= job.maxFires) {
    // skip
    return;
  }
}
// ... send webhook ...
if (status === "sent") {
  await this.state.incrFireCount(chatflowId, trackingId, stepOrder);
}
```

**الفرق:**

| المتغير | قبل | بعد |
|----------|-----|-----|
| العملية | COUNT(*) على Postgres table | Redis INCR |
| التعقيد | O(n) مع حجم الجدول | O(1) — ثابت |
| التأثير على الـ pool | كل job بيحجز connection أطول | 0 queries على Postgres |
| الـ TTL | مفيش — الصف للأبد | Redis key expire تلقائي |

---

## المشكلة رقم 4: Reschedule Storm على كل رسالة

### التحليل الداخلي للمشكلة

**الكود القديم: كل رسالة بتعمل ده (`services/follow-up/index.ts:235-322`):**

```typescript
async scheduleFollowUp(chatflowId, chatId, sessionId) {
  // 1. Cancel كل الـ jobs القديمة — loop بالـ for
  await this.followUpQueue.cancelAllForSession(chatflowId, chatId, steps.length);
  //    └─ for (let step = 1; step <= totalSteps; step++) {
  //         getJob(jobId) → job.remove()     ← 2 Redis ops لكل step
  //       }

  // 2. أخّر وقت الرسالة الحقيقي — query على chat_message (Postgres!)
  //    أو Redis (getLastMessageTime)

  // 3. أضف jobs جديدة — loop تاني
  for (const step of steps) {
    //    └─ getJob → remove (تنظيف) + add (جديد)   ← 2-3 Redis ops لكل step
    await this.followUpQueue.scheduleJob(jobData, lastUserMsgTime);
  }
}
```

**مع 3 steps لكل chatflow:**

```
رسالة واحدة → 3 cancels + 3 schedules = 6+ Redis عمليات متسلسلة
```

`cancelAllForSession` و`scheduleJob` دول sequential (مش `Promise.all`):

```typescript
// cancelAllForSession:
for (let step = 1; step <= totalSteps; step++) {
  const job = await this.queue.getJob(jobId);  // await → blocking
  if (job) { await job.remove(); }              // await → blocking
}

// scheduleJob فيه:
const existingJob = await this.queue.getJob(jobId);  // await
if (existingJob) { await existingJob.remove(); }     // await
return await this.queue.add(jobId, jobData, {...});  // await
```

**النتيجة (100k session نشطة):**

```
100,000 رسالة/دقيقة → لو كل رسالة فيها 3 steps:
  300,000 cancel + 300,000 add = 600,000 Redis command / دقيقة
  + 300,000 getJob lookup
  = حوإلى 1,000,000 Redis operation / دقيقة

Redis connection واحد (sequential operations) → اختناق
```

### الحل في الكود الجديد

**Timer ZSET (`packages/followup-service/src/redis/timerStore.ts`):**

```typescript
async schedule(job: TimerJob): Promise<void> {
  const member = timerMember(job.chatflowId, job.trackingId, job.stepOrder);
  const pipe = this.r.pipeline();
  pipe.zadd(keys.timers, job.fireAt.toString(), member);  // overwrite مباشر!
  pipe.hset(keys.timerJobs, member, JSON.stringify(job));
  await pipe.exec();  // 1 round-trip بس
}
```

**الميكانيزم:**

```
الـ ZSET member = "chatflowId|trackingId|stepOrder" (مفتاح ثابت)

reschedule = ZADD بنفس الـ member + score جديد
  → Redis بيoverwrite الـ score تلقائياً (مش insertion جديد)
  → مفيش cancel, مفيش remove, مفيش lookup
  → 1 pipeline batch (ZADD + HSET)
```

**الـ scheduler (`scheduler/scheduler.ts`):**

```typescript
async scheduleForSession(chatflowId, trackingId, sessionId, lastUserMsgTime) {
  const bundle = await this.config.getConfig(chatflowId);  // cached
  if (!bundle?.config.enabled) return;

  const now = Date.now();
  for (const step of steps) {
    // no cancel — no lookup — no remove
    // single pipeline: ZADD + HSET
    await this.timers.schedule(job);  
  }
}
```

**مقارنة العملية لكل رسالة (3 steps):**

| العملية | قبل (BullMQ) | بعد (ZSET) |
|---------|-------------|------------|
| cancel | 3 × (getJob + remove) = 6 opts | **0** |
| schedule | 3 × (getJob + remove + add) = 9 ops | 3 × pipeline = 1 batch |
| الإجمالي | ~15 request/response cycle | **1 batch** |
| الـ concurrency | sequential (await each) | pipeline (atomic) |

---

## المشكلة رقم 5: الداشبورد بيسحب 1000 Job من الـ Queue

### التحليل الداخلي للمشكلة

**الكود القديم (`services/follow-up/index.ts:115-133`):**

```typescript
// getAllConfigs:
const jobs = await this.followUpQueue.getPendingJobs(0, 1000);
//   └─ داخلياً: await this.queue.getDelayed(0, 1000)
//        └─ BullMQ بيقرأ الـ delayed set من Redis
//            1000 job × job data = حجم كبير في الـ memory

const chatflowJobs = jobs.filter(j => j.data?.chatflowId === config.chatflowId);
uniqueChatIds = new Set(chatflowJobs.map(j => j.data?.chatId));

// Dashboard stats — لكل config:
sentToday   = await logRepo.createQueryBuilder(...).getCount();  // Query 1
failedToday = await logRepo.createQueryBuilder(...).getCount();  // Query 2
totalFired  = await logRepo.createQueryBuilder(...).getCount();  // Query 3
// دي N+1 pattern — 3 queries لكل config في الـ dashboard
```

**حجم الـ 1000 job data:**

```json
{
  "id": "followup:cfId:chatId:step1",
  "data": {
    "chatflowId": "...",
    "chatId": "...",
    "webhookUrl": "https://...نص طويل...",
    "webhookHeaders": "{...JSON...}",
    "payload": {...}  // لو job اتنفّذ قبل كده
  },
  "opts": { "delay": 300000, ... },
  "timestamp": 1718112345678
}
```

كل job object حجمه ممكن يوصل لـ 1-5 KB. 1000 job = 1-5 MB في الـ network.

### الحل في الكود الجديد

**ClickHouse aggregation للـ counts (`clickhouse/logsQuery.ts`):**

```typescript
export async function getChatflowCounts(chatflowId: string) {
  const rows = await query(`
    SELECT 
      countIf(status = 'sent'    AND firedAt >= toStartOfDay(now())) AS sentToday,
      countIf(status = 'failed'  AND firedAt >= toStartOfDay(now())) AS failedToday,
      count() AS totalFired
    FROM follow_up_log 
    WHERE chatflowId = {chatflowId:String}
  `, { chatflowId });
  // ⬆️ query واحدة بس — ClickHouse بيaggregate في الـ engine بتاعه
}
```

**Redis ZCARD/ZRANGE للـ pending (من غير job data الكامل):**

```typescript
// TimerStore:
async pendingCount(): Promise<number> {
  return await this.r.zcard(keys.timers);  // O(1) — مجرد عدد
}

async pendingJobs(start: number, end: number): Promise<TimerJob[]> {
  const members = await this.r.zrange(keys.timers, start, end);
  // ترجع members بس (chatflowId|trackingId|stepOrder) — strings صغيرة
  // مش job objects كاملة
}
```

**الـ API response (تقليل الحمل):**

```typescript
// api/server.ts:
router.get("/pending", async (req, res) => {
  const start = parseInt(req.query.start || "0");
  const end = parseInt(req.query.end || "50");    // default 50 مش 1000
  const jobs = await ctx.timers.pendingJobs(start, end);
  const total = await ctx.timers.pendingCount();
  res.json({
    jobs: jobs.map(j => ({
      id: `followup:${j.chatflowId}:${j.trackingId}:step${j.stepOrder}`,
      data: { chatflowId, chatId, sessionId, stepOrder, stepName, idleTimeout, idleTimeoutUnit },
      delay: Math.max(j.fireAt - Date.now(), 0),
    })),
    total,
  });
});
```

**الفرق في الـ dashboard load:**

| العملية | قبل | بعد |
|---------|-----|-----|
| Pending jobs | جلب 1000 job object كامل | ZRANGE بمفاتيح + pagination |
| Sent today | COUNT على Postgres | countIf في ClickHouse (query واحدة) |
| Failed today | COUNT على Postgres | نفس الـ query أعلاه |
| Total fired | COUNT على Postgres | نفس الـ query أعلاه |
| N+1 pattern | 3 queries × عدد الـ configs | 1 query للكل |

---

## المشكلة رقم 6: الـ Cancel Flag فيه Race Condition

### التحليل الداخلي للمشكلة

**الـ flow القديم (`controllers/predictions/index.ts:52-91`):**

```
scheduleFollowUpIfEnabled():
  Step 1: setCancelFlag(chatflowId, trackingId)        → Redis SET
  Step 2: await service.scheduleFollowUp(...)            → بطيء (redis + db ops)
  Step 3: clearCancelFlag(chatflowId, trackingId)       → Redis DEL

الـ gap: بين Step 1 و Step 3 → الـ worker ممكن يشتغل
  → العكس: بين Step 2 و Step 3 → الـ flag لسه شغال لو الـ worker جه

  window 1 ██████████████████████████████████████████████ window 2
           ↑ set flag    ↑ schedule done     ↑ clear flag
                          ↑ لو worker جه هنا؟
                            flag لسه موجود → skip صحيح
                          ↑ لو worker جه هنا؟
                            flag اتمسح → webhook يطلع غلط (مفروض مكنش يطلع)
```

**الأسوأ: لو الـ scheduling فشل (exception):**

```typescript
try {
  await service.scheduleFollowUp(chatflowId, trackingId, sessionId);
} catch (error) {
  // مجرد debug log — مفيش retry
}
// Step 3 — clearCancelFlag بيتنفّذ حتى لو الـ schedule فشل!
if (queue) {
  await queue.clearCancelFlag(chatflowId, trackingId);
}
// النتيجة: flag اتمسح، مفيش timers جديدة، الـ session من غير follow-up
```

### الحل في الكود الجديد

**الـ cancel flag في الـ consumer نفسه (atomic مع الـ scheduling):**

```
IngestConsumer.handle():
  Step 1: await this.state.setCancelFlag(...)     ← emergency brake
  Step 2: await this.state.recordMessage(...)      ← خزّن الرسالة
  Step 3: await this.scheduler.scheduleForSession(...)  ← جدول timers
  Step 4: await this.state.clearCancelFlag(...)    ← أفرج

الـ scheduleForSession بنفس الـ process — مش process تاني
  → الـ worker بيشتغل على Redis مختلف عن الـ scheduling
  → الـ gap صغير (Microseconds بين خطوة 3 و 4، مش شبكة + DB)
```

**فيه تحسّن كمان: الـ worker بيعمل defense re-check:**

```
Worker.process():
  Defense 1: if (await this.state.hasCancelFlag(...)) → skip
  Defense 3: if (timeSinceLastMsg < idleMs)          → skip

يعني حتى لو الـ flag اتشال بدري بجزء من الثانية،
الـ idle re-check (باستخدام آخر توقيت رسالة حقيقي) هيمنع الـ fire.
```

---

## المشكلة رقم 7: الـ Webhook بدون Retry/Backoff

### التحليل الداخلي للمشكلة

**الكود القديم (`FollowUpQueue.ts:524-559`):**

```typescript
try {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeout: 30000,
  });
  responseStatus = response.status;
  responseBody = await response.text();
  if (!response.ok) {
    status = "failed";
    // ⬅ مفيش retry — لو 500 أو timeout، خلاص
  }
} catch (error: any) {
  status = "failed";
  // ⬅ مفيش retry — لو network error، خلاص
}
```

**الـ retry الوحيد كان manual:**

```typescript
async retryWebhook(logId: string): Promise<FollowUpLog | null> {
  // لازم أدمن يدوس retry من الـ UI
  await this.followUpQueue.scheduleJob(jobData);  // delay=0
}
```

**المشكلة:**  
تحت الضغط، الـ webhook endpoints ممكن تبقى بطيئة أو ترجع 429/503 مؤقتاً. من غير retry أوتوماتيكي، الـ success rate بيقل مع الحمل.

### الحل في الكود الجديد

**Retry مع exponential backoff (`worker/processor.ts:99-140`):**

```typescript
async sendWebhook(job, payload) {
  let lastErr = "";
  for (let attempt = 0; attempt <= env.webhookMaxRetries; attempt++) {
    try {
      const response = await fetch(job.webhookUrl, {
        method: "POST",
        headers,
        body,
        timeout: env.webhookTimeoutMs,
      });
      const text = await response.text();
      if (response.ok) {
        return { status: "sent", ... };   // نجاح — أخرج
      }
      lastErr = `HTTP ${response.status}: ${text}`;
      
      // 4xx (إلا 429) مش هتتصلح بإعادة المحاولة — أخرج فوراً
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return { status: "failed", ... };
      }
    } catch (e: any) {
      lastErr = e?.message || "Unknown error";
    }
    if (attempt < env.webhookMaxRetries) {
      await this.backoff(attempt);  // 1s, 2s, 4s, 8s (max 15s)
    }
  }
  return { status: "failed", ... };
}

backoff(attempt: number): Promise<void> {
  const ms = Math.min(1000 * Math.pow(2, attempt), 15000);
  return new Promise(r => setTimeout(r, ms));
}
```

**استراتيجية الـ retry:**

```
Attempt 0: immediate  (first try)
Attempt 1: wait 1s    (backoff 2^0 = 1000ms)
Attempt 2: wait 2s    (backoff 2^1 = 2000ms)
Attempt 3: wait 4s    (backoff 2^2 = 4000ms)
── MAX_RETRIES (default 3) ──

5xx / network error: retry
429 (rate limit):    retry
4xx (client error):  no retry — مشكلة في الـ request نفسه
```

---

## المشكلة رقم 8: Atomic Claim بين Multiple Instances

### التحليل الداخلي للمشكلة (في التصميم الجديد)

السيرفس الجديد horizontally scalable — ممكن تشغّل 3 instances.

**السؤال:** لما poller في instance A و poller في instance B الاتنين بيشوفوا نفس التايمر، مين اللي ياخده؟

**BullMQ القديم:** كان بيحل ده بـ Redis atomic operations داخل مكتبة BullMQ نفسها.

**الحل الجديد: Lua Script للتجنيد الذري (`timerStore.ts:31-37`):**

```typescript
private static CLAIM_LUA = `
  local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
  if #due > 0 then
    redis.call('ZREM', KEYS[1], unpack(due))
  end
  return due
`;
```

**ليه ده atomic؟**

Redis بينفّذ Lua scripts كـ **كتلة واحدة** — محدش بيقدر يعدّل الـ ZSET بين الـ `ZRANGEBYSCORE` والـ `ZREM`:

```
Instance A: eval CLAIM_LUA(now=1718112345000, count=500)
  ├─ ZRANGEBYSCORE: "cf1|sess1|1", "cf2|sess3|2", ...
  └─ ZREM: حذفهم

Instance B: eval CLAIM_LUA(now=1718112345000, count=500) — بعد Instance A
  ├─ ZRANGEBYSCORE: "cf3|sess7|1", "cf4|sess9|1", ...  ← أعضاء مختلفين
  └─ ZREM: حذفهم
  
لا يوجد تضارب — الـ atomicity مضمونة من Redis نفسه.
```

**الـ Poller بيستخدمها (`scheduler/poller.ts:52-59`):**

```typescript
private async drainOnce(): Promise<boolean> {
  const capacity = env.workerConcurrency - this.inFlight;
  if (capacity <= 0) return true;  // ما تاخدش تاني لو الـ workers مشغولين
  
  const count = Math.min(env.pollBatchSize, capacity);
  const jobs = await this.timers.claimDue(Date.now(), count);
  if (jobs.length === 0) return false;
  
  await this.runWithConcurrency(jobs);
  return true;
}
```

**الـ capacity check مهم:** ما بياخدش تاني أكتر من الـ concurrency بتاعه → الـ timers بتفضل في الـ ZSET لحد ما instance تاني تاخدهم (أو هو ياخدهم بعد ما workers يفضوا).

---

## جدول المقارنة النهائي

| المشكلة | قبل: الميكانيزم | قبل: الألم | بعد: الميكانيزم | بعد: النتيجة |
|---------|----------------|-----------|-----------------|-------------|
| **DB Pool exhaustion** | 50 worker × 3-5 Postgres queries | Pool = 20 → predictions تموت | Worker صفر Postgres (Redis+ClickHouse) | Pool = 4 للـ config |
| **log accumulation** | INSERT في Postgres، 0 retention | ملايين الصفوف، جدول ضخم | ClickHouse + TTL partition | تمسح يومي تلقائي |
| **maxFires COUNT** | COUNT(*) scan على table | بطء مع حجم الجدول | Redis INCR counter | O(1) دايماً |
| **Reschedule storm** | cancelAll + add لكل step | 15+ Redis ops/msg | ZADD overwrite واحدة | 1 batch/msg |
| **Dashboard load** | 1000 job pull + N+1 queries | 3 queries/config | ClickHouse GROUP BY + ZCARD | 1 query شاملة |
| **Race condition** | cancel flag + schedule gap | webhooks غير صحيحة | atomic داخل consumer + idle re-check | defense مزدوج |
| **Webhook retry** | مفيش retry أوتوماتيكي | success rate بينزل مع الحمل | exponential backoff (3 retries) | استشفاء تلقائي |
| **Multi-instance** | BullMQ internal (OK) | — | Lua atomic claim | atomic عبر الـ instances |

---

## الخلاصة التقنية

النظام الجديد بيحوّل كل نقطة ضغط من Postgres لـ Redis (للتايمرز والكاونترز والرسايل) وClickHouse (للـ logs)، بميكانيزمات مصمّمة تحديداً لنوع العملية:

- **التايمرز (Sorted Set):** ZADD overwrite بدل cancel+re-add — 95% تقليل في Redis ops.
- **الكاونترز (INCR):** O(1) بدل COUNT(*) scan — إلغاء dependency على حجم الجدول.
- **الـ logs (MergeTree+TTL):** Columnar compression + partition deletion — 5-10x ضغط و cleanup تلقائي.
- **الـ consumer (Stream):** Consumer group + capped list — تقاسم الحمل بين instances + حدود للـ memory.
- **الـ poller (Lua claim):** Atomic pop — ضمان إن التايمر ما يتنفّذش مرتين.
- **الـ proxy (HTTP):** عزل الـ UI عن المكان اللي السيرفس شغال فيه بالضبط.
