# Follow-Up Service — Evolutions for Extreme-Scale Resilience

> اقتراحات تطويرية تضمن استمرارية الخدمة تحت ضغط أعلى بكثير من الـ 100 ألف
> عملية متزامنة. كل اقتراح مبنّي على "إيه اللي ممكن يكسر النظام لو الضغط زاد 10x؟"

---

## 1. Redis Memory Protection — حدود عليا إجبارية

### إيه اللي ممكن يحصل؟

الـ ZSET بتاع التايمرز (`followup:timers`) والـ message cache (`followup:msgs:*`) ممكن ياكلوا كل ذاكرة الـ Redis لو:

- 500 ألف جلسة نشطة × 3 steps = 1.5 مليون عضو في الـ ZSET
- كل جلسة مخزّنة 50 رسالة (`maxCachedMessages`) × متوسط 500 بايت = 25 KB
- 500 ألف جلسة × 25 KB = **12.5 GB** للـ message cache لوحده

**النتيجة:** Redis يموت بـ OOM → التايمرز تضيع → الخدمة تقع صامت.

### الحل المقترح

```typescript
// packages/followup-service/src/redis/memoryGuard.ts

/**
 * MemoryGuard: يمنع Redis من تجاوز حدود الذاكرة.
 * لو الـ memory قربت من الحد، بيبدأ يرفض sessions جديدة (وليس كل الـ service).
 */
export class MemoryGuard {
  private readonly MAX_ZSET_SIZE: number;     // مثال: 2,000,000 عضو
  private readonly MAX_MSG_CACHE_KEYS: number; // مثال: 200,000 مفتاح
  private degraded = false;

  constructor(private redis: Redis) {
    this.MAX_ZSET_SIZE = parseInt(process.env.FOLLOWUP_REDIS_MAX_TIMERS || "2000000");
    this.MAX_MSG_CACHE_KEYS = parseInt(process.env.FOLLOWUP_REDIS_MAX_MSG_CACHE || "200000");
  }

  /** قبل ما نضيف timer جديد، نتأكد إن الـ ZSET لسه في الحدود */
  async canSchedule(): Promise<boolean> {
    if (this.degraded) return false;
    const size = await this.redis.zcard("followup:timers");
    if (size >= this.MAX_ZSET_SIZE) {
      this.degraded = true;
      logger.warn(`MemoryGuard: ZSET at ${size}, entering degraded mode`);
      // أشعر الفريق (webhook/alert)
      return false;
    }
    return true;
  }

  /** لو رجعت المساحة، ارجع للوضع الطبيعي */
  async checkRecovery(): Promise<void> {
    if (!this.degraded) return;
    const size = await this.redis.zcard("followup:timers");
    if (size < this.MAX_ZSET_SIZE * 0.8) {
      this.degraded = false;
      logger.info("MemoryGuard: recovered from degraded mode");
    }
  }
}
```

**الأثر:** الخدمة تفضّل تشتغل جزئياً (لأقدم الجلسات) بدل ما تقع بالكامل.

---

## 2. Graceful Degradation — تشغيل التايمرز حتى لو ClickHouse وقع

### إيه اللي ممكن يحصل؟

لو ClickHouse وقع (صيانة، network partition، overload)، والـ worker بيحاول يكتب log في الـ `insertLog()`:

```typescript
// حالياً: بيحاول يكتب، لو فشل بيعمل warn وبيكمّل
try { await insertLog(row); }
catch (e) { logger.error("ClickHouse insert failed:", e); }
```

لكن السؤال: **نكمّل نبعث webhooks حتى لو الـ logs ضايعة؟**

الإجابة الصح: **آه** — التايمرز أهم من التسجيل. نكمّل نبعث webhooks ونخزّن الـ logs في buffer مؤقت.

### الحل المقترح

