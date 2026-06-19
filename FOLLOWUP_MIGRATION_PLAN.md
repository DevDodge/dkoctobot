# خطة ترحيل نظام الـ Follow-Up إلى Microservice مستقل

> وثيقة مرجعية توضّح كل التعديلات: الوضع **قبل**، الوضع **بعد**، وإيه اللي
> **هيحصل** عند التشغيل. آخر تحديث بناءً على الكود المنفّذ فعلياً.

---

## 1. المشكلة (ليه عملنا ده أصلاً)

نظام الـ Follow-Up القديم انهار بعد ~٤٨ ساعة تحت ضغط عالٍ (هدفنا 100k+ جلسة/عداد
في نفس الوقت). السبب مش المنطق — السبب إن الـ worker كان بيضرب **Postgres المشترك**
اللي شغّال عليه مشاريع كتير، والـ logs بتتراكم بلا حدود.

نقاط الضعف اللي اتشخّصت في النظام القديم:

| # | المشكلة | الأثر تحت الضغط |
|---|---------|------------------|
| 1 | كل job بيعمل 3–5 queries على Postgres، و50 worker بيتزاحموا على pool فيه 20 connection بس (نفس الـ pool بتاع الـ predictions) | الـ chat نفسه بيفشل لما الـ pool يتخنق |
| 2 | جدول `follow_up_log` بيكبر بلا تنظيف (مفيش retention) | ملايين الصفوف بـ JSON كامل → بطء |
| 3 | `maxFires` بيتعمل بـ `COUNT(*)` من غير composite index | scan بيتقل مع كل job |
| 4 | reschedule على كل رسالة = `cancelAll` + إعادة إضافة لكل step | Redis command storm |
| 5 | الداشبورد بيسحب 1000 job من Redis + N+1 queries | حِمل إضافي |

---

## 2. القرار المعماري

فصل الـ Follow-Up في **microservice مستقل** داخل نفس الـ monorepo، بمخازنه الخاصة:

- **الـ Logs → ClickHouse** (مبني للـ append الضخم + ضغط + TTL تلقائي + aggregation سريع).
- **التايمرز/الكاونترز/الحالة → Redis مخصص منفصل** (مش Redis بتاع Flowise).
- **Postgres المشترك ما يتلمسش من الـ hot path نهائياً.**

---

## 3. المعمار: قبل وبعد

### قبل (in-process داخل packages/server)

```
رسالة جديدة → predictions controller
   └─ scheduleFollowUpIfEnabled()
        ├─ set cancel flag (Redis مشترك)
        ├─ FollowUpService.scheduleFollowUp()
        │     ├─ query Postgres (chat_message) لآخر رسالة
        │     └─ BullMQ: cancelAll + add delayed job لكل step
        └─ clear cancel flag

BullMQ Worker (نفس بروسيس السيرفر، concurrency=50)
   └─ كل job:
        ├─ COUNT على follow_up_log (maxFires)         ← Postgres
        ├─ query chat_message (idle check)            ← Postgres
        ├─ fetch آخر N رسالة + chatflow                ← Postgres
        ├─ POST webhook
        └─ INSERT في follow_up_log                     ← Postgres
```

كل ده على **نفس بروسيس السيرفر** و**نفس Postgres المشترك**.

### بعد (microservice مستقل)

```
رسالة جديدة → predictions controller
   └─ publishFollowUpEvent()  → XADD على Redis Stream (المخصص)
        { chatflowId, chatId, sessionId, role, content, ts }
        (فاير-آند-فورجِت، صفر Postgres، صفر BullMQ)

══════════ packages/followup-service (بروسيس/كونتينر منفصل) ══════════

IngestConsumer (consumer group على الـ Stream)
   └─ لكل event:
        ├─ set cancel flag                            ← Redis مخصص
        ├─ خزّن الرسالة (capped list + TTL)            ← Redis مخصص
        └─ Scheduler: ZADD واحدة لكل step              ← Redis مخصص
                       (score = fireAt) — مفيش cancel+re-add

Poller (كل ثانية) → claimDue() عبر Lua (atomic, multi-instance safe)
   └─ يوزّع على Worker pool (concurrency محدود)

Worker:
   ├─ Defense 1: cancel flag                          ← Redis
   ├─ Defense 2: maxFires عبر INCR counter (مش COUNT)  ← Redis
   ├─ Defense 3: true-idle من آخر رسالة مخزّنة         ← Redis
   ├─ يبني الـ payload من الرسائل المخزّنة             ← Redis
   ├─ POST webhook (timeout + retry/backoff)
   └─ INSERT في ClickHouse                             ← ClickHouse

HTTP API (نفس الـ 15 endpoint بالظبط) → يقرأ من ClickHouse + Redis

Postgres المشترك: يُلمس فقط للـ config CRUD النادر (pool صغير = 4)
```

