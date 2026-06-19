import dotenv from "dotenv";

dotenv.config();

function int(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

function str(name: string, def: string): string {
  return process.env[name] || def;
}

export const env = {
  // HTTP API
  port: int("FOLLOWUP_SERVICE_PORT", 3100),
  // Dedicated Redis for the follow-up service (separate from Flowise Redis)
  redisUrl: process.env.FOLLOWUP_REDIS_URL || "",
  redisHost: str("FOLLOWUP_REDIS_HOST", "localhost"),
  redisPort: int("FOLLOWUP_REDIS_PORT", 6380),
  redisPassword: process.env.FOLLOWUP_REDIS_PASSWORD,
  redisUsername: process.env.FOLLOWUP_REDIS_USERNAME,

  // ClickHouse (log store)
  clickhouseUrl: str("CLICKHOUSE_URL", "http://localhost:8123"),
  clickhouseUser: str("CLICKHOUSE_USER", "default"),
  clickhousePassword: str("CLICKHOUSE_PASSWORD", ""),
  clickhouseDb: str("CLICKHOUSE_DB", "followup"),
  logRetentionDays: int("CLICKHOUSE_LOG_RETENTION_DAYS", 30),

  // Stream / consumer
  eventsStream: str("FOLLOWUP_EVENTS_STREAM", "followup:events"),
  consumerGroup: str("FOLLOWUP_CONSUMER_GROUP", "followup-workers"),
  consumerName: str("FOLLOWUP_CONSUMER_NAME", `consumer-${process.pid}`),
  streamReadCount: int("FOLLOWUP_STREAM_READ_COUNT", 200),
  streamBlockMs: int("FOLLOWUP_STREAM_BLOCK_MS", 2000),

  // Scheduler / worker
  pollIntervalMs: int("FOLLOWUP_POLL_INTERVAL_MS", 1000),
  pollBatchSize: int("FOLLOWUP_POLL_BATCH_SIZE", 500),
  workerConcurrency: int("FOLLOWUP_WORKER_CONCURRENCY", 50),
  webhookTimeoutMs: int("FOLLOWUP_WEBHOOK_TIMEOUT_MS", 30000),
  webhookMaxRetries: int("FOLLOWUP_WEBHOOK_MAX_RETRIES", 3),

  // Session message cache
  maxCachedMessages: int("FOLLOWUP_MAX_CACHED_MESSAGES", 50),
  msgCacheTtlSeconds: int("FOLLOWUP_MSG_CACHE_TTL_SECONDS", 86400),
  cancelFlagTtlSeconds: int("FOLLOWUP_CANCEL_FLAG_TTL_SECONDS", 300),
  fireCounterTtlSeconds: int("FOLLOWUP_FIRE_COUNTER_TTL_SECONDS", 604800),

  // Config source (Postgres) — read-only, cached
  configRefreshMs: int("FOLLOWUP_CONFIG_REFRESH_MS", 30000),

  // Postgres (config storage only — NOT in the timer/webhook hot path)
  pgHost: str("DATABASE_HOST", "localhost"),
  pgPort: int("DATABASE_PORT", 5432),
  pgUser: str("DATABASE_USER", "postgres"),
  pgPassword: str("DATABASE_PASSWORD", ""),
  pgDatabase: str("DATABASE_NAME", "flowise"),
  pgSsl: str("DATABASE_SSL", "false") === "true",
  pgPoolMax: int("FOLLOWUP_PG_POOL_MAX", 4),

  logLevel: str("FOLLOWUP_LOG_LEVEL", "info"),
};