```typescript
// packages/followup-service/src/worker/writeBuffer.ts

/**
 * WriteBuffer: لما ClickHouse يقع، الـ logs يتخزّنوا في Redis مؤقتاً
 * (capped list) ولما يرجع، يتدفعوا. لو الامر طال، يتسربوا لملف.
 */
export class WriteBuffer {
  private readonly BUFFER_KEY = "followup:log_buffer";
  private readonly MAX_BUFFER = 50000; // 50 ألف log في الـ buffer
  private chDown = false;
  private drainTimer: NodeJS.Timeout | null = null;

  async write(row: FollowUpLogRow): Promise<void> {
    if (!this.chDown) {
      try {
        await insertLog(row);
        return;
      } catch (e) {
        this.chDown = true;
        this.startDrain();
      }
    }
    // Buffer it
    const json = JSON.stringify(row);
    await this.redis.rpush(this.BUFFER_KEY, json);
    await this.redis.ltrim(this.BUFFER_KEY, -this.MAX_BUFFER, -1);
  }

  private startDrain(): void {
    this.drainTimer = setInterval(async () => {
      const batch = await this.redis.lpop(this.BUFFER_KEY, 1000);
      if (!batch?.length) { this.chDown = false; return; }
      try {
        await insertBatch(JSON.parse(`[${batch.join(",")}]`));
      } catch {
        // لسه واقع — سيبه في الـ buffer
        await this.redis.lpush(this.BUFFER_KEY, ...batch);
      }
    }, 10000);
  }
}
```

**الأثر:** الـ webhooks تفضل تطلع حتى لو Clickhouse واقع. الـ logs تتخزن مؤقتاً وتسترد تلقائياً.

---

## 3. Circuit Breaker للـ Webhooks البطيئة

### إيه اللي ممكن يحصل؟

لو endpoint معيّن (webhookUrl لخطوة معينة) بياخد 30 ثانية كل مرة أو بيرجع 500 باستمرار:

- كل worker slot بيتقفل 30 ثانية عليه
- 50 worker ممكن يتزنقوا كلهم على نفس الـ endpoint البطيء
- الـ poller مش عارف ياخد timers جديدة

**النتيجة:** endpoint واحد عطلان يعطّل السيرفس كله.

### الحل المقترح

```typescript
// packages/followup-service/src/worker/circuitBreaker.ts

/**
 * Circuit Breaker لكل webhook URL.
 * لو endpoint فشل 5 مرات متتالية → افتح الدائرة وتخطاه لمدة دقيقة.
 * بعد دقيقة → جرّب مرة واحدة (half-open). لو نجح → اقفل. لو فشل → افتح تاني.
 */
export class CircuitBreaker {
  private circuits = new Map<string, {
    failures: number;
    openedAt: number;
    state: "closed" | "open" | "half-open";
  }>();

  private readonly THRESHOLD = 5;        // 5 فشل متتالي = افتح
  private readonly RESET_MS = 60000;     // 60 ثانية = جرّب تاني

  async call(url: string, fn: () => Promise<any>): Promise<any> {
    const c = this.circuits.get(url) || { failures: 0, openedAt: 0, state: "closed" as const };

    if (c.state === "open") {
      if (Date.now() - c.openedAt < this.RESET_MS) {
        throw new CircuitOpenError(url);
      }
      c.state = "half-open"; // جرّب
    }

    try {
      const result = await fn();
      if (c.state === "half-open" || c.failures > 0) {
        c.failures = 0;
        c.state = "closed";
      }
      this.circuits.set(url, c);
      return result;
    } catch (e) {
      c.failures++;
      if (c.failures >= this.THRESHOLD) {
        c.state = "open";
        c.openedAt = Date.now();
        logger.warn(`Circuit breaker OPEN for ${url}`);
      }
      this.circuits.set(url, c);
      throw e;
    }
  }

  /** كم endpoint مفتوحين دلوقتي؟ (للـ monitoring) */
  getOpenCount(): number {
    let count = 0;
    for (const c of this.circuits.values()) {
      if (c.state === "open") count++;
    }
    return count;
  }
}
```

**استخدامه في الـ worker:**

```typescript
class Worker {
  private breaker = new CircuitBreaker();

  async sendWebhook(job: TimerJob, payload: unknown) {
    return this.breaker.call(job.webhookUrl, async () => {
      return await fetch(job.webhookUrl, { ... });
    });
  }
}
```

**الأثر:** endpoint بطيء أو عطلان ما يعطّلش الـ service. worker slots يفضلوا متاحين للـ endpoints السليمة.

---

## 4. Webhook Rate Limiting لكل Chatflow

