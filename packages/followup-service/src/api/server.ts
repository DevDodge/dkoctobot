import express, { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { ConfigProvider } from "../config/configProvider";
import { ConfigAdmin } from "../config/configAdmin";
import { TimerStore } from "../redis/timerStore";
import { StateStore } from "../redis/stateStore";
import { Worker } from "../worker/processor";
import { HealthMonitor } from "../health/monitor";
import { CircuitBreaker } from "../worker/circuitBreaker";
import * as logsQuery from "../clickhouse/logsQuery";
import { getLogById } from "../clickhouse/logsQuery";
import { logger } from "../utils/logger";
import { env } from "../config/env";

export interface ApiContext {
  provider: ConfigProvider;
  admin: ConfigAdmin;
  timers: TimerStore;
  state: StateStore;
  worker: Worker;
  monitor: HealthMonitor;
  circuitBreaker: CircuitBreaker;
}

export function buildApi(ctx: ApiContext) {
  const router = express.Router();
  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response) =>
      fn(req, res).catch((e) => {
        logger.error(`API error ${req.method} ${req.path}:`, e);
        res.status(500).json({ error: e?.message || "Internal error" });
      });

  // ==================== Config ====================
  router.get(
    "/config",
    wrap(async (_req, res) => {
      const bundles = ctx.provider.getAllCached();

      // Fetch chatflow names from Postgres
      const chatflowIds = bundles.map(b => b.config.chatflowId);
      const chatflowNames = new Map<string, string>();
      if (chatflowIds.length > 0) {
        try {
          const pool = ctx.provider.getPool();
          const result = await pool.query(
            `SELECT id::text as id, name FROM chat_flow WHERE id::text = ANY($1)`,
            [chatflowIds]
          );
          result.rows.forEach((row: any) => {
            chatflowNames.set(row.id, row.name);
          });
        } catch (e) {
          logger.error("Failed to fetch chatflow names:", e);
        }
      }

      const enriched = await Promise.all(
        bundles.map(async ({ config, steps }) => {
          const counts = await logsQuery.getChatflowCounts(config.chatflowId);
          let pendingTasks = 0;
          try {
            const jobs = await ctx.timers.pendingJobs(0, 1000);
            const mine = jobs.filter((j) => j.chatflowId === config.chatflowId);
            pendingTasks = mine.length;
          } catch {
            /* ignore */
          }
          return {
            ...config,
            chatflowName: chatflowNames.get(config.chatflowId) || config.chatflowId,
            stepsCount: steps.length,
            steps,
            ...counts,
            pendingTasks,
            activeSessions: 0,
          };
        })
      );
      res.json(enriched);
    })
  );

  router.get(
    "/config/:chatflowId",
    wrap(async (req, res) => {
      const bundle = await ctx.provider.getConfig(req.params.chatflowId);
      if (!bundle) {
        res.json({ config: null, steps: [] });
        return;
      }
      res.json(bundle);
    })
  );

  const upsert = wrap(async (req, res) => {
    const chatflowId = req.params.chatflowId || req.body.chatflowId;
    const bundle = await ctx.admin.upsert(
      chatflowId,
      req.body.config || req.body,
      req.body.steps || []
    );
    res.json(bundle);
  });
  router.post("/config", upsert);
  router.put("/config/:chatflowId", upsert);

  router.delete(
    "/config/:chatflowId",
    wrap(async (req, res) => {
      await ctx.admin.delete(req.params.chatflowId);
      res.json({ success: true });
    })
  );

  // ==================== Pending ====================
  router.get(
    "/pending",
    wrap(async (req, res) => {
      const start = parseInt((req.query.start as string) || "0", 10);
      const end = parseInt((req.query.end as string) || "50", 10);
      const jobs = await ctx.timers.pendingJobs(start, end);
      const total = await ctx.timers.pendingCount();
      res.json({
        jobs: jobs.map((j) => ({
          id: `followup:${j.chatflowId}:${j.trackingId}:step${j.stepOrder}`,
          data: {
            chatflowId: j.chatflowId,
            chatId: j.trackingId,
            sessionId: j.sessionId,
            stepOrder: j.stepOrder,
            stepName: j.stepName,
            idleTimeout: j.idleTimeout,
            idleTimeoutUnit: j.idleTimeoutUnit,
          },
          delay: Math.max(j.fireAt - Date.now(), 0),
          timestamp: j.fireAt,
        })),
        total,
      });
    })
  );

  router.post(
    "/cancel/:chatflowId/:chatId",
    wrap(async (req, res) => {
      await ctx.timers.cancelAll(req.params.chatflowId, req.params.chatId, 20);
      res.json({ success: true });
    })
  );

  // ==================== Logs ====================
  router.get(
    "/logs",
    wrap(async (req, res) => {
      const result = await logsQuery.getLogs({
        chatflowId: req.query.chatflowId as string,
        chatId: req.query.chatId as string,
        status: req.query.status as string,
        page: parseInt((req.query.page as string) || "1", 10),
        limit: parseInt((req.query.limit as string) || "20", 10),
      });
      res.json(result);
    })
  );

  router.get(
    "/logs/grouped",
    wrap(async (_req, res) => {
      const grouped = await logsQuery.getLogsGrouped();

      // Fetch chatflow names from Postgres
      const chatflowIds = grouped.map((row: any) => row.chatflowId);
      const chatflowNames = new Map<string, string>();
      if (chatflowIds.length > 0) {
        try {
          const pool = ctx.provider.getPool();
          const result = await pool.query(
            `SELECT id::text as id, name FROM chat_flow WHERE id::text = ANY($1)`,
            [chatflowIds]
          );
          result.rows.forEach((row: any) => {
            chatflowNames.set(row.id, row.name);
          });
        } catch (e) {
          logger.error("Failed to fetch chatflow names for logs:", e);
        }
      }

      // Add chatflowName to each row
      const enriched = grouped.map((row: any) => ({
        ...row,
        chatflowName: chatflowNames.get(row.chatflowId) || row.chatflowId
      }));

      res.json(enriched);
    })
  );

  router.get(
    "/logs/chatflow/:chatflowId/sessions",
    wrap(async (req, res) => {
      res.json(
        await logsQuery.getLogsByChatflowGroupedBySession(
          req.params.chatflowId
        )
      );
    })
  );

  router.get(
    "/logs/chatflow/:chatflowId/session/:chatId",
    wrap(async (req, res) => {
      res.json(
        await logsQuery.getLogsBySession(
          req.params.chatflowId,
          req.params.chatId
        )
      );
    })
  );

  router.get(
    "/logs/chatflow/:chatflowId",
    wrap(async (req, res) => {
      const page = parseInt((req.query.page as string) || "1", 10);
      const limit = parseInt((req.query.limit as string) || "50", 10);
      res.json(
        await logsQuery.getLogsByChatflow(req.params.chatflowId, page, limit)
      );
    })
  );

  router.get(
    "/logs/:id",
    wrap(async (req, res) => {
      const log = await getLogById(req.params.id);
      if (!log) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(log);
    })
  );

  router.post(
    "/retry/:logId",
    wrap(async (req, res) => {
      const log = await getLogById(req.params.logId);
      if (!log) {
        res.status(404).json({ error: "Log not found" });
        return;
      }
      // Re-fire immediately via the worker, bypassing maxFires.
      await ctx.worker.process({
        chatflowId: log.chatflowId,
        trackingId: log.chatId,
        stepOrder: log.stepOrder || 1,
        stepId: log.stepId || "",
        stepName: log.stepName || "Retry",
        idleTimeout: 0,
        idleTimeoutUnit: "minutes",
        webhookUrl: log.webhookUrl || "",
        webhookHeaders: undefined,
        maxMessages: 10,
        includeSessionDetails: true,
        maxFires: 0,
        sessionId: undefined,
        scheduledAt: new Date().toISOString(),
        fireAt: Date.now(),
      });
      res.json({ success: true });
    })
  );

  // ==================== Stats ====================
  router.get(
    "/stats",
    wrap(async (req, res) => {
      const days = parseInt((req.query.days as string) || "7", 10);
      const stats = await logsQuery.getStats(days);
      stats.pending = await ctx.timers.pendingCount();
      res.json(stats);
    })
  );

  // ==================== Health & Admin (under /followup for proxy) ====================
  router.get(
    "/health",
    wrap(async (_req, res) => {
      res.json(await ctx.monitor.snapshot());
    })
  );

  router.get(
    "/metrics",
    wrap(async (_req, res) => {
      const snap = await ctx.monitor.snapshot();
      // Inject live circuit breaker stats
      snap.circuitBreaker = ctx.circuitBreaker.stats;
      const lines = buildPrometheusLines(snap);
      res.set("Content-Type", "text/plain; version=0.0.4");
      res.send(lines);
    })
  );

  router.get(
    "/admin/circuits",
    wrap(async (_req, res) => {
      res.json(ctx.circuitBreaker.stats);
    })
  );

  router.post(
    "/admin/circuits/reset",
    wrap(async (req, res) => {
      const url = req.body?.url as string | undefined;
      if (url) {
        ctx.circuitBreaker.reset(url);
        res.json({ reset: url });
      } else {
        ctx.circuitBreaker.resetAll();
        res.json({ reset: "all" });
      }
    })
  );

  return router;
}

