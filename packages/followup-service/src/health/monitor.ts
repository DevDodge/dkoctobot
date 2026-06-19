import { Request, Response } from "express";
import { getRedis } from "../redis/client";
import { getClickHouse } from "../clickhouse/client";
import { logger } from "../utils/logger";

export interface HealthSnapshot {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number; // seconds
  redis: { state: "up" | "down"; latencyMs: number };
  clickhouse: { state: "up" | "down" };
  consumer: { lag: number; lastEventAgeMs: number };
  timers: { pending: number; zsetSizeBytes: number | null };
  workers: { active: number };
  memoryGuard: { degraded: boolean; zsetSize: number };
  circuitBreaker: { open: number; halfOpen: number; closed: number };
  rateLimiter: { totalActive: number };
  process: { memoryMB: number; cpuPercent?: number; pid: number };
}

export class HealthMonitor {
  private startTime: number;
  private redisDownSince = 0;
  private autoRestartMs: number;

  // Gauges that other components update directly.
  consumerLag = 0;
  lastEventTs = 0;
  activeWorkers = 0;
  memoryGuardDegraded = false;

  constructor(
    autoRestartMs = parseInt(process.env.FOLLOWUP_AUTO_RESTART_MS || "300000", 10)
  ) {
    this.startTime = Date.now();
    this.autoRestartMs = autoRestartMs;
  }

  async snapshot(): Promise<HealthSnapshot> {
    const redisStart = Date.now();
    let redisState: "up" | "down" = "up";
    let redisLatency = 0;
    try {
      const r = getRedis();
      const pong = await r.ping();
      redisLatency = Date.now() - redisStart;
      if (pong !== "PONG") throw new Error("bad pong");
    } catch {
      redisState = "down";
      redisLatency = Date.now() - redisStart;
    }

    let chState: "up" | "down" = "up";
    try {
      await getClickHouse().ping();
    } catch {
      chState = "down";
    }

    // Timer stats
    let timerPending = 0;
    try {
      const r = getRedis();
      timerPending = await r.zcard("followup:timers");
    } catch { /* redis down */ }

    let zsetSizeBytes: number | null = null;
    try {
      const r = getRedis();
      const mem = (await r.info("memory")) as string;
      const match = mem.match(/used_memory_dataset:(\d+)/);
      if (match) zsetSizeBytes = parseInt(match[1], 10);
    } catch { /* */ }

    const memUsage = process.memoryUsage();
    const status = this.computeStatus(redisState, chState, timerPending);
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      status,
      uptime,
      redis: { state: redisState, latencyMs: redisLatency },
      clickhouse: { state: chState },
      consumer: {
        lag: this.consumerLag,
        lastEventAgeMs: this.lastEventTs ? Date.now() - this.lastEventTs : 0,
      },
      timers: { pending: timerPending, zsetSizeBytes },
      workers: { active: this.activeWorkers },
      memoryGuard: { degraded: this.memoryGuardDegraded, zsetSize: timerPending },
      circuitBreaker: { open: 0, halfOpen: 0, closed: 0 }, // populated later
      rateLimiter: { totalActive: 0 }, // populated later
      process: {
        memoryMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        pid: process.pid,
      },
    };
  }

  private computeStatus(
    redis: "up" | "down",
    ch: "up" | "down",
    timerPending: number
  ): "healthy" | "degraded" | "unhealthy" {
    if (redis === "down") return "unhealthy";
    if (ch === "down") return "degraded";
    if (timerPending > 5_000_000) return "degraded";
    return "healthy";
  }

  /** Called periodically. Handles auto-restart logic. */
  async check(): Promise<HealthSnapshot> {
    const snap = await this.snapshot();

    // Track Redis downtime for auto-restart.
    if (snap.redis.state === "down") {
      if (this.redisDownSince === 0) {
        this.redisDownSince = Date.now();
        logger.error("[HealthMonitor] Redis DOWN detected");
      }
    } else {
      if (this.redisDownSince > 0) {
        logger.info("[HealthMonitor] Redis recovered");
      }
      this.redisDownSince = 0;
    }

    if (
      this.redisDownSince > 0 &&
      Date.now() - this.redisDownSince > this.autoRestartMs
    ) {
      logger.error(
        `[HealthMonitor] Redis down for ${Math.floor((Date.now() - this.redisDownSince) / 1000)}s — triggering restart`
      );
      process.exit(1); // orchestrator restarts
    }

    return snap;
  }

  /** Express middleware/handler for GET /health */
  get handler() {
    return async (_req: Request, res: Response) => {
      const snap = await this.snapshot();
      res.status(snap.status === "unhealthy" ? 503 : 200).json(snap);
    };
  }

  /** Express handler for GET /metrics (Prometheus text format) */
  get metricsHandler() {
    return async (_req: Request, res: Response) => {
      const snap = await this.snapshot();
      const lines: string[] = [
        "# HELP followup_up Service health (1=healthy, 0.5=degraded, 0=unhealthy)",
        "# TYPE followup_up gauge",
        `followup_up ${snap.status === "healthy" ? 1 : snap.status === "degraded" ? 0.5 : 0}`,
        "",
        "# HELP followup_uptime_seconds Service uptime",
        "# TYPE followup_uptime_seconds gauge",
        `followup_uptime_seconds ${snap.uptime}`,
        "",
        "# HELP followup_redis_up Redis connected (1 or 0)",
        "# TYPE followup_redis_up gauge",
        `followup_redis_up ${snap.redis.state === "up" ? 1 : 0}`,
        "",
        "# HELP followup_redis_latency_ms Redis ping latency",
        "# TYPE followup_redis_latency_ms gauge",
        `followup_redis_latency_ms ${snap.redis.latencyMs}`,
        "",
        "# HELP followup_clickhouse_up ClickHouse connected (1 or 0)",
        "# TYPE followup_clickhouse_up gauge",
        `followup_clickhouse_up ${snap.clickhouse.state === "up" ? 1 : 0}`,
        "",
        "# HELP followup_consumer_lag Stream consumer lag (events)",
        "# TYPE followup_consumer_lag gauge",
        `followup_consumer_lag ${snap.consumer.lag}`,
        "",
        "# HELP followup_consumer_last_event_age_ms Age of last event in ms",
        "# TYPE followup_consumer_last_event_age_ms gauge",
        `followup_consumer_last_event_age_ms ${snap.consumer.lastEventAgeMs}`,
        "",
        "# HELP followup_timers_pending Pending timers in ZSET",
        "# TYPE followup_timers_pending gauge",
        `followup_timers_pending ${snap.timers.pending}`,
        "",
        "# HELP followup_workers_active Active worker count",
        "# TYPE followup_workers_active gauge",
        `followup_workers_active ${snap.workers.active}`,
        "",
        "# HELP followup_memory_guard_degraded Memory guard degraded (1 or 0)",
        "# TYPE followup_memory_guard_degraded gauge",
        `followup_memory_guard_degraded ${snap.memoryGuard.degraded ? 1 : 0}`,
        "",
        "# HELP followup_circuit_breakers_open Open circuit breakers",
        "# TYPE followup_circuit_breakers_open gauge",
        `followup_circuit_breakers_open ${snap.circuitBreaker.open}`,
        "",
        "# HELP followup_process_memory_mb Process heap memory MB",
        "# TYPE followup_process_memory_mb gauge",
        `followup_process_memory_mb ${snap.process.memoryMB}`,
        "",
      ];
      res.set("Content-Type", "text/plain; version=0.0.4");
      res.send(lines.join("\n"));
    };
  }
}