### إيه اللي ممكن يحصل؟

chatflow واحد عنده 50 ألف session، كلهم بيضربوا نفس الـ idle timeout (مثلاً 5 دقايق). وقت الإطلاق: **50 ألف webhook في نفس الثانية** على نفس الـ endpoint بتاع العميل. ده ممكن:

- يقتل الـ endpoint بتاع العميل (DDoS غير مقصود)
- الـ service نفسه يتزنق (network + CPU + memory للـ fetch)

### الحل المقترح

```typescript
// packages/followup-service/src/worker/rateLimiter.ts

/**
 * Per-chatflow webhook rate limiter.
 * يمنع إن الـ service يبعت أكتر من N webhook في الثانية لكل chatflow.
 */
export class WebhookRateLimiter {
  private redis: Redis;

  /**
   * هل مسموح نبعث webhook للـ chatflow ده دلوقتي؟
   * بنستعمل Redis sliding window.
   */
  async acquire(chatflowId: string): Promise<boolean> {
    const key = `followup:ratelimit:${chatflowId}`;
    const now = Date.now();
    const window = 1000; // 1 second

    // Sliding window: نحسب الـ requests في آخر ثانية
    await this.redis.zremrangebyscore(key, "-inf", (now - window).toString());
    const count = await this.redis.zcard(key);

    const maxPerSecond = parseInt(
      process.env.FOLLOWUP_MAX_WEBHOOKS_PER_SECOND || "100"
    );

    if (count >= maxPerSecond) return false;

    // سجّل الـ request ده
    await this.redis.zadd(key, now.toString(), `${now}-${Math.random()}`);
    await this.redis.expire(key, 2);
    return true;
  }
}
```

**في الـ worker:**

```typescript
if (!await this.rateLimiter.acquire(job.chatflowId)) {
  // أرجّع الـ timer للـ ZSET (ريتري بعد شوية)
  job.fireAt = Date.now() + 5000; // 5 ثواني
  await this.timers.schedule(job);
  return;
}
```

**الأثر:** حتى لو 50 ألف session ضربوا في نفس الثانية، الـ webhooks يتوزعوا على الوقت بطريقة controlled.

---

## 5. Health Checks + Auto-Healing

### إيه اللي ممكن يحصل؟

- Redis يقع (network partition) → الـ consumer يقف → timers تتراكم
- ClickHouse يقع → الـ write buffer يمتلي → الـ memory يزيد
- الـ poller يعلق (infinite loop) → timers ما تتاخدش
- الـ worker pool كله stuck على webhooks بطيئة → الخدمة تتجمد

من غير health checks، المشكلة تتفاقم لساعات من غير ما حد ياخد باله.

### الحل المقترح

```typescript
// packages/followup-service/src/health/monitor.ts

/**
 * HealthMonitor: فحص دوري للمكونات الحيوية + metrics للـ dashboard.
 */
export class HealthMonitor {
  private health: {
    redis: "up" | "down" | "degraded";
    clickhouse: "up" | "down";
    consumer: { lag: number; lastEvent: number };
    poller: { lastClaim: number; claimedLastMinute: number };
    workers: { active: number; idle: number };
    memoryGuard: { degraded: boolean; zsetSize: number };
  } = { /* ... */ };

  async start() {
    // فحص كل 10 ثواني
    setInterval(() => this.check(), 10000);

    // HTTP endpoint: GET /health
    app.get("/health", (req, res) => {
      const status = this.isHealthy() ? 200 : 503;
      res.status(status).json(this.health);
    });

    // Prometheus-style metrics endpoint
    app.get("/metrics", (req, res) => {
      res.set("Content-Type", "text/plain");
      res.send(this.toPrometheus());
    });
  }

  private async check() {
    // Redis ping
    const redisStart = Date.now();
    try { await this.redis.ping(); this.health.redis = "up"; }
    catch { this.health.redis = "down"; }
    this.redisLatencyMs = Date.now() - redisStart;

    // ClickHouse ping
    try { await this.ch.ping(); this.health.clickhouse = "up"; }
    catch { this.health.clickhouse = "down"; }

    // Consumer lag
    const streamInfo = await this.redis.xinfo("STREAM", "followup:events");
    this.health.consumer.lag = streamInfo.length - streamInfo.lastGeneratedId;

    // Timer ZSET
    this.health.memoryGuard.zsetSize = await this.redis.zcard("followup:timers");

    // Auto-healing triggers
    if (this.health.redis === "down" && this.health.redisDownSince === 0) {
      this.health.redisDownSince = Date.now();
    }
    if (this.health.redis === "up") {
      this.health.redisDownSince = 0;
    }
    // لو Redis واقع لأكتر من 5 دقايق → restart
    if (this.health.redisDownSince > 0 && 
        Date.now() - this.health.redisDownSince > 300000) {
      logger.error("Redis down for 5 min, triggering restart...");
      process.exit(1); // الـ orchestrator (docker/k8s) هيعمل restart
    }
  }

  private isHealthy(): boolean {
    return this.health.redis !== "down" && 
           this.health.consumer.lag < 100000; // أقل من 100k event متأخرين
  }
}
```