### إزاي كل نقطة ضعف اتحلّت

| نقطة الضعف القديمة | الحل الجديد |
|---------------------|-------------|
| (1) الـ worker بيخنق Postgres pool | الـ worker بيلمس Redis + ClickHouse بس → **صفر Postgres في الـ hot path** |
| (2) logs بتتراكم | ClickHouse `TTL firedAt + INTERVAL N DAY` بيمسح القديم تلقائياً |
| (3) maxFires COUNT بطيء | بقى `INCR` counter في Redis — O(1) من غير scan |
| (4) reschedule storm | reschedule = `ZADD` واحدة (overwrite للـ score) |
| (5) داشبورد تقيل | `GROUP BY` على ClickHouse + `ZCARD` على Redis |

---

## 4. الملفات المُعدّلة والمُضافة

### ملفات جديدة (packages/followup-service/)

| الملف | الوظيفة |
|-------|---------|
| `package.json`, `tsconfig.json` | الباكدج المستقل (pnpm workspace) |
| `Dockerfile` | بناء صورة دوكر للسيرفس |
| `src/index.ts` | Bootstrap: يربط Redis + ClickHouse + يشغّل consumer/poller/API |
| `src/config/env.ts` | قراءة الـ env vars (Redis/ClickHouse/Postgres/tuning) |
| `src/config/configProvider.ts` | يقرأ Config+Steps من Postgres (pool صغير = 4)، cached |
| `src/config/configAdmin.ts` | CRUD للـ config (upsert/delete) — يكتب Postgres نادراً |
| `src/redis/client.ts` | اتصال بـ Redis المخصص (منفصل عن Flowise Redis) |
| `src/redis/keys.ts` | key builders مركزية |
| `src/redis/stateStore.ts` | msg cache + lastMsg + cancel flags + maxFires counters |
| `src/redis/timerStore.ts` | ZSET timers + atomic claim (Lua script) |
| `src/clickhouse/client.ts` | اتصال ClickHouse + schema bootstrap |
| `src/clickhouse/logsQuery.ts` | queries للداشبورد (grouped/stats/filters) |
| `src/ingest/consumer.ts` | يقرأ Stream events → يخزّن msg → يجدول timers |
| `src/scheduler/scheduler.ts` | منطق الجدولة (reschedule = ZADD واحدة) |
| `src/scheduler/poller.ts` | يطلع due timers من ZSET ويوزّعهم على الـ worker |
| `src/worker/processor.ts` | defenses + webhook send + retry + ClickHouse insert |
| `src/api/server.ts` | الـ 15 endpoint بالظبط (نفس الـ contract) |
| `src/domain/types.ts` | الأنواع المشتركة (Config/Step/Log/TimerJob) |
| `src/utils/logger.ts` | logger بسيط |
| `.env.example` | مثال للـ env variables |

### ملفات مُعدّلة (packages/server/)

#### `src/controllers/predictions/index.ts`

**قبل:** كان بينده `scheduleFollowUpIfEnabled()` اللي بتستدعي `FollowUpService` مباشرة (in-process).

**بعد:** 
- أضفنا import للـ `publishFollowUpEvent` من `utils/followUpPublisher.ts`.
- أضفنا flag `FOLLOWUP_LEGACY` (env var).
- عدّلنا `scheduleFollowUpIfEnabled` بحيث:
  - **الـ path الجديد (default):** `publishFollowUpEvent()` → XADD على Stream (فاير-آند-فورجِت).
  - **الـ legacy path:** لو `FOLLOWUP_LEGACY=true`، ينفّذ الكود القديم.
- أضفنا parameter `question` عشان نبعت محتوى الرسالة في الـ event.

