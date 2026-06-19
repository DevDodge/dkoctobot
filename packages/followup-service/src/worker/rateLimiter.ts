import { Redis } from "ioredis";
import { getRedis } from "../redis/client";

/**
 * Per-chatflow sliding-window rate limiter for webhook sends.
 * Prevents sending more than `maxPerSecond` webhooks per second to the same
 * chatflow, avoiding accidental DDoS on client endpoints when many sessions
 * share the same idle timeout.
 *
 * Uses Redis ZSET for the sliding window — each webhook is a member with the
 * score = timestamp. Old members are trimmed on each check.
 */
export class WebhookRateLimiter {
  private redis: Redis;
  private readonly maxPerSecond: number;
  private readonly windowMs: number;

  constructor(maxPerSecond?: number, windowMs = 1000) {
    this.redis = getRedis();
    this.maxPerSecond = maxPerSecond ?? parseInt(process.env.FOLLOWUP_MAX_WEBHOOKS_PER_SECOND || "100", 10);
    this.windowMs = windowMs;
  }

  /**
   * Try to acquire a send slot for this chatflow.
   * Returns true if allowed, false if the rate limit is hit.
   * When false, the caller should re-schedule the timer for a later fireAt.
   */
  async acquire(chatflowId: string): Promise<boolean> {
    const key = `followup:ratelimit:${chatflowId}`;
    const now = Date.now();
    const cutoff = now - this.windowMs;

    // Trim old entries (outside the window).
    await this.redis.zremrangebyscore(key, "-inf", cutoff.toString());

    // Count current window.
    const count = await this.redis.zcard(key);
    if (count >= this.maxPerSecond) return false;

    // Record this request. Use a unique member so no collision.
    const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const pipe = this.redis.pipeline();
    pipe.zadd(key, now.toString(), member);
    pipe.expire(key, Math.ceil(this.windowMs / 1000) + 1);
    await pipe.exec();
    return true;
  }

  /** Current count for a chatflow (for monitoring). */
  async currentCount(chatflowId: string): Promise<number> {
    return await this.redis.zcard(`followup:ratelimit:${chatflowId}`);
  }
}
