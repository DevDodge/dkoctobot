import { env } from "./config/env";
import { logger } from "./utils/logger";
import { getRedis, closeRedis } from "./redis/client";
import { ensureSchema, closeClickHouse } from "./clickhouse/client";
import { StateStore } from "./redis/stateStore";
import { TimerStore } from "./redis/timerStore";
import { ConfigProvider } from "./config/configProvider";
import { ConfigAdmin } from "./config/configAdmin";
import { Scheduler } from "./scheduler/scheduler";
import { IngestConsumer } from "./ingest/consumer";
import { Worker } from "./worker/processor";
import { Poller } from "./scheduler/poller";
import { HealthMonitor } from "./health/monitor";
import { CircuitBreaker } from "./worker/circuitBreaker";
import { WebhookRateLimiter } from "./worker/rateLimiter";
import { startApiServer } from "./api/server";

async function main(): Promise<void> {
  logger.info("Starting follow-up service...");

  // Connectivity
  getRedis();
  await ensureSchema();

  // Stores
  const state = new StateStore();
  const timers = new TimerStore();

  // Config (Postgres, cached — not hot path)
  const provider = new ConfigProvider();
  await provider.start();
  const admin = new ConfigAdmin(provider);

  // P0 resilience components
  const circuitBreaker = new CircuitBreaker();
  const rateLimiter = new WebhookRateLimiter();

  // Pipeline
  const scheduler = new Scheduler(state, timers, provider);
  const consumer = new IngestConsumer(state, scheduler);
  const worker = new Worker(state, circuitBreaker, rateLimiter);
  const poller = new Poller(timers, worker);

  // Health monitor
  const monitor = new HealthMonitor();
  // Feed live gauges from other components.
  setInterval(() => {
    monitor.activeWorkers = poller.inFlight;
    monitor.consumerLag = (consumer as any)._lag || 0;
    monitor.lastEventTs = (consumer as any)._lastEventTs || 0;
    // circuit breaker stats fed on-demand in snapshot
  }, 5000);

  // Periodic health check (auto-restart if Redis down too long)
  setInterval(() => monitor.check().catch(() => {}), 10000);

  await consumer.start();
  poller.start();

  // HTTP API + health/metrics
  startApiServer({ provider, admin, timers, state, worker, monitor, circuitBreaker });

  logger.info("Follow-up service is up.");

  const shutdown = async (sig: string) => {
    logger.info(`Received ${sig}, shutting down...`);
    consumer.stop();
    poller.stop();
    await provider.stop().catch(() => {});
    await closeRedis().catch(() => {});
    await closeClickHouse().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  logger.error("Fatal startup error:", e);
  process.exit(1);
});
