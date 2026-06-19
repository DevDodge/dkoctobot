import { createClient, ClickHouseClient } from "@clickhouse/client";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { FollowUpLogRow } from "../domain/types";

let client: ClickHouseClient | null = null;

export function getClickHouse(): ClickHouseClient {
  if (client) return client;
  client = createClient({
    url: env.clickhouseUrl,
    username: env.clickhouseUser,
    password: env.clickhousePassword,
    database: env.clickhouseDb,
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,
    },
  });
  return client;
}

/** Create the database + table (idempotent). Called once on boot. */
export async function ensureSchema(): Promise<void> {
  // The client targets `env.clickhouseDb`; create it via a default-db client first.
  const bootstrap = createClient({
    url: env.clickhouseUrl,
    username: env.clickhouseUser,
    password: env.clickhousePassword,
  });
  await bootstrap.command({
    query: `CREATE DATABASE IF NOT EXISTS ${env.clickhouseDb}`,
  });
  await bootstrap.close();

  const ch = getClickHouse();
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS follow_up_log (
        id             String,
        chatflowId     String,
        chatId         String,
        stepId         String,
        stepName       String,
        stepOrder      UInt16,
        status         LowCardinality(String),
        webhookUrl     String,
        payload        String,
        responseStatus Nullable(UInt16),
        responseBody   String,
        errorMessage   String,
        idleTimeout    UInt32,
        idleTimeoutUnit LowCardinality(String),
        lastMessageAt  Nullable(DateTime64(3)),
        firedAt        DateTime64(3),
        createdDate    DateTime64(3) DEFAULT now64(3),
        retryCount     UInt16 DEFAULT 0
      ) ENGINE = MergeTree()
      PARTITION BY toYYYYMMDD(firedAt)
      ORDER BY (chatflowId, chatId, firedAt)
      TTL toDateTime(firedAt) + INTERVAL ${env.logRetentionDays} DAY
    `,
  });
  logger.info(
    `ClickHouse schema ready (db=${env.clickhouseDb}, retention=${env.logRetentionDays}d)`
  );
}

export async function insertLog(row: FollowUpLogRow): Promise<void> {
  const ch = getClickHouse();
  await ch.insert({
    table: "follow_up_log",
    values: [row],
    format: "JSONEachRow",
  });
}

export async function closeClickHouse(): Promise<void> {
  await client?.close();
  client = null;
}
