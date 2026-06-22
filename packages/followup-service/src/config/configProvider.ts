import { Pool } from "pg";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { ConfigBundle, FollowUpConfig, FollowUpStep } from "../domain/types";

/**
 * ConfigProvider reads follow-up config + steps from Postgres.
 *
 * IMPORTANT: Postgres is touched only for admin CRUD and a periodic cache refresh —
 * never on the per-message or per-timer hot path. A tiny dedicated pool (default 4)
 * keeps it isolated from the shared application pool.
 */
export class ConfigProvider {
  private pool: Pool;
  private cache = new Map<string, ConfigBundle | null>();
  private allCache: ConfigBundle[] | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.pool = new Pool({
      host: env.pgHost,
      port: env.pgPort,
      user: env.pgUser,
      password: env.pgPassword,
      database: env.pgDatabase,
      ssl: env.pgSsl ? { rejectUnauthorized: false } : undefined,
      max: env.pgPoolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    this.pool.on("error", (err) =>
      logger.error("ConfigProvider pg pool error:", err.message),
    );
  }

  async start(): Promise<void> {
    await this.refreshAll();
    this.refreshTimer = setInterval(
      () => this.refreshAll().catch(() => {}),
      env.configRefreshMs,
    );
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    await this.pool.end();
  }

  /** Load all configs + steps into the in-process cache. */
  async refreshAll(): Promise<void> {
    const configs = await this.queryConfigs();
    const next = new Map<string, ConfigBundle | null>();
    const all: ConfigBundle[] = [];
    for (const config of configs) {
      const steps = await this.querySteps(config.id);
      const bundle = { config, steps };
      next.set(config.chatflowId, bundle);
      all.push(bundle);
    }
    this.cache = next;
    this.allCache = all;
  }

  /** Get config for a chatflow (from cache; falls back to DB on miss). */
  async getConfig(chatflowId: string): Promise<ConfigBundle | null> {
    if (this.cache.has(chatflowId)) return this.cache.get(chatflowId) || null;
    const config = await this.queryConfigByChatflow(chatflowId);
    if (!config) {
      this.cache.set(chatflowId, null);
      return null;
    }
    const steps = await this.querySteps(config.id);
    const bundle = { config, steps };
    this.cache.set(chatflowId, bundle);
    return bundle;
  }

  getAllCached(): ConfigBundle[] {
    return this.allCache || [];
  }

  invalidate(chatflowId: string): void {
    this.cache.delete(chatflowId);
  }

  // ==================== raw queries ====================

  private async queryConfigs(): Promise<FollowUpConfig[]> {
    const { rows } = await this.pool.query(
      `SELECT id, "chatflowId", enabled, "includeSessionDetails", "maxMessages",
              "chatIdFilterRegex", "createdDate", "updatedDate" FROM follow_up_config`,
    );
    return rows as FollowUpConfig[];
  }

  private async queryConfigByChatflow(
    chatflowId: string,
  ): Promise<FollowUpConfig | null> {
    const { rows } = await this.pool.query(
      `SELECT id, "chatflowId", enabled, "includeSessionDetails", "maxMessages",
              "chatIdFilterRegex", "createdDate", "updatedDate" FROM follow_up_config WHERE "chatflowId" = $1 LIMIT 1`,
      [chatflowId],
    );
    return (rows[0] as FollowUpConfig) || null;
  }

  private async querySteps(configId: string): Promise<FollowUpStep[]> {
    const { rows } = await this.pool.query(
      `SELECT id, "configId", "chatflowId", "stepOrder", "stepName", "idleTimeout",
              "idleTimeoutUnit", "webhookUrl", "webhookHeaders", "maxFires",
              "createdDate", "updatedDate"
       FROM follow_up_step WHERE "configId" = $1 ORDER BY "stepOrder" ASC`,
      [configId],
    );
    return rows as FollowUpStep[];
  }

  /** Expose the pool for the admin CRUD service. */
  getPool(): Pool {
    return this.pool;
  }
}