**الأثر:** الآن predictions بتنشر event خفيف → السيرفس المستقل هو اللي بيتعامل معاه. صفر Postgres/BullMQ في request path.

#### `src/index.ts`

**قبل:** كان دايماً بيشغّل in-process `FollowUpQueue` و`FollowUpService` لو Redis موجود.

**بعد:** 
- عدّلنا الشرط بحيث الـ in-process worker يشتغل **فقط** لو `FOLLOWUP_LEGACY=true`.
- في الوضع الجديد (default)، السيرفر **ما بيشغّلش** worker ولا queue — بيبعت events بس.

**الأثر:** السيرفر يبقى أخف، ما فيش 50 worker بياكلوا الـ DB pool.

#### `src/routes/follow-up/index.ts`

**قبل:** كان بيمرر كل الـ requests للـ `followUpController` (in-process).

**بعد:**
- في الوضع الجديد: **proxy شامل** → كل request يتعاد توجيهه للـ `FOLLOWUP_SERVICE_URL` (default `http://localhost:3100`).
- في الـ legacy mode: يستعمل الـ controller القديم.
- الـ proxy بيحافظ على نفس الـ API contract (method/path/query/body).

**الأثر:** الـ UI مش محتاجة أي تعديل — بتكلّم نفس الـ `/followup` endpoints.

#### `src/utils/followUpPublisher.ts` (جديد)

- اتصال Redis منفصل (يستعمل `FOLLOWUP_REDIS_*` env أو يرجع للـ Redis الأساسي).
- `publishFollowUpEvent()` → XADD على Stream مع capped maxlen.
- Fire-and-forget، مش بيرمي exceptions في request path.

### ملفات دوكر

#### `docker/docker-compose-followup.yml` (جديد)

Stack مستقل فيه:
- `redis-followup` (port 6380) → dedicated Redis للسيرفس.
- `clickhouse` (ports 8123/9000) → log store.
- `followup-service` (port 3100) → السيرفس نفسه.

**الاستخدام:**
```bash
docker compose -f docker/docker-compose-followup.yml up -d
```

#### `packages/followup-service/Dockerfile`

- Base: `node:20-alpine`
- يعمل install + build للباكدج لوحده.
- CMD: `node dist/index.js`

---

## 5. متغيرات البيئة (Environment Variables)

### للسيرفس الجديد (packages/followup-service)

```bash
# HTTP API
FOLLOWUP_SERVICE_PORT=3100

# Dedicated Redis
FOLLOWUP_REDIS_HOST=localhost
FOLLOWUP_REDIS_PORT=6380
# أو:
# FOLLOWUP_REDIS_URL=redis://user:pass@host:port

# ClickHouse
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DB=followup
CLICKHOUSE_LOG_RETENTION_DAYS=30  # TTL تلقائي

# Postgres (config فقط — pool صغير)
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=
DATABASE_NAME=flowise
DATABASE_SSL=false
FOLLOWUP_PG_POOL_MAX=4

# Tuning
FOLLOWUP_WORKER_CONCURRENCY=50
FOLLOWUP_POLL_INTERVAL_MS=1000
FOLLOWUP_POLL_BATCH_SIZE=500
FOLLOWUP_WEBHOOK_TIMEOUT_MS=30000
FOLLOWUP_WEBHOOK_MAX_RETRIES=3
```

### للسيرفر الأساسي (packages/server)

```bash
# التحكم في المسار
FOLLOWUP_LEGACY=false  # default؛ اتركه false للمسار الجديد

# للمسار الجديد (proxy + event publish)
FOLLOWUP_SERVICE_URL=http://localhost:3100
FOLLOWUP_REDIS_HOST=localhost  # Redis المخصص
FOLLOWUP_REDIS_PORT=6380
# أو:
# FOLLOWUP_REDIS_URL=redis://...

FOLLOWUP_EVENTS_STREAM=followup:events
```

---

## 6. خطوات التشغيل

### السيناريو 1: تشغيل محلّي (للتطوير/الاختبار)

**الخطوة 1: تثبيت الـ dependencies**

```bash
cd /path/to/dkoctobot
pnpm install
```

**الخطوة 2: شغّل الـ stack (Redis + ClickHouse + السيرفس)**

```bash
docker compose -f docker/docker-compose-followup.yml up -d
```

