import { DataSource } from "typeorm";
import {
  FollowUpQueue,
  FollowUpJobData,
  idleTimeoutToMs,
} from "../../queue/FollowUpQueue";
import { FollowUpConfig } from "../../database/entities/FollowUpConfig";
import { FollowUpStep } from "../../database/entities/FollowUpStep";
import { FollowUpLog } from "../../database/entities/FollowUpLog";
import logger from "../../utils/logger";

// In-memory cache for follow-up configs
const configCache: Map<
  string,
  { config: FollowUpConfig; steps: FollowUpStep[] } | null
> = new Map();

export class FollowUpService {
  private appDataSource: DataSource;
  private followUpQueue: FollowUpQueue | null = null;

  constructor(appDataSource: DataSource) {
    this.appDataSource = appDataSource;
  }

  public setQueue(queue: FollowUpQueue) {
    this.followUpQueue = queue;
  }

  // ==================== Config Management ====================

  /**
   * Get follow-up config + steps for a chatflow (cached)
   */
  async getConfig(
    chatflowId: string
  ): Promise<{ config: FollowUpConfig; steps: FollowUpStep[] } | null> {
    // Check cache first
    if (configCache.has(chatflowId)) {
      return configCache.get(chatflowId) || null;
    }

    const configRepo = this.appDataSource.getRepository(FollowUpConfig);
    const stepRepo = this.appDataSource.getRepository(FollowUpStep);

    const config = await configRepo.findOne({ where: { chatflowId } });
    if (!config) {
      configCache.set(chatflowId, null);
      return null;
    }

    const steps = await stepRepo.find({
      where: { configId: config.id },
      order: { stepOrder: "ASC" },
    });

    const result = { config, steps };
    configCache.set(chatflowId, result);
    return result;
  }

  /**
   * Get all configs (for dashboard) — enriched with chatflow name, steps count, and stats
   */
  async getAllConfigs(): Promise<any[]> {
    const configRepo = this.appDataSource.getRepository(FollowUpConfig);
    const stepRepo = this.appDataSource.getRepository(FollowUpStep);
    const logRepo = this.appDataSource.getRepository(FollowUpLog);
    const chatFlowRepo = this.appDataSource.getRepository("ChatFlow");

    const configs = await configRepo.find();

    const enriched = await Promise.all(
      configs.map(async (config) => {
        // Get chatflow name
        const chatflow = await chatFlowRepo.findOne({
          where: { id: config.chatflowId },
        });

        // Get steps
        const steps = await stepRepo.find({
          where: { configId: config.id },
          order: { stepOrder: "ASC" },
        });

        // Get today's stats
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sentToday = await logRepo
          .createQueryBuilder("log")
          .where("log.chatflowId = :chatflowId", {
            chatflowId: config.chatflowId,
          })
          .andWhere("log.createdDate >= :today", { today })
          .andWhere("log.status = :status", { status: "sent" })
          .getCount();

        const failedToday = await logRepo
          .createQueryBuilder("log")
          .where("log.chatflowId = :chatflowId", {
            chatflowId: config.chatflowId,
          })
          .andWhere("log.createdDate >= :today", { today })
          .andWhere("log.status = :status", { status: "failed" })
          .getCount();

        const totalFired = await logRepo
          .createQueryBuilder("log")
          .where("log.chatflowId = :chatflowId", {
            chatflowId: config.chatflowId,
          })
          .getCount();

        // Get pending count from queue
        let pendingTasks = 0;
        let activeSessions = 0;
        if (this.followUpQueue) {
          try {
            const jobs = await this.followUpQueue.getPendingJobs(0, 1000);
            const chatflowJobs = jobs.filter(
              (j: any) => j.data?.chatflowId === config.chatflowId
            );
            pendingTasks = chatflowJobs.length;
            // Count unique chatIds (real sessions)
            const uniqueChatIds = new Set(
              chatflowJobs.map((j: any) => j.data?.chatId).filter(Boolean)
            );
            activeSessions = uniqueChatIds.size;
          } catch (e) {
            // queue not available
          }
        }

        return {
          ...config,
          chatflowName: chatflow?.name || config.chatflowId,
          stepsCount: steps.length,
          steps,
          sentToday,
          failedToday,
          totalFired,
          pendingTasks,
          activeSessions,
        };
      })
    );

    return enriched;
  }

