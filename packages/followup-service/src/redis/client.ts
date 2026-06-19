import IORedis, { Redis } from "ioredis";
import { env } from "../config/env";
import { logger } from "../utils/logger";

let client: Redis | null = null;

/**
 * Dedicated Redis client for the follow-up service.
 * Separate instance from Flowise's Redis (own host/port/url via FOLLOWUP_REDIS_* env).
 */
export function getRedis(): Redis {
  if (client) return client;

  if (env.redisUrl) {
    client = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  } else {
    client = new IORedis({
      host: env.redisHost,
      port: env.redisPort,
      username: env.redisUsername,
      password: env.redisPassword,
      maxRetriesPerRequest: null,
    });
  }

  client.on("error", (err) => logger.error("Redis error:", err.message));
  client.on("connect", () => logger.info("Redis connected"));
  return client;
}

/**
 * A second connection for blocking stream reads (XREADGROUP BLOCK must not
 * share a connection with regular commands).
 */
let blockingClient: Redis | null = null;

export function getBlockingRedis(): Redis {
  if (blockingClient) return blockingClient;
  if (env.redisUrl) {
    blockingClient = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  } else {
    blockingClient = new IORedis({
      host: env.redisHost,
      port: env.redisPort,
      username: env.redisUsername,
      password: env.redisPassword,
      maxRetriesPerRequest: null,
    });
  }
  blockingClient.on("error", (err) =>
    logger.error("Redis (blocking) error:", err.message)
  );
  return blockingClient;
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([client?.quit(), blockingClient?.quit()]);
  client = null;
  blockingClient = null;
}