**الأثر:** 
- Orchestrator (Docker/K8s) يقدر يعمل `healthcheck` على `GET /health` ويعمل restart لو الخدمة مش healthy.
- `/metrics` لـ Prometheus/Grafana dashboard.
- Auto-restart لو Redis واقع لفترة طويلة.

---

## 6. Consumer Backpressure — منع تراكم الـ Stream

### إيه اللي ممكن يحصل؟

لو الـ consumer بطيء (DB بطيء، network، etc.)، الـ Stream بيتراكم:

```
XADD: 5000 event/sec
XREADGROUP: consumer بيقرأ 200 كل 2s = 100 event/sec

بعد ساعة: 17.6 مليون event متراكم في الـ Stream
→ Redis memory بتنفجر
→ الـ consumer لما يرجع هي processing events قديمة
   (مشكلة: cancel flag/scheduling لأحداث من ساعة فاتت)
```

### الحل المقترح

```typescript
// packages/followup-service/src/ingest/backpressure.ts

/**
 * BackpressureController: يمنع تراكم الـ Stream عن طريق:
 * 1. رفض events لو الـ consumer lag زاد عن الحد
 * 2. الـ publisher (السيرفر) يستخدم XADD مع NOMKSTREAM + check
 */
export class BackpressureController {
  private readonly MAX_LAG = 50000; // 50 ألف event متراكمين كحد أقصى

  /** يتأكد إن الـ lag مقبول، وإلا يرمي خطأ (الـ publisher هيسكيب) */
  async checkBeforePublish(): Promise<boolean> {
    try {
      const info = await this.redis.xinfo("STREAM", "followup:events");
      const lag = info.length - info.lastGeneratedId;
      return lag < this.MAX_LAG;
    } catch {
      return true; // لو Redis واقع، سيبه (الـ publisher هيسكيب عنده)
    }
  }
}

// ===== في الـ publisher (packages/server) =====
// اختياري: قبل الـ XADD، احسب الـ lag. لو عالي، skip.
// ده بيمنع إن السيرفر يضيف حمل فوق طاقة الـ service.
```

**الأثر:** الـ consumer ما يغرقش. لو Truly overloaded، الـ events الجديدة تترفض (تفضل في الـ Stream buffer بدل متعمل OOM).

---

## 7. Sharding-Ready Timer Distribution

### إيه اللي ممكن يحصل؟

في مرحلة متقدمة، Redis واحد (حتى لو dedicated) مش هيكفي للـ ZSET اللي فيه ملايين الأعضاء. الـ `ZRANGEBYSCORE` على ZSET فيه 5 مليون عضو هياخد وقت.

### الحل المقترح (للمستقبل)

