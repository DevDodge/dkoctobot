import { Queue, Worker, Job, RedisOptions } from "bullmq";
import IORedis from "ioredis";
import { DataSource } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";
import logger from "../utils/logger";
import { FollowUpLog } from "../database/entities/FollowUpLog";

const FOLLOWUP_WORKER_CONCURRENCY = process.env.FOLLOWUP_WORKER_CONCURRENCY
  ? parseInt(process.env.FOLLOWUP_WORKER_CONCURRENCY)
  : 50;

// Cancel flag TTL: 5 minutes (covers race condition window for any timeout)
const CANCEL_FLAG_TTL_SECONDS = 300;

// Last message tracking TTL: 24 hours
const LAST_MSG_TTL_SECONDS = 86400;

export interface FollowUpJobData {
  chatflowId: string;
  chatId: string;
  sessionId?: string;
  stepId: string;
  stepOrder: number;
  stepName: string;
  idleTimeout: number;
  idleTimeoutUnit: string;
  webhookUrl: string;
  webhookHeaders?: string; // JSON string
  maxMessages: number;
  includeSessionDetails: boolean;
  scheduledAt: string;
  maxFires: number; // 0 = unlimited, 1+ = max webhook fires per session for this step
}

/**
 * Convert idle timeout + unit to milliseconds
 */
export function idleTimeoutToMs(timeout: number, unit: string): number {
  switch (unit) {
    case "minutes":
      return timeout * 60 * 1000;
    case "hours":
      return timeout * 60 * 60 * 1000;
    case "days":
      return timeout * 24 * 60 * 60 * 1000;
    default:
      return timeout * 60 * 1000;
  }
}

/**
 * Generate a deterministic job ID for a follow-up step
 */
export function getFollowUpJobId(
  chatflowId: string,
  chatId: string,
  stepOrder: number
): string {
  return `followup:${chatflowId}:${chatId}:step${stepOrder}`;
}

export class FollowUpQueue {
  private queue: Queue;
  private worker: Worker | null = null;
  private connection: RedisOptions;
  private appDataSource: DataSource;
  private redisClient: IORedis | null = null;

  constructor(
    queueName: string,
    connection: RedisOptions,
    appDataSource: DataSource
  ) {
    this.connection = connection;
    this.appDataSource = appDataSource;
    this.queue = new Queue(queueName, {
      connection: this.connection,
      streams: { events: { maxLen: 5000 } },
    });
    // Create a separate Redis client for flag operations
    try {
      if ((connection as any).url) {
        this.redisClient = new IORedis((connection as any).url);
      } else {
        this.redisClient = new IORedis({
          host: (connection as any).host || "localhost",
          port: (connection as any).port || 6379,
          username: (connection as any).username,
          password: (connection as any).password,
          maxRetriesPerRequest: null,
        });
      }
    } catch (e) {
      logger.warn(
        "[FollowUpQueue] Could not create Redis client for flags:",
        e
      );
    }
  }

  // ==================== Cancel Flag Operations ====================

  /**
   * Set cancel flag — called when a new message arrives (emergency brake)
   */
  public async setCancelFlag(
    chatflowId: string,
    chatId: string
  ): Promise<void> {
    if (!this.redisClient) return;
    const key = `followup:cancel:${chatflowId}:${chatId}`;
    await this.redisClient.set(key, "1", "EX", CANCEL_FLAG_TTL_SECONDS);
  }

  /**
   * Check if cancel flag exists — called by worker before sending webhook
   */
  public async hasCancelFlag(
    chatflowId: string,
    chatId: string
  ): Promise<boolean> {
    if (!this.redisClient) return false;
    const key = `followup:cancel:${chatflowId}:${chatId}`;
    const val = await this.redisClient.get(key);
    return val === "1";
  }

  /**
   * Clear cancel flag — called after new timer is successfully scheduled
   */
  public async clearCancelFlag(
    chatflowId: string,
    chatId: string
  ): Promise<void> {
    if (!this.redisClient) return;
    const key = `followup:cancel:${chatflowId}:${chatId}`;
    await this.redisClient.del(key);
  }

