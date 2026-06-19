import { StateStore } from "../redis/stateStore";
import { TimerStore } from "../redis/timerStore";
import { ConfigProvider } from "../config/configProvider";
import { idleTimeoutToMs, TimerJob } from "../domain/types";
import { logger } from "../utils/logger";

/**
 * Scheduler turns a session's "last activity" into ZSET timer entries.
 * Reschedule on every message = one ZADD per step (overwrites prior score),
 * computed from the true last-user-message time so the timer fires exactly
 * idleTimeout after the user's last message.
 */
export class Scheduler {
  constructor(
    private state: StateStore,
    private timers: TimerStore,
    private config: ConfigProvider
  ) {}

  /** (Re)schedule all enabled steps for a session. */
  async scheduleForSession(
    chatflowId: string,
    trackingId: string,
    sessionId: string | undefined,
    lastUserMsgTime: number
  ): Promise<void> {
    const bundle = await this.config.getConfig(chatflowId);
    if (!bundle || !bundle.config.enabled || bundle.steps.length === 0) {
      return;
    }
    const { config, steps } = bundle;
    const now = Date.now();
    const scheduledAt = new Date(now).toISOString();

    for (const step of steps) {
      const intendedIdleMs = idleTimeoutToMs(
        step.idleTimeout,
        step.idleTimeoutUnit
      );
      const elapsed = now - lastUserMsgTime;
      const delay = Math.max(intendedIdleMs - elapsed, 1000);
      const fireAt = now + delay;

      const job: TimerJob = {
        chatflowId,
        trackingId,
        stepOrder: step.stepOrder,
        stepId: step.id,
        stepName: step.stepName || `Step ${step.stepOrder}`,
        idleTimeout: step.idleTimeout,
        idleTimeoutUnit: step.idleTimeoutUnit,
        webhookUrl: step.webhookUrl,
        webhookHeaders: step.webhookHeaders || undefined,
        maxMessages: config.maxMessages,
        includeSessionDetails: config.includeSessionDetails,
        maxFires: step.maxFires || 0,
        sessionId,
        scheduledAt,
        fireAt,
      };
      await this.timers.schedule(job);
    }
    logger.debug(
      `Scheduled ${steps.length} steps for ${chatflowId}:${trackingId}`
    );
  }

  /** Cancel all timers for a session. */
  async cancelForSession(
    chatflowId: string,
    trackingId: string
  ): Promise<void> {
    const bundle = await this.config.getConfig(chatflowId);
    const totalSteps = bundle?.steps.length || 20;
    await this.timers.cancelAll(chatflowId, trackingId, totalSteps);
  }
}