```typescript
// packages/followup-service/src/redis/shardedTimerStore.ts

/**
 * ShardedTimerStore: يوزّع الـ timers على N من الـ ZSETs
 * (shard key = hash(chatflowId) % N).
 * كل shard ممكن يكون على Redis node مختلفة (Redis Cluster).
 */
export class ShardedTimerStore {
  private shards: TimerStore[];
  private readonly SHARD_COUNT: number;

  constructor(redisClients: Redis[]) {
    this.SHARD_COUNT = redisClients.length;
    this.shards = redisClients.map(r => new TimerStore(r));
  }

  private shardKey(chatflowId: string): number {
    let hash = 0;
    for (let i = 0; i < chatflowId.length; i++) {
      hash = ((hash << 5) - hash) + chatflowId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % this.SHARD_COUNT;
  }

  async schedule(job: TimerJob): Promise<void> {
    const shard = this.shardKey(job.chatflowId);
    await this.shards[shard].schedule(job);
  }

  /** التعديل الأهم: claimDue يجمّع من كل الـ shards */
  async claimDue(now: number, count: number): Promise<TimerJob[]> {
    const perShard = Math.ceil(count / this.SHARD_COUNT);
    const results = await Promise.all(
      this.shards.map(s => s.claimDue(now, perShard))
    );
    return results.flat();
  }
}
```

**الأثر:** لما توصل لـ 5-10 مليون timer متزامن، التوزيع على 8-16 shard يحافظ على الأداء.

---

## 8. Dead Letter Queue للـ Webhooks اللي فشلت نهائياً

### إيه اللي ممكن يحصل؟

Webhook فشل 3 مرات (retries exhausted). حالياً: بيتسجّل failed في ClickHouse وخلاص. لكن ممكن endpoint يكون وقع لمدة ساعة ورجع — ومفيش آلية تعيد المحاولة بعد ساعة.

### الحل المقترح

```typescript
// packages/followup-service/src/worker/deadLetter.ts

/**
 * DeadLetterQueue: للـ webhooks اللي استنفذت retries.
 * تتخزن في Redis Sorted Set (score = وقت آخر محاولة).
 * عامل منفصل يجرّبهم كل N دقايق (لفترة محدودة).
 */
export class DeadLetterQueue {
  private readonly DLQ_KEY = "followup:dlq";
  private readonly MAX_AGE_MS = 3600000; // ساعة واحدة
  private readonly RETRY_INTERVAL_MS = 300000; // كل 5 دقايق

  async enqueue(job: TimerJob): Promise<void> {
    await this.redis.zadd(this.DLQ_KEY, Date.now().toString(), JSON.stringify(job));
  }

  async retryLoop(): Promise<void> {
    setInterval(async () => {
      const cutoff = Date.now() - this.RETRY_INTERVAL_MS;
      const oldCutoff = Date.now() - this.MAX_AGE_MS;

      // جيب اللي مستنيين 5 دقايق، واحذف اللي أقدم من ساعة
      const members = await this.redis.zrangebyscore(this.DLQ_KEY, oldCutoff, cutoff);
      await this.redis.zremrangebyscore(this.DLQ_KEY, "-inf", oldCutoff);

      for (const raw of members) {
        const job = JSON.parse(raw) as TimerJob;
        await this.worker.process(job); // حاول تاني
      }
      await this.redis.zrem(this.DLQ_KEY, ...members);
    }, this.RETRY_INTERVAL_MS);
  }
}
```

**الأثر:** الـ webhooks اللي endpoints بتوعها رجعوا بعد تعطّل طويل، هيتحاولوا تاني أوتوماتيكياً لحد ساعة.

---

## 9. Per-Step Timeout Configuration (الـ idle timeout لكل خطوة له حد أقصى)

### المشكلة

مفيش حد أقصى للـ idle timeout — مستخدم ممكن يحط `idleTimeout=365` و`unit=days`. ده timer هيفضل في الـ ZSET لسنة كاملة — مضيعة للذاكرة.

### الحل المقترح

```typescript
// packages/followup-service/src/config/configAdmin.ts
// إضافة validation:

const MAX_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 أيام كحد أقصى

function validateStep(step: Partial<FollowUpStep>): void {
  const ms = idleTimeoutToMs(
    step.idleTimeout || 30,
    step.idleTimeoutUnit || "minutes"
  );
  if (ms > MAX_IDLE_TIMEOUT_MS) {
    throw new Error(
      `idleTimeout must not exceed 7 days. Got ${step.idleTimeout} ${step.idleTimeoutUnit}`
    );
  }
}
```

---

## 10. Monitoring Dashboard (Prometheus + Grafana)

### Metrics مقترحة