  /**
   * Record last user message timestamp — used for true idle calculation
   */
  public async setLastMessageTime(
    chatflowId: string,
    chatId: string,
    timestamp: number
  ): Promise<void> {
    if (!this.redisClient) return;
    const key = `followup:last_msg:${chatflowId}:${chatId}`;
    await this.redisClient.set(
      key,
      timestamp.toString(),
      "EX",
      LAST_MSG_TTL_SECONDS
    );
  }

  /**
   * Get last user message timestamp from Redis (fast path)
   */
  public async getLastMessageTime(
    chatflowId: string,
    chatId: string
  ): Promise<number | null> {
    if (!this.redisClient) return null;
    const key = `followup:last_msg:${chatflowId}:${chatId}`;
    const val = await this.redisClient.get(key);
    return val ? parseInt(val) : null;
  }

  public getQueue(): Queue {
    return this.queue;
  }

  public getQueueName(): string {
    return this.queue.name;
  }

  /**
   * Schedule a follow-up delayed job for a specific step
   */
  public async scheduleJob(
    jobData: FollowUpJobData,
    lastUserMsgTime?: number
  ): Promise<Job> {
    const jobId = getFollowUpJobId(
      jobData.chatflowId,
      jobData.chatId,
      jobData.stepOrder
    );
    const intendedIdleMs = idleTimeoutToMs(
      jobData.idleTimeout,
      jobData.idleTimeoutUnit
    );

    // True idle time calculation:
    // delay = intended idle - (now - lastUserMsgTime)
    // This ensures the timer fires exactly idle-timeout from the user's last message,
    // not from when the bot finished processing
    let delay = intendedIdleMs;
    if (lastUserMsgTime) {
      const elapsed = Date.now() - lastUserMsgTime;
      delay = Math.max(intendedIdleMs - elapsed, 1000); // minimum 1 second delay
    }

    // Remove existing job with same ID if exists (reset timer)
    try {
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        await existingJob.remove();
      }
    } catch (e) {
      // Job doesn't exist, that's fine
    }