  /**
   * Create or update follow-up config + steps
   */
  async upsertConfig(
    chatflowId: string,
    configData: Partial<FollowUpConfig>,
    stepsData: Array<Partial<FollowUpStep>>
  ): Promise<{ config: FollowUpConfig; steps: FollowUpStep[] }> {
    const configRepo = this.appDataSource.getRepository(FollowUpConfig);
    const stepRepo = this.appDataSource.getRepository(FollowUpStep);

    // Find or create config
    let config = await configRepo.findOne({ where: { chatflowId } });
    if (config) {
      // Update existing
      await configRepo.update(config.id, {
        enabled: configData.enabled ?? config.enabled,
        includeSessionDetails:
          configData.includeSessionDetails ?? config.includeSessionDetails,
        maxMessages: configData.maxMessages ?? config.maxMessages,
      });
      config = (await configRepo.findOne({ where: { id: config.id } }))!;
    } else {
      // Create new
      config = configRepo.create({
        chatflowId,
        enabled: configData.enabled ?? false,
        includeSessionDetails: configData.includeSessionDetails ?? true,
        maxMessages: configData.maxMessages ?? 10,
      });
      config = await configRepo.save(config);
    }

    // Replace steps: delete old, insert new
    await stepRepo.delete({ configId: config.id });

    const steps: FollowUpStep[] = [];
    for (let i = 0; i < stepsData.length; i++) {
      const stepData = stepsData[i];
      const step = stepRepo.create({
        configId: config.id,
        chatflowId,
        stepOrder: i + 1,
        stepName: stepData.stepName || `Step ${i + 1}`,
        idleTimeout: stepData.idleTimeout || 30,
        idleTimeoutUnit: stepData.idleTimeoutUnit || "minutes",
        webhookUrl: stepData.webhookUrl || "",
        webhookHeaders: stepData.webhookHeaders || null,
        maxFires: stepData.maxFires || 0,
      } as any);
      const savedStep = await stepRepo.save(step as any);
      steps.push(savedStep as FollowUpStep);
    }

    // Invalidate cache
    configCache.set(chatflowId, { config, steps });

    return { config, steps };
  }

  /**
   * Delete config and all steps for a chatflow
   */
  async deleteConfig(chatflowId: string): Promise<void> {
    const configRepo = this.appDataSource.getRepository(FollowUpConfig);
    const stepRepo = this.appDataSource.getRepository(FollowUpStep);

    const config = await configRepo.findOne({ where: { chatflowId } });
    if (config) {
      await stepRepo.delete({ configId: config.id });
      await configRepo.delete(config.id);
    }

    // Invalidate cache
    configCache.delete(chatflowId);
  }

  // ==================== Scheduling ====================

  /**
   * Schedule follow-up timers for a session (called on every new message)
   * Cancels all existing timers and creates new ones
   */
  async scheduleFollowUp(
    chatflowId: string,
    chatId: string,
    sessionId?: string
  ): Promise<void> {
    if (!this.followUpQueue) {
      logger.warn("[FollowUpService] Queue not initialized, skipping schedule");
      return;
    }

    const configData = await this.getConfig(chatflowId);
    if (
      !configData ||
      !configData.config.enabled ||
      configData.steps.length === 0
    ) {
      return;
    }

    const { config, steps } = configData;

    // Cancel all existing jobs for this session
    await this.followUpQueue.cancelAllForSession(
      chatflowId,
      chatId,
      steps.length
    );

    // Get true last user message time for accurate delay calculation
    let lastUserMsgTime = Date.now();
    try {
      // Fast path: check Redis first
      const redisMsgTime = await this.followUpQueue.getLastMessageTime(
        chatflowId,
        chatId
      );
      if (redisMsgTime) {
        lastUserMsgTime = redisMsgTime;
      } else {
        // Slow path: query DB
        const chatMessageRepo = this.appDataSource.getRepository("ChatMessage");
        const lastMsg: any = await chatMessageRepo
          .createQueryBuilder("msg")
          .where("msg.chatflowid = :chatflowId", { chatflowId })
          .andWhere("(msg.sessionId = :tid OR msg.chatId = :tid)", {
            tid: chatId,
          })
          .andWhere("msg.role = :role", { role: "userMessage" })
          .orderBy("msg.createdDate", "DESC")
          .getOne();
        if (lastMsg) {
          lastUserMsgTime = new Date(lastMsg.createdDate).getTime();
        }
      }
    } catch (e) {
      // Non-fatal — use current time as fallback
      logger.debug(
        "[FollowUpService] Could not get last message time, using now()"
      );
    }

    // Schedule new jobs for each step with TRUE idle calculation
    const scheduledAt = new Date().toISOString();
    for (const step of steps) {
      const jobData: FollowUpJobData = {
        chatflowId,
        chatId,
        sessionId,
        stepId: step.id,
        stepOrder: step.stepOrder,
        stepName: step.stepName || `Step ${step.stepOrder}`,
        idleTimeout: step.idleTimeout,
        idleTimeoutUnit: step.idleTimeoutUnit,
        webhookUrl: step.webhookUrl,
        webhookHeaders: step.webhookHeaders || undefined,
        maxMessages: config.maxMessages,
        includeSessionDetails: config.includeSessionDetails,
        scheduledAt,
        maxFires: step.maxFires || 0,
      };

      // Calculate adjusted delay: intended idle time - time already elapsed since last user message
      await this.followUpQueue.scheduleJob(jobData, lastUserMsgTime);
    }

    logger.info(
      `[FollowUpService] Scheduled ${steps.length} follow-up steps for chatflow=${chatflowId} chatId=${chatId}`
    );
  }