```typescript
// metrics نضيفها في /metrics:

// Core throughput
followup_stream_events_total{chatflowId}         // counter: كل event دخل
followup_timers_scheduled_total{chatflowId}       // counter: كل timer اتجدول
followup_timers_claimed_total                     // counter: كل timer اتاخد
followup_webhooks_sent_total{chatflowId,status}   // counter: نجاح/فشل

// Current state
followup_timers_pending                           // gauge: ZCARD
followup_timers_zset_size_bytes                   // gauge: memory
followup_consumer_lag                             // gauge: stream lag
followup_workers_active                           // gauge: active count
followup_circuit_breakers_open                    // gauge: عدد الـ circuits المفتوحة
followup_dlq_size                                 // gauge: dead letter queue size

// Latency
followup_webhook_duration_ms{chatflowId}          // histogram: P50/P95/P99
followup_claim_duration_ms                        // histogram
followup_stream_process_duration_ms               // histogram

// Health
followup_redis_connected                          // 1 or 0
followup_clickhouse_connected                     // 1 or 0
followup_db_pool_active                           // gauge
```

### Alerts مقترحة

| Alert | Condition | Severity |
|-------|-----------|----------|
| Timer backlog | `followup_timers_pending > 1000000` | Warning |
| Timer backlog critical | `followup_timers_pending > 5000000` | Critical |
| Consumer lag | `followup_consumer_lag > 50000` | Warning |
| Webhook failure rate | `rate(failed) / rate(total) > 0.1` | Warning |
| Circuit breakers open | `followup_circuit_breakers_open > 5` | Critical |
| ClickHouse down | `followup_clickhouse_connected == 0` for 5m | Warning |
| Redis down | `followup_redis_connected == 0` for 1m | Critical |
| Service down | `up == 0` | Critical |
| DLQ growing | `followup_dlq_size > 10000` | Warning |
| P99 latency | `followup_webhook_duration_ms_p99 > 25000` | Warning |

---

## 11. توصيات إضافية خفيفة

| # | التوصية | الأثر |
|---|---------|-------|
| 1 | **الـ Dockerfile يستخدم multi-stage build** — build في stage أولى، production في stage تانية من غير devDependencies | صورة أصغر، أمان أفضل |
| 2 | **سيشن idle طويلة جداً تتشال من الذاكرة** — auto-cleanup للـ message cache بعد 30 يوم idle | memory leakage prevention |
| 3 | **الـ stream events يكون عندهم maxlen صارم** — `XADD ... MAXLEN ~ 1000000` (مطبق حالياً) | حماية إضافية للـ Redis memory |
| 4 | **استخدام `HEALTHCHECK` في الـ Dockerfile** — يضرب `/health` كل 30s | الـ Docker يعمل restart تلقائي |
| 5 | **فصل الـ config refresh pool عن الـ CRUD pool** — pool للقراءة، pool للكتابة | isolation للمسارات النادرة |
| 6 | **استخدام Redis Cluster بدل standalone** — لما توصل لأحجام كبيرة (10M+ timers) | horizontal scaling للـ state |

---

## ملخص الأولويات

| الأولوية | التطوير | ليه |
|----------|---------|-----|
| 🔴 **P0** | Circuit Breaker (#3) | endpoint عطلان واحد ما يقتلش السيرفس كله |
| 🔴 **P0** | Webhook Rate Limiting (#4) | منع الـ DDoS غير المقصود على العملاء |
| 🔴 **P0** | Health Checks (#5) | اكتشاف الأعطال تلقائياً + auto-restart |
| 🟠 **P1** | Memory Guard (#1) | منع Redis OOM تحت الضغط الأكبر |
| 🟠 **P1** | Graceful Degradation (#2) | تشغيل التايمرز حتى لو ClickHouse وقع |
| 🟠 **P1** | Consumer Backpressure (#6) | منع تراكم الـ Stream في الـ memory |
| 🟡 **P2** | Metrics + Alerts (#10) | رؤية استباقية قبل ما النظام يقع |
| 🟡 **P2** | Dead Letter Queue (#8) | استرداد الـ webhooks بعد تعافي الـ endpoints |
| 🟢 **P3** | Sharding (#7) | للوصول لأحجام 5-10M+ timer |
| 🟢 **P3** | Per-Step Timeout Cap (#9) | منع timers بلا نهاية في الـ ZSET |
