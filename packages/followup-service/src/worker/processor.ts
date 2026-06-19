import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";
import { StateStore } from "../redis/stateStore";
import { insertLog } from "../clickhouse/client";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { CircuitBreaker, CircuitOpenError } from "./circuitBreaker";
import { WebhookRateLimiter } from "./rateLimiter";
import {
  FollowUpLogRow,
  idleTimeoutToMs,
  LogStatus,
  TimerJob,
} from "../domain/types";

/**
 * Processes a fired timer:
 *  Defense 0a: Webhook rate limiter (per-chatflow sliding window)
 *  Defense 0b: Circuit breaker (skip dead endpoints)
 *  Defense 1: Redis cancel flag (a newer message arrived)
 *  Defense 2: maxFires counter (Redis INCR, not a Postgres COUNT)
 *  Defense 3: true-idle re-check from cached last-message time
 *  Then: build payload from cached messages, POST webhook (retry/backoff),
 *        write result to ClickHouse, bump fire counter.
 */
export class Worker {
  private breaker: CircuitBreaker;
  private rateLimiter: WebhookRateLimiter;

  constructor(
    private state: StateStore,
    breaker?: CircuitBreaker,
    rateLimiter?: WebhookRateLimiter
  ) {
    this.breaker = breaker || new CircuitBreaker();
    this.rateLimiter = rateLimiter || new WebhookRateLimiter();
  }

  /** Public accessors for health monitoring. */
  get circuitBreaker() {
    return this.breaker;
  }
  get webhookRateLimiter() {
    return this.rateLimiter;
  }

  /**
   * Process a timer job. Returns 'sent' | 'skipped' | 'rate_limited' | 'circuit_open' | 'failed'.
   * 'rate_limited' means the caller should re-schedule the timer for later.
   */
  async process(
    job: TimerJob
  ): Promise<"sent" | "skipped" | "rate_limited" | "failed"> {
    const firedAt = new Date();
    const { chatflowId, trackingId, stepOrder } = job;

    // Defense 1: cancel flag
    if (await this.state.hasCancelFlag(chatflowId, trackingId)) {
      await this.logSkipped(job, firedAt, "cancelled_by_flag");
      return "skipped";
    }

    // Defense 2: maxFires (O(1) counter)
    if (job.maxFires && job.maxFires > 0) {
      const fired = await this.state.getFireCount(
        chatflowId,
        trackingId,
        stepOrder
      );
      if (fired >= job.maxFires) {
        await this.logSkipped(
          job,
          firedAt,
          `max_fires_reached_${fired}_of_${job.maxFires}`
        );
        return "skipped";
      }
    }

    // Defense 3: true-idle re-check
    const lastMsgTime = await this.state.getLastMessageTime(
      chatflowId,
      trackingId
    );
    if (lastMsgTime) {
      const idleMs = idleTimeoutToMs(job.idleTimeout, job.idleTimeoutUnit);
      if (firedAt.getTime() - lastMsgTime < idleMs) {
        await this.logSkipped(job, firedAt, "user_active", lastMsgTime);
        return "skipped";
      }
    }

    // Defense 0a: rate limiter — prevent webhook storms per chatflow.
    if (!(await this.rateLimiter.acquire(chatflowId))) {
      logger.debug(
        `[Worker] rate-limited ${chatflowId}, re-scheduling timer for step ${stepOrder}`
      );
      return "rate_limited";
    }

    // Build payload from cached messages (oldest → newest)
    const messages = await this.state.getMessages(
      chatflowId,
      trackingId,
      job.maxMessages || 10
    );
    const lastMessageAt =
      messages.length > 0 ? messages[messages.length - 1].createdDate : null;

    const payload = {
      event: "session_idle",
      chatflowId,
      chatId: trackingId,
      sessionId: job.sessionId || null,
      step: {
        id: job.stepId,
        name: job.stepName,
        order: job.stepOrder,
        idleTimeout: job.idleTimeout,
        idleTimeoutUnit: job.idleTimeoutUnit,
      },
      lastMessageAt,
      firedAt: firedAt.toISOString(),
      scheduledAt: job.scheduledAt,
      lastMessages: messages,
    };

    // Defense 0b: circuit breaker — skip dead endpoints.
    let status: LogStatus;
    let responseStatus: number | null = null;
    let responseBody = "";
    let errorMessage = "";

    try {
      const result = await this.breaker.call(job.webhookUrl, () =>
        this.sendWebhook(job, payload)
      );
      status = result.status;
      responseStatus = result.responseStatus;
      responseBody = result.responseBody;
      errorMessage = result.errorMessage;
    } catch (e) {
      if (e instanceof CircuitOpenError) {
        logger.info(
          `[Worker] Circuit open for ${job.webhookUrl}, skipping webhook for ${chatflowId} step ${stepOrder}`
        );
        await this.logSkipped(job, firedAt, `circuit_open: ${e.message}`);
        return "skipped";
      }
      throw e; // unexpected — let poller catch
    }

    if (status === "sent") {
      await this.state.incrFireCount(chatflowId, trackingId, stepOrder);
    }

    await this.writeLog({
      job,
      status,
      payload: JSON.stringify(payload),
      responseStatus,
      responseBody,
      errorMessage,
      lastMessageAt,
      firedAt,
      retryCount: status === "sent" ? 0 : env.webhookMaxRetries,
    });

    return status === "sent" ? "sent" : "failed";
  }