    return await this.queue.add(jobId, jobData, {
      jobId,
      delay,
      removeOnComplete: { age: 86400 }, // keep completed jobs for 1 day
      removeOnFail: { age: 604800 }, // keep failed jobs for 7 days
    });
  }

  /**
   * Cancel all follow-up jobs for a specific session
   */
  public async cancelAllForSession(
    chatflowId: string,
    chatId: string,
    totalSteps: number
  ): Promise<void> {
    for (let step = 1; step <= totalSteps; step++) {
      const jobId = getFollowUpJobId(chatflowId, chatId, step);
      try {
        const job = await this.queue.getJob(jobId);
        if (job) {
          await job.remove();
        }
      } catch (e) {
        // Job doesn't exist or already processed
      }
    }
  }

  /**
   * Cancel a single step job
   */
  public async cancelJob(
    chatflowId: string,
    chatId: string,
    stepOrder: number
  ): Promise<void> {
    const jobId = getFollowUpJobId(chatflowId, chatId, stepOrder);
    try {
      const job = await this.queue.getJob(jobId);
      if (job) {
        await job.remove();
      }
    } catch (e) {
      // Job doesn't exist
    }
  }

  /**
   * Log a skipped/cancelled job (race condition prevention)
   */
  private async logSkipped(
    jobData: FollowUpJobData,
    firedAt: Date,
    reason: string,
    lastMsgTime?: number
  ): Promise<void> {
    try {
      const logRepo = this.appDataSource.getRepository(FollowUpLog);
      const logEntry = logRepo.create({
        chatflowId: jobData.chatflowId,
        chatId: jobData.chatId,
        stepId: jobData.stepId,
        stepName: jobData.stepName,
        stepOrder: jobData.stepOrder,
        status: "cancelled",
        webhookUrl: jobData.webhookUrl,
        errorMessage: `Skipped: ${reason}`,
        idleTimeout: jobData.idleTimeout,
        idleTimeoutUnit: jobData.idleTimeoutUnit,
        lastMessageAt: lastMsgTime ? new Date(lastMsgTime) : null,
        firedAt,
        retryCount: 0,
      } as any);
      await logRepo.save(logEntry);
    } catch (e) {
      logger.warn("[FollowUpQueue] Failed to log skipped job:", e);
    }
  }

  /**
   * Get all delayed (pending) jobs
   */
  public async getPendingJobs(
    start: number = 0,
    end: number = 50
  ): Promise<Job[]> {
    return await this.queue.getDelayed(start, end);
  }

  /**
   * Get count of delayed jobs
   */
  public async getPendingCount(): Promise<number> {
    const counts = await this.queue.getJobCounts();
    return counts.delayed || 0;
  }

  /**
   * Create the worker that processes follow-up jobs
   */
  public createWorker(): Worker {
    this.worker = new Worker(
      this.queue.name,
      async (job: Job<FollowUpJobData>) => {
        const start = new Date().getTime();
        logger.info(
          `[FollowUpQueue] Processing follow-up job ${job.id} (step ${job.data.stepOrder}: ${job.data.stepName})`
        );

        try {
          const result = await this.processFollowUp(job.data);
          const end = new Date().getTime();
          logger.info(
            `[FollowUpQueue] Completed follow-up job ${job.id} in ${
              end - start
            }ms`
          );
          return result;
        } catch (error) {
          const end = new Date().getTime();
          logger.error(
            `[FollowUpQueue] Follow-up job ${job.id} failed in ${
              end - start
            }ms:`,
            { error }
          );
          throw error;
        }
      },
      {
        connection: this.connection,
        concurrency: FOLLOWUP_WORKER_CONCURRENCY,
      }
    );

    this.worker.on("error", (err) => {
      logger.error(`[FollowUpQueue] Worker error:`, { error: err });
    });

    this.worker.on("failed", (job, err) => {
      logger.error(`[FollowUpQueue] Job ${job?.id} failed:`, { error: err });
    });

    logger.info(
      `[FollowUpQueue] Worker created with concurrency ${FOLLOWUP_WORKER_CONCURRENCY}`
    );
    return this.worker;
  }

  /**
   * Process a follow-up job: fetch messages, send webhook, log result
   */
  private async processFollowUp(jobData: FollowUpJobData): Promise<any> {
    const {
      chatflowId,
      chatId,
      stepId,
      stepOrder,
      stepName,
      webhookUrl,
      webhookHeaders,
      maxMessages,
      includeSessionDetails,
      idleTimeout,
      idleTimeoutUnit,
    } = jobData;
    const firedAt = new Date();

    // ==================== DEFENSE LAYER 1: Redis Cancel Flag ====================
    const isCancelled = await this.hasCancelFlag(chatflowId, chatId);
    if (isCancelled) {
      logger.info(
        `[FollowUpQueue] Job aborted (cancel flag) for ${chatflowId}:${chatId} step ${stepOrder}`
      );
      await this.logSkipped(jobData, firedAt, "cancelled_by_flag");
      return { status: "cancelled", reason: "redis_cancel_flag" };
    }

    // ==================== DEFENSE LAYER 1.5: Max Fires Check ====================
    // If step has a maxFires limit, count previous successful sends for this step + session
    if (jobData.maxFires && jobData.maxFires > 0) {
      try {
        const logRepo = this.appDataSource.getRepository(FollowUpLog);
        const previousFires = await logRepo
          .createQueryBuilder("log")
          .where("log.chatflowId = :chatflowId", { chatflowId })
          .andWhere("log.chatId = :chatId", { chatId })
          .andWhere("log.stepOrder = :stepOrder", { stepOrder })
          .andWhere("log.status = :status", { status: "sent" })
          .getCount();

        if (previousFires >= jobData.maxFires) {
          logger.info(
            `[FollowUpQueue] Job aborted (max fires reached: ${previousFires}/${jobData.maxFires}) for ${chatflowId}:${chatId} step ${stepOrder}`
          );
          await this.logSkipped(
            jobData,
            firedAt,
            `max_fires_reached_${previousFires}_of_${jobData.maxFires}`
          );
          return {
            status: "cancelled",
            reason: "max_fires_reached",
            count: previousFires,
          };
        }
      } catch (e) {
        logger.warn(`[FollowUpQueue] maxFires check failed, proceeding:`, e);
      }
    }

    // ==================== DEFENSE LAYER 2: DB Validation (Last Message Check) ====================
    try {
      const chatMessageRepo = this.appDataSource.getRepository("ChatMessage");
      // Search by sessionId OR chatId (chatId is now the trackingId which is sessionId)
      const lastUserMessage: any = await chatMessageRepo
        .createQueryBuilder("msg")
        .where("msg.chatflowid = :chatflowId", { chatflowId })
        .andWhere("(msg.sessionId = :tid OR msg.chatId = :tid)", {
          tid: chatId,
        })
        .andWhere("msg.role = :role", { role: "userMessage" })
        .orderBy("msg.createdDate", "DESC")
        .getOne();

      if (lastUserMessage) {
        const lastMsgTime = new Date(lastUserMessage.createdDate).getTime();
        const idleMs = idleTimeoutToMs(idleTimeout, idleTimeoutUnit);
        const timeSinceLastMsg = firedAt.getTime() - lastMsgTime;

        if (timeSinceLastMsg < idleMs) {
          const remainingMin = Math.round((idleMs - timeSinceLastMsg) / 60000);
          logger.info(
            `[FollowUpQueue] Job aborted (user active) for ${chatflowId}:${chatId} step ${stepOrder} — last msg ${Math.round(
              timeSinceLastMsg / 1000
            )}s ago, ${remainingMin}min until true idle`
          );
          await this.logSkipped(jobData, firedAt, "user_active", lastMsgTime);
          return { status: "cancelled", reason: "user_still_active" };
        }
      }
    } catch (e) {
      // Non-fatal — if DB check fails, proceed with webhook (worst case: extra webhook fired)
      logger.warn(
        `[FollowUpQueue] DB validation failed for ${chatflowId}:${chatId}, proceeding with webhook:`,
        e
      );
    }

    // ==================== Webhook Execution ====================
    // 1. Fetch last N messages
    const chatMessageRepo = this.appDataSource.getRepository("ChatMessage");
    const messages = await chatMessageRepo.find({
      where: { chatflowid: chatflowId, chatId },
      order: { createdDate: "DESC" },
      take: maxMessages || 10,
    });

    // Get last message timestamp
    const lastMessageAt = messages.length > 0 ? messages[0].createdDate : null;

    // 2. Fetch chatflow details if needed
    let sessionDetails: any = {};
    if (includeSessionDetails) {
      const chatFlowRepo = this.appDataSource.getRepository("ChatFlow");
      const chatflow = await chatFlowRepo.findOne({
        where: { id: chatflowId },
      });
      if (chatflow) {
        sessionDetails = {
          chatflowName: chatflow.name,
          chatflowType: chatflow.type,
        };
      }
    }

    // 3. Build payload
    const payload = {
      event: "session_idle",
      chatflowId,
      chatId,
      sessionId: jobData.sessionId || null,
      step: {
        id: stepId,
        name: stepName,
        order: stepOrder,
        idleTimeout: jobData.idleTimeout,
        idleTimeoutUnit: jobData.idleTimeoutUnit,
      },
      lastMessageAt: lastMessageAt ? lastMessageAt.toISOString() : null,
      firedAt: firedAt.toISOString(),
      scheduledAt: jobData.scheduledAt,
      ...sessionDetails,
      lastMessages: messages.reverse().map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        createdDate: msg.createdDate,
      })),
    };

    // 4. Send webhook
    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;
    let status = "sent";

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Parse custom headers
      if (webhookHeaders) {
        try {
          const customHeaders = JSON.parse(webhookHeaders);
          Object.assign(headers, customHeaders);
        } catch (e) {
          // Invalid headers JSON, ignore
        }
      }

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        timeout: 30000, // 30 second timeout
      });

      responseStatus = response.status;
      responseBody = await response.text();

      if (!response.ok) {
        status = "failed";
        errorMessage = `HTTP ${response.status}: ${responseBody?.substring(
          0,
          500
        )}`;
      }
    } catch (error: any) {
      status = "failed";
      errorMessage = error.message || "Unknown error";
    }

    // 5. Log result
    const logRepo = this.appDataSource.getRepository(FollowUpLog);
    const logEntry = logRepo.create({
      chatflowId,
      chatId,
      stepId,
      stepName,
      stepOrder,
      status,
      webhookUrl,
      payload: JSON.stringify(payload),
      responseStatus,
      responseBody: responseBody?.substring(0, 5000), // limit stored response
      errorMessage,
      idleTimeout: jobData.idleTimeout,
      idleTimeoutUnit: jobData.idleTimeoutUnit,
      lastMessageAt,
      firedAt,
      retryCount: 0,
    } as any);
    await logRepo.save(logEntry);

    return { status, responseStatus, stepOrder, stepName };
  }
}
