import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { ConfigProvider } from "../config/configProvider";
import { ConfigBundle, FollowUpConfig, FollowUpStep } from "../domain/types";

/**
 * Admin CRUD for follow-up config + steps. Writes go to Postgres (rare, admin-only).
 * After any write we invalidate the provider cache so the hot path picks it up.
 */
export class ConfigAdmin {
  private pool: Pool;

  constructor(private provider: ConfigProvider) {
    this.pool = provider.getPool();
  }

  async upsert(
    chatflowId: string,
    configData: Partial<FollowUpConfig>,
    stepsData: Array<Partial<FollowUpStep>>
  ): Promise<ConfigBundle> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT * FROM follow_up_config WHERE "chatflowId" = $1 LIMIT 1`,
        [chatflowId]
      );

      let configId: string;
      if (existing.rows[0]) {
        configId = existing.rows[0].id;
        await client.query(
          `UPDATE follow_up_config
           SET enabled = $1, "includeSessionDetails" = $2, "maxMessages" = $3,
               "updatedDate" = now()
           WHERE id = $4`,
          [
            configData.enabled ?? existing.rows[0].enabled,
            configData.includeSessionDetails ??
              existing.rows[0].includeSessionDetails,
            configData.maxMessages ?? existing.rows[0].maxMessages,
            configId,
          ]
        );
      } else {
        configId = uuidv4();
        await client.query(
          `INSERT INTO follow_up_config
             (id, "chatflowId", enabled, "includeSessionDetails", "maxMessages",
              "createdDate", "updatedDate")
           VALUES ($1, $2, $3, $4, $5, now(), now())`,
          [
            configId,
            chatflowId,
            configData.enabled ?? false,
            configData.includeSessionDetails ?? true,
            configData.maxMessages ?? 10,
          ]
        );
      }

      // Replace steps
      await client.query(`DELETE FROM follow_up_step WHERE "configId" = $1`, [
        configId,
      ]);
      for (let i = 0; i < stepsData.length; i++) {
        const s = stepsData[i];
        await client.query(
          `INSERT INTO follow_up_step
             (id, "configId", "chatflowId", "stepOrder", "stepName", "idleTimeout",
              "idleTimeoutUnit", "webhookUrl", "webhookHeaders", "maxFires",
              "createdDate", "updatedDate")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())`,
          [
            uuidv4(),
            configId,
            chatflowId,
            i + 1,
            s.stepName || `Step ${i + 1}`,
            s.idleTimeout || 30,
            s.idleTimeoutUnit || "minutes",
            s.webhookUrl || "",
            s.webhookHeaders || null,
            s.maxFires || 0,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    this.provider.invalidate(chatflowId);
    const bundle = await this.provider.getConfig(chatflowId);
    return bundle as ConfigBundle;
  }

  async delete(chatflowId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `SELECT id FROM follow_up_config WHERE "chatflowId" = $1 LIMIT 1`,
        [chatflowId]
      );
      if (res.rows[0]) {
        await client.query(`DELETE FROM follow_up_step WHERE "configId" = $1`, [
          res.rows[0].id,
        ]);
        await client.query(`DELETE FROM follow_up_config WHERE id = $1`, [
          res.rows[0].id,
        ]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    this.provider.invalidate(chatflowId);
  }
}