  /**
   * Cancel all follow-up timers for a session
   */
  async cancelFollowUp(chatflowId: string, chatId: string): Promise<void> {
    if (!this.followUpQueue) return;

    const configData = await this.getConfig(chatflowId);
    const totalSteps = configData?.steps.length || 10; // fallback to 10
    await this.followUpQueue.cancelAllForSession(
      chatflowId,
      chatId,
      totalSteps
    );

    logger.info(
      `[FollowUpService] Cancelled follow-up for chatflow=${chatflowId} chatId=${chatId}`
    );
  }

  // ==================== Dashboard / Logs ====================

  /**
   * Get pending (delayed) jobs from the queue
   */
  async getPendingJobs(start: number = 0, end: number = 50): Promise<any[]> {
    if (!this.followUpQueue) return [];
    const jobs = await this.followUpQueue.getPendingJobs(start, end);
    return jobs.map((job) => ({
      id: job.id,
      data: job.data,
      delay: job.opts?.delay,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    }));
  }

  /**
   * Get pending count
   */
  async getPendingCount(): Promise<number> {
    if (!this.followUpQueue) return 0;
    return await this.followUpQueue.getPendingCount();
  }

  /**
   * Get webhook logs (paginated)
   */
  async getLogs(filters: {
    chatflowId?: string;
    chatId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ logs: FollowUpLog[]; total: number }> {
    const logRepo = this.appDataSource.getRepository(FollowUpLog);
    const page = filters.page || 1;
    const limit = filters.limit || 20;

    const queryBuilder = logRepo.createQueryBuilder("log");

    if (filters.chatflowId) {
      queryBuilder.andWhere("log.chatflowId = :chatflowId", {
        chatflowId: filters.chatflowId,
      });
    }
    if (filters.chatId) {
      queryBuilder.andWhere("log.chatId = :chatId", { chatId: filters.chatId });
    }
    if (filters.status) {
      queryBuilder.andWhere("log.status = :status", { status: filters.status });
    }

    queryBuilder.orderBy("log.createdDate", "DESC");
    queryBuilder.skip((page - 1) * limit);
    queryBuilder.take(limit);

    const [logs, total] = await queryBuilder.getManyAndCount();
    return { logs, total };
  }

  /**
   * Get a single log entry
   */
  async getLogById(id: string): Promise<FollowUpLog | null> {
    const logRepo = this.appDataSource.getRepository(FollowUpLog);
    return await logRepo.findOne({ where: { id } });
  }

  /**
   * Get logs grouped by chatflow (for History page)
   */
  async getLogsGroupedByChatflow(): Promise<any[]> {
    const logRepo = this.appDataSource.getRepository(FollowUpLog);
    const chatFlowRepo = this.appDataSource.getRepository("ChatFlow");

    const grouped = await logRepo
      .createQueryBuilder("log")
      .select("log.chatflowId", "chatflowId")
      .addSelect("COUNT(*)", "total")
      .addSelect("SUM(CASE WHEN log.status = 'sent' THEN 1 ELSE 0 END)", "sent")
      .addSelect(
        "SUM(CASE WHEN log.status = 'failed' THEN 1 ELSE 0 END)",
        "failed"
      )
      .addSelect(
        "SUM(CASE WHEN log.status = 'cancelled' THEN 1 ELSE 0 END)",
        "cancelled"
      )
      .addSelect("COUNT(DISTINCT log.chatId)", "uniqueSessions")
      .addSelect("MAX(log.firedAt)", "lastFiredAt")
      .groupBy("log.chatflowId")
      .orderBy("MAX(log.firedAt)", "DESC")
      .getRawMany();

    // Enrich with chatflow names
    const enriched = await Promise.all(
      grouped.map(async (g) => {
        const chatflow = await chatFlowRepo.findOne({
          where: { id: g.chatflowId },
        });
        return {
          chatflowId: g.chatflowId,
          chatflowName: chatflow?.name || g.chatflowId,
          total: parseInt(g.total) || 0,
          sent: parseInt(g.sent) || 0,
          failed: parseInt(g.failed) || 0,
          cancelled: parseInt(g.cancelled) || 0,
          uniqueSessions: parseInt(g.uniqueSessions) || 0,
          lastFiredAt: g.lastFiredAt,
        };
      })
    );

    return enriched;
  }

  /**
   * Get logs for a specific chatflow grouped by session (Level 2)
   */
  async getLogsByChatflowGroupedBySession(chatflowId: string): Promise<any[]> {
    const logRepo = this.appDataSource.getRepository(FollowUpLog);

    const grouped = await logRepo
      .createQueryBuilder("log")
      .select("log.chatId", "chatId")
      .addSelect("COUNT(*)", "total")
      .addSelect("SUM(CASE WHEN log.status = 'sent' THEN 1 ELSE 0 END)", "sent")
      .addSelect(
        "SUM(CASE WHEN log.status = 'failed' THEN 1 ELSE 0 END)",
        "failed"
      )
      .addSelect(
        "SUM(CASE WHEN log.status = 'cancelled' THEN 1 ELSE 0 END)",
        "cancelled"
      )
      .addSelect("MAX(log.firedAt)", "lastFiredAt")
      .addSelect("MIN(log.firedAt)", "firstFiredAt")
      .where("log.chatflowId = :chatflowId", { chatflowId })
      .groupBy("log.chatId")
      .orderBy("MAX(log.firedAt)", "DESC")
      .getRawMany();

    return grouped.map((g) => ({
      chatId: g.chatId,
      total: parseInt(g.total) || 0,
      sent: parseInt(g.sent) || 0,
      failed: parseInt(g.failed) || 0,
      cancelled: parseInt(g.cancelled) || 0,
      lastFiredAt: g.lastFiredAt,
      firstFiredAt: g.firstFiredAt,
    }));
  }

  /**
   * Get logs for a specific chatflow + session (Level 3 - actual webhook entries)
   */
  async getLogsBySession(chatflowId: string, chatId: string): Promise<any[]> {
    const logRepo = this.appDataSource.getRepository(FollowUpLog);
    return await logRepo.find({
      where: { chatflowId, chatId },
      order: { createdDate: "DESC" },
    });
  }

  /**
   * Get logs for a specific chatflow (detail view)
   */
  async getLogsByChatflow(
    chatflowId: string,
    page: number = 1,
    limit: number = 50
  ): Promise<any> {
    const logRepo = this.appDataSource.getRepository(FollowUpLog);

    const [logs, total] = await logRepo.findAndCount({
      where: { chatflowId },
      order: { createdDate: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { logs, total };
  }

  /**
   * Get stats for dashboard
   */
  async getStats(days: number = 7): Promise<any> {
    const logRepo = this.appDataSource.getRepository(FollowUpLog);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const total = await logRepo
      .createQueryBuilder("log")
      .where("log.createdDate >= :since", { since })
      .getCount();

    const sent = await logRepo
      .createQueryBuilder("log")
      .where("log.createdDate >= :since", { since })
      .andWhere("log.status = :status", { status: "sent" })
      .getCount();

    const failed = await logRepo
      .createQueryBuilder("log")
      .where("log.createdDate >= :since", { since })
      .andWhere("log.status = :status", { status: "failed" })
      .getCount();

    // Count unique sessions (chatIds) that received webhooks
    const uniqueSessionsResult = await logRepo
      .createQueryBuilder("log")
      .select("COUNT(DISTINCT log.chatId)", "count")
      .where("log.createdDate >= :since", { since })
      .andWhere("log.status = :status", { status: "sent" })
      .getRawOne();

    const pendingCount = await this.getPendingCount();

    return {
      total,
      sent,
      failed,
      pending: pendingCount,
      uniqueSessions: parseInt(uniqueSessionsResult?.count || "0"),
      successRate: total > 0 ? Math.round((sent / total) * 100) : 0,
      days,
    };
  }

  /**
   * Retry a failed webhook
   */
  async retryWebhook(logId: string): Promise<FollowUpLog | null> {
    if (!this.followUpQueue) return null;

    const logRepo = this.appDataSource.getRepository(FollowUpLog);
    const log = await logRepo.findOne({ where: { id: logId } });

    if (!log || log.status !== "failed") return null;

    // Re-schedule as immediate job (delay = 0)
    const jobData: FollowUpJobData = {
      chatflowId: log.chatflowId,
      chatId: log.chatId,
      stepId: log.stepId || "",
      stepOrder: log.stepOrder || 1,
      stepName: log.stepName || "Retry",
      idleTimeout: 0,
      idleTimeoutUnit: "minutes",
      webhookUrl: log.webhookUrl || "",
      maxMessages: 10,
      includeSessionDetails: true,
      scheduledAt: new Date().toISOString(),
      maxFires: 0, // retries bypass maxFires check
    };

    await this.followUpQueue.scheduleJob(jobData);

    // Update retry count
    await logRepo.update(logId, { retryCount: log.retryCount + 1 });

    return await logRepo.findOne({ where: { id: logId } });
  }

  /**
   * Invalidate cache for a chatflow
   */
  invalidateCache(chatflowId: string): void {
    configCache.delete(chatflowId);
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    configCache.clear();
  }
}
