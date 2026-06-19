import { TimerStore } from "../redis/timerStore";
import { Worker } from "../worker/processor";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { TimerJob } from "../domain/types";

/**
 * Poller claims due timers from the ZSET (atomic, multi-instance safe) and
 * dispatches them to the worker with bounded concurrency.
 *
 * New with P0 additions:
 *  - `rate_limited` ⇒ re-schedule the timer for 5s later (don't drop it).
 *  - tracks active worker count for health monitoring.
 */
export class Poller {
  private running = false;
  inFlight = 0; // public so HealthMonitor can read it

  constructor(
    private timers: TimerStore,
    private worker: Worker
  ) {}

  start(): void {
    this.running = true;
    this.loop().catch((e) => logger.error("Poller loop crashed:", e));
    logger.info(
      `Poller started (interval=${env.pollIntervalMs}ms, batch=${env.pollBatchSize}, concurrency=${env.workerConcurrency})`
    );
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const drained = await this.drainOnce();
        if (!drained) {
          await this.sleep(env.pollIntervalMs);
        }
      } catch (e) {
        logger.error("Poll error:", e);
        await this.sleep(env.pollIntervalMs);
      }
    }
  }

  /** Claim one batch and process it. Returns true if anything was claimed. */
  private async drainOnce(): Promise<boolean> {
    // Respect concurrency: don't claim more than we can run.
    const capacity = env.workerConcurrency - this.inFlight;
    if (capacity <= 0) {
      await this.sleep(50);
      return true;
    }
    const count = Math.min(env.pollBatchSize, capacity);
    const jobs = await this.timers.claimDue(Date.now(), count);
    if (jobs.length === 0) return false;

    await this.runWithConcurrency(jobs);
    return true;
  }

  private async runWithConcurrency(jobs: TimerJob[]): Promise<void> {
    const queue = [...jobs];
    const runNext = async (): Promise<void> => {
      const job = queue.shift();
      if (!job) return;
      this.inFlight++;
      try {
        const result = await this.worker.process(job);
        if (result === "rate_limited") {
          // Re-schedule the timer for a few seconds later so it gets another chance.
          job.fireAt = Date.now() + 5000;
          await this.timers.schedule(job);
          logger.debug(
            `[Poller] rate-limited ${job.chatflowId}:${job.trackingId} step ${job.stepOrder}, re-scheduled +5s`
          );
        }
      } catch (e) {
        logger.warn(
          `[Poller] Worker failed for ${job.chatflowId}:${job.trackingId} step ${job.stepOrder}:`,
          e
        );
      } finally {
        this.inFlight--;
      }
      await runNext();
    };

    const lanes = Math.min(env.workerConcurrency, jobs.length);
    await Promise.all(Array.from({ length: lanes }, () => runNext()));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