  private async sendWebhook(
    job: TimerJob,
    payload: unknown
  ): Promise<{
    status: LogStatus;
    responseStatus: number | null;
    responseBody: string;
    errorMessage: string;
  }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (job.webhookHeaders) {
      try {
        Object.assign(headers, JSON.parse(job.webhookHeaders));
      } catch {
        /* ignore bad headers JSON */
      }
    }
    const body = JSON.stringify(payload);

    let lastErr = "";
    for (let attempt = 0; attempt <= env.webhookMaxRetries; attempt++) {
      try {
        const response = await fetch(job.webhookUrl, {
          method: "POST",
          headers,
          body,
          timeout: env.webhookTimeoutMs,
        });
        const text = await response.text();
        if (response.ok) {
          return {
            status: "sent",
            responseStatus: response.status,
            responseBody: text.substring(0, 5000),
            errorMessage: "",
          };
        }
        lastErr = `HTTP ${response.status}: ${text.substring(0, 500)}`;
        // 4xx (except 429) won't improve on retry
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          return {
            status: "failed",
            responseStatus: response.status,
            responseBody: text.substring(0, 5000),
            errorMessage: lastErr,
          };
        }
      } catch (e: any) {
        lastErr = e?.message || "Unknown error";
      }
      if (attempt < env.webhookMaxRetries) {
        await this.backoff(attempt);
      }
    }
    return {
      status: "failed",
      responseStatus: null,
      responseBody: "",
      errorMessage: lastErr,
    };
  }

  private backoff(attempt: number): Promise<void> {
    const ms = Math.min(1000 * Math.pow(2, attempt), 15000);
    return new Promise((r) => setTimeout(r, ms));
  }

  private async logSkipped(
    job: TimerJob,
    firedAt: Date,
    reason: string,
    lastMsgTime?: number
  ): Promise<void> {
    await this.writeLog({
      job,
      status: "cancelled",
      payload: "",
      responseStatus: null,
      responseBody: "",
      errorMessage: `Skipped: ${reason}`,
      lastMessageAt: lastMsgTime ? new Date(lastMsgTime).toISOString() : null,
      firedAt,
      retryCount: 0,
    });
  }

  private async writeLog(args: {
    job: TimerJob;
    status: LogStatus;
    payload: string;
    responseStatus: number | null;
    responseBody: string;
    errorMessage: string;
    lastMessageAt: string | null;
    firedAt: Date;
    retryCount: number;
  }): Promise<void> {
    const { job } = args;
    const row: FollowUpLogRow = {
      id: uuidv4(),
      chatflowId: job.chatflowId,
      chatId: job.trackingId,
      stepId: job.stepId || "",
      stepName: job.stepName || "",
      stepOrder: job.stepOrder || 0,
      status: args.status,
      webhookUrl: job.webhookUrl || "",
      payload: args.payload,
      responseStatus: args.responseStatus,
      responseBody: args.responseBody,
      errorMessage: args.errorMessage,
      idleTimeout: job.idleTimeout || 0,
      idleTimeoutUnit: job.idleTimeoutUnit || "minutes",
      lastMessageAt: args.lastMessageAt
        ? this.toCH(args.lastMessageAt)
        : null,
      firedAt: this.toCH(args.firedAt.toISOString()),
      createdDate: this.toCH(new Date().toISOString()),
      retryCount: args.retryCount,
    };
    try {
      await insertLog(row);
    } catch (e) {
      logger.error("ClickHouse insert failed:", e);
    }
  }

  /** ClickHouse DateTime64 prefers 'YYYY-MM-DD HH:MM:SS.mmm'. */
  private toCH(iso: string): string {
    return iso.replace("T", " ").replace("Z", "");
  }
}