function buildPrometheusLines(snap: any): string {
  return [
    `# HELP followup_up Service health (1=healthy, 0.5=degraded, 0=unhealthy)`,
    `# TYPE followup_up gauge`,
    `followup_up ${snap.status === "healthy" ? 1 : snap.status === "degraded" ? 0.5 : 0}`,
    ``,
    `# HELP followup_uptime_seconds Service uptime`,
    `# TYPE followup_uptime_seconds gauge`,
    `followup_uptime_seconds ${snap.uptime}`,
    ``,
    `# HELP followup_redis_up Redis connected (1 or 0)`,
    `# TYPE followup_redis_up gauge`,
    `followup_redis_up ${snap.redis.state === "up" ? 1 : 0}`,
    ``,
    `# HELP followup_redis_latency_ms Redis ping latency`,
    `# TYPE followup_redis_latency_ms gauge`,
    `followup_redis_latency_ms ${snap.redis.latencyMs}`,
    ``,
    `# HELP followup_clickhouse_up ClickHouse connected (1 or 0)`,
    `# TYPE followup_clickhouse_up gauge`,
    `followup_clickhouse_up ${snap.clickhouse.state === "up" ? 1 : 0}`,
    ``,
    `# HELP followup_consumer_lag Stream consumer lag`,
    `# TYPE followup_consumer_lag gauge`,
    `followup_consumer_lag ${snap.consumer.lag}`,
    ``,
    `# HELP followup_consumer_last_event_age_ms Age of last event`,
    `# TYPE followup_consumer_last_event_age_ms gauge`,
    `followup_consumer_last_event_age_ms ${snap.consumer.lastEventAgeMs}`,
    ``,
    `# HELP followup_timers_pending Pending timers in ZSET`,
    `# TYPE followup_timers_pending gauge`,
    `followup_timers_pending ${snap.timers.pending}`,
    ``,
    `# HELP followup_workers_active Active worker count`,
    `# TYPE followup_workers_active gauge`,
    `followup_workers_active ${snap.workers.active}`,
    ``,
    `# HELP followup_circuit_breakers_open Open circuit breakers`,
    `# TYPE followup_circuit_breakers_open gauge`,
    `followup_circuit_breakers_open ${snap.circuitBreaker?.open || 0}`,
    ``,
    `# HELP followup_process_memory_mb Process memory MB`,
    `# TYPE followup_process_memory_mb gauge`,
    `followup_process_memory_mb ${snap.process.memoryMB}`,
    ``,
  ].join("\n");
}

export function startApiServer(ctx: ApiContext): express.Express {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  // Health & metrics (also at root for direct access / Docker healthcheck)
  app.get("/health", ctx.monitor.handler);
  app.get("/metrics", ctx.monitor.metricsHandler);

  // Followup API (includes health/admin endpoints under /followup prefix)
  const api = buildApi(ctx);
  app.use("/followup", api);
  app.use("/api/v1/followup", api);

  app.listen(env.port, () =>
    logger.info(`HTTP API listening on :${env.port}`)
  );
  return app;
}
