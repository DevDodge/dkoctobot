import { Redis } from "ioredis";
import { getRedis } from "./client";
import { keys, timerMember } from "./keys";
import { TimerJob } from "../domain/types";

/**
 * TimerStore manages the due-timer ZSET and an atomic claim of due timers.
 *
 * - schedule(): single ZADD (reschedule = overwrite score), plus HSET of job data.
 *   Replaces the old cancel-all + re-add-per-step churn.
 * - claimDue(): atomically pops up to `count` members whose score <= now using a
 *   Lua script, so multiple service instances never fire the same timer twice.
 */
export class TimerStore {
  private r: Redis;

  // Lua: pop up to N members with score <= now, removing them from the ZSET
  // and returning their members. Atomic across instances.
  private static CLAIM_LUA = `
    local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
    if #due > 0 then
      redis.call('ZREM', KEYS[1], unpack(due))
    end
    return due
  `;

  constructor(redis?: Redis) {
    this.r = redis || getRedis();
  }

  /** Schedule (or reschedule) a timer. Overwrites any existing entry for the key. */
  async schedule(job: TimerJob): Promise<void> {
    const member = timerMember(job.chatflowId, job.trackingId, job.stepOrder);
    const pipe = this.r.pipeline();
    pipe.zadd(keys.timers, job.fireAt.toString(), member);
    pipe.hset(keys.timerJobs, member, JSON.stringify(job));
    await pipe.exec();
  }

  /** Remove a single timer (step) for a session. */
  async cancel(
    chatflowId: string,
    trackingId: string,
    stepOrder: number
  ): Promise<void> {
    const member = timerMember(chatflowId, trackingId, stepOrder);
    const pipe = this.r.pipeline();
    pipe.zrem(keys.timers, member);
    pipe.hdel(keys.timerJobs, member);
    await pipe.exec();
  }

  /** Remove all timers for a session (steps 1..totalSteps). */
  async cancelAll(
    chatflowId: string,
    trackingId: string,
    totalSteps: number
  ): Promise<void> {
    const members: string[] = [];
    for (let s = 1; s <= totalSteps; s++) {
      members.push(timerMember(chatflowId, trackingId, s));
    }
    if (members.length === 0) return;
    const pipe = this.r.pipeline();
    pipe.zrem(keys.timers, ...members);
    pipe.hdel(keys.timerJobs, ...members);
    await pipe.exec();
  }

  /** Atomically claim due timers (members) and load their job data. */
  async claimDue(now: number, count: number): Promise<TimerJob[]> {
    const members = (await this.r.eval(
      TimerStore.CLAIM_LUA,
      1,
      keys.timers,
      now.toString(),
      count.toString()
    )) as string[];

    if (!members || members.length === 0) return [];

    const raw = await this.r.hmget(keys.timerJobs, ...members);
    // Clean up the job-data hash for claimed members.
    await this.r.hdel(keys.timerJobs, ...members);

    const jobs: TimerJob[] = [];
    for (const item of raw) {
      if (!item) continue;
      try {
        jobs.push(JSON.parse(item));
      } catch {
        /* skip malformed */
      }
    }
    return jobs;
  }

  /** Count pending timers (optionally for a chatflow — full scan, used by dashboard). */
  async pendingCount(): Promise<number> {
    return await this.r.zcard(keys.timers);
  }

  /** Return pending jobs for dashboard (paginated by score order). */
  async pendingJobs(start: number, end: number): Promise<TimerJob[]> {
    const members = await this.r.zrange(keys.timers, start, end);
    if (members.length === 0) return [];
    const raw = await this.r.hmget(keys.timerJobs, ...members);
    const jobs: TimerJob[] = [];
    for (const item of raw) {
      if (!item) continue;
      try {
        jobs.push(JSON.parse(item));
      } catch {
        /* skip */
      }
    }
    return jobs;
  }
}