ده هيشغّل:
- `redis-followup` على `localhost:6380`
- `clickhouse` على `localhost:8123`
- `followup-service` على `localhost:3100`

**الخطوة 3: اضبط env vars للسيرفر الأساسي**

في `.env` (أو export):

```bash
FOLLOWUP_LEGACY=false
FOLLOWUP_SERVICE_URL=http://localhost:3100
FOLLOWUP_REDIS_HOST=localhost
FOLLOWUP_REDIS_PORT=6380
```

**الخطوة 4: شغّل السيرفر الأساسي**

```bash
pnpm start
```

**الخطوة 5: اختبر**

- افتح الـ UI → Dashboard → Follow-Ups.
- أضف config لـ chatflow، ابعت رسالة في chat.
- تابع الـ logs:
  ```bash
  docker logs -f followup-service
  ```

### السيناريو 2: إنتاج (Production)

**الخطوة 1: Build**

```bash
pnpm build
```

**الخطوة 2: Deploy الـ services**

- شغّل `redis-followup` و`clickhouse` على سيرفرات مخصصة أو managed services.
- Build صورة الدوكر للسيرفس:
  ```bash
  cd packages/followup-service
  docker build -t followup-service:latest .
  ```
- Deploy الصورة مع الـ env vars المطلوبة.

**الخطوة 3: اضبط السيرفر الأساسي**

- `FOLLOWUP_LEGACY=false`
- `FOLLOWUP_SERVICE_URL=http://<followup-service-host>:3100`
- `FOLLOWUP_REDIS_HOST/PORT` → يشير للـ Redis المخصص
- `DATABASE_*` → Postgres المشترك (لكن السيرفس يقرأ config بس)

**الخطوة 4: راقب**

- Postgres: `pg_stat_activity` → تأكد إن الـ connections **ما بتزيدش** (هدفنا الأساسي).
- ClickHouse: حجم الـ table + الـ TTL partitions بتتمسح.
- Redis: memory usage للـ timers ZSET + message cache.
- السيرفس logs: webhook success/failure rate.

---

## 7. التحقق (Verification)

### 1. الـ contract مش اتغيّر

**الهدف:** الـ UI تشتغل بدون أي تعديل.

**الاختبار:**
- افتح `/followup` (Dashboard/Pending/History/Settings) في الـ UI.
- اعمل config CRUD (create/edit/delete).
- ابعت رسالة في chatflow فيه follow-up enabled.
- تأكد من:
  - الـ pending jobs بتظهر.
  - الـ webhook بيُرسل بعد الـ idle timeout.
  - الـ logs بتتسجّل صح.
  - الـ retry بيشتغل.

### 2. Postgres مش بيتضرب

**الهدف:** الـ worker ما بيلمسش Postgres في الـ hot path.

**الاختبار:**
```sql
-- قبل ما تبعت رسائل
SELECT count(*), state FROM pg_stat_activity 
WHERE application_name = 'Octobot' 
GROUP BY state;

-- ابعت 1000 رسالة في chatflows فيها follow-up
-- (load test script أو manual)

-- بعد الإرسال
SELECT count(*), state FROM pg_stat_activity 
WHERE application_name = 'Octobot' 
GROUP BY state;
```

**النتيجة المتوقعة:** الـ connection count **ثابت** (فقط الـ 4 من السيرفس للـ config reads).

### 3. الـ logs بتتخزّن في ClickHouse

**الاختبار:**
```bash
docker exec -it followup-clickhouse clickhouse-client

-- في الـ ClickHouse shell:
USE followup;
SELECT count(), status FROM follow_up_log GROUP BY status;
SELECT chatflowId, count() FROM follow_up_log GROUP BY chatflowId;

-- تأكد من الـ TTL
SHOW CREATE TABLE follow_up_log;
```

### 4. الـ timers في Redis ZSET

**الاختبار:**
```bash
docker exec -it followup-redis redis-cli

# في redis-cli:
ZCARD followup:timers
ZRANGE followup:timers 0 10 WITHSCORES
HLEN followup:timerjobs
```

### 5. الـ maxFires counter

**الاختبار:**
- اضبط step بـ `maxFires=1`.
- ابعت رسالة → استنى الـ idle timeout → تأكد إن الـ webhook طلع مرة واحدة.
- ابعت رسالة تانية → استنى → تأكد إن الـ webhook **ما طلعش** تاني.
- تأكد من الـ log في ClickHouse بيقول `cancelled: max_fires_reached_1_of_1`.

