import { Redis } from "ioredis";
import { getRedis } from "./client";
import { keys, timerMember } from "./keys";
import { env } from "../config/env";
import { CachedMessage, TimerJob } from "../domain/types";

/**
 * StateStore: all hot-path state lives in the dedicated Redis.
 * No Postgres is touched here. Timers are a ZSET (score = fireAt ms),
 * so reschedule is a single ZADD — no cancel+re-add churn.
 */
export class StateStore {
  private r: Redis;

  constructor(redis?: Redis) {
    this.r = redis || getRedis();
  }

  // ==================== Message cache ====================

  /** Append a message to the capped per-session list and record last-msg time. */
  async recordMessage(
    chatflowId: string,
    trackingId: string,
    msg: CachedMessage,
    isUserMessage: boolean,
    ts: number
  ): Promise<void> {
    const listKey = keys.msgs(chatflowId, trackingId);
    const pipe = this.r.pipeline();
    pipe.rpush(listKey, JSON.stringify(msg));
    pipe.ltrim(listKey, -env.maxCachedMessages, -1);
    pipe.expire(listKey, env.msgCacheTtlSeconds);
    if (isUserMessage) {
      pipe.set(
        keys.lastMsg(chatflowId, trackingId),
        ts.toString(),
        "EX",
        env.msgCacheTtlSeconds
      );
    }
    await pipe.exec();
  }

  /** Get last N cached messages (oldest → newest). */
  async getMessages(
    chatflowId: string,
    trackingId: string,
    limit: number
  ): Promise<CachedMessage[]> {
    const listKey = keys.msgs(chatflowId, trackingId);
    const raw = await this.r.lrange(listKey, -limit, -1);
    const out: CachedMessage[] = [];
    for (const item of raw) {
      try {
        out.push(JSON.parse(item));
      } catch {
        /* skip malformed */
      }
    }
    return out;
  }

  async getLastMessageTime(
    chatflowId: string,
    trackingId: string
  ): Promise<number | null> {
    const v = await this.r.get(keys.lastMsg(chatflowId, trackingId));
    return v ? parseInt(v, 10) : null;
  }

  // ==================== Cancel flag ====================

  async setCancelFlag(chatflowId: string, trackingId: string): Promise<void> {
    await this.r.set(
      keys.cancel(chatflowId, trackingId),
      "1",
      "EX",
      env.cancelFlagTtlSeconds
    );
  }

  async hasCancelFlag(
    chatflowId: string,
    trackingId: string
  ): Promise<boolean> {
    const v = await this.r.get(keys.cancel(chatflowId, trackingId));
    return v === "1";
  }

  async clearCancelFlag(chatflowId: string, trackingId: string): Promise<void> {
    await this.r.del(keys.cancel(chatflowId, trackingId));
  }

  // ==================== maxFires counter (replaces COUNT query) ====================

  async getFireCount(
    chatflowId: string,
    trackingId: string,
    stepOrder: number
  ): Promise<number> {
    const v = await this.r.get(keys.fires(chatflowId, trackingId, stepOrder));
    return v ? parseInt(v, 10) : 0;
  }

  async incrFireCount(
    chatflowId: string,
    trackingId: string,
    stepOrder: number
  ): Promise<number> {
    const key = keys.fires(chatflowId, trackingId, stepOrder);
    const n = await this.r.incr(key);
    await this.r.expire(key, env.fireCounterTtlSeconds);
    return n;
  }
}