### 6. التحمّل (Load Test)

**الهدف:** 100k+ session/timer متزامن.

**الاختبار:**
- Script يبعت 100k رسالة لـ chatflows مختلفة.
- راقب:
  - `ZCARD followup:timers` → لازم يوصل ~100k.
  - الـ poller throughput (logs).
  - ClickHouse insert rate.
  - **Postgres connections ثابتة.**
- استنى الـ idle timeouts تضرب → تأكد إن الـ webhooks بتطلع صح.
- شغّل لمدة **48+ ساعة** (المدة اللي النظام القديم انهار فيها).

---

## 8. الرجوع للنظام القديم (Rollback)

لو حصلت مشكلة والنظام الجديد مش شغّال، الرجوع فوري وآمن:

**الخطوة 1: ارجع للـ legacy mode**

```bash
# في env السيرفر الأساسي:
FOLLOWUP_LEGACY=true
```

**الخطوة 2: restart السيرفر**

```bash
pnpm start
```

**الأثر:**
- السيرفر يرجع يشغّل in-process worker + BullMQ.
- الـ routes ترجع تستدعي الـ controller القديم مباشرة.
- الـ UI تفضل شغّالة بدون أي تغيير.

**ملاحظة:** الـ timers اللي كانت في Redis المخصص (ZSET) **مش هتترحّل تلقائياً**. لو عايز ترجّعها:
- اقرأ الـ ZSET من Redis المخصص.
- لكل timer، اعمل schedule في BullMQ القديم يدوياً.
- **أو** ببساطة: الـ sessions الجديدة هتتجدول تلقائياً على أول رسالة بعد الرجوع.

---

## 9. الصيانة المستقبلية

### إضافة endpoint جديد

لو محتاج endpoint جديد في الـ API:
1. أضفه في `packages/followup-service/src/api/server.ts`.
2. أضف الـ handler المقابل (query ClickHouse/Redis).
3. الـ proxy في السيرفر هيشتغل تلقائياً (شامل لكل `/followup/*`).

### تعديل الـ schema

لو محتاج عمود جديد في ClickHouse:
```sql
ALTER TABLE follow_up_log ADD COLUMN newField String DEFAULT '';
```

ClickHouse بيدعم `ADD COLUMN` بدون إعادة كتابة الجدول.

### Scaling

- **السيرفس horizontally scalable:** شغّل instances كتير، كلهم يقرؤا من نفس Redis Stream (consumer group) ونفس ZSET (atomic claim).
- **Redis:** لو الـ memory مش كفاية، استخدم Redis Cluster أو زوّد الـ RAM.
- **ClickHouse:** لو الـ writes كتير، استخدم ClickHouse cluster مع replication.

### Monitoring

راقب:
- **Latency:** `webhook send time` (logs في السيرفس).
- **Error rate:** `failed / total` webhooks (من ClickHouse).
- **Queue depth:** `ZCARD followup:timers` (لازم يقل مع الوقت، مش يتراكم).
- **Postgres connections:** `pg_stat_activity` → لازم ثابت (~4 من السيرفس).

---

## 10. الخلاصة

| قبل | بعد |
|-----|-----|
| Worker في نفس بروسيس السيرفر | Worker في microservice منفصل |
| كل job بيضرب Postgres 3–5 مرات | Worker بيقرأ/يكتب Redis + ClickHouse فقط |
| Logs بتتراكم في Postgres بلا حدود | ClickHouse TTL بيمسح القديم تلقائياً |
| maxFires = COUNT query تقيل | maxFires = INCR counter سريع |
| reschedule = cancel+re-add storm | reschedule = ZADD واحدة |
| 50 worker على pool = 20 connection | pool مخصص = 4 للـ config reads فقط |
| انهيار بعد ~48 ساعة | يتحمّل 100k+ concurrent بدون انهيار |

**الفائدة الأساسية:** Postgres المشترك **مبقاش بيتلمس** من الـ hot path → السيرفر والمشاريع التانية مش بتتأثر بضغط الـ follow-ups.

**الـ UI:** **صفر تعديلات** — نفس الـ 15 endpoint بالظبط.
