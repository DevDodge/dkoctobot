import { Request, Response, NextFunction } from "express";
import { StatusCodes } from "http-status-codes";
import { getRunningExpressApp } from "../../utils/getRunningExpressApp";
import { FollowUpService } from "../../services/follow-up";

function getService(): FollowUpService {
  const app = getRunningExpressApp();
  if (!app.followUpService) {
    throw new Error(
      "Follow-up service not initialized. Make sure Redis/Queue mode is enabled."
    );
  }
  return app.followUpService;
}

// ==================== Config ====================

const getAllConfigs = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const service = getService();
    const configs = await service.getAllConfigs();
    return res.json(configs);
  } catch (error) {
    next(error);
  }
};

const getConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getService();
    const chatflowId = req.params.chatflowId;
    const result = await service.getConfig(chatflowId);
    if (!result) {
      return res.json({ config: null, steps: [] });
    }
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

const upsertConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const service = getService();
    const { chatflowId, config, steps } = req.body;
    if (!chatflowId) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "chatflowId is required" });
    }
    const result = await service.upsertConfig(
      chatflowId,
      config || {},
      steps || []
    );
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

const deleteConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const service = getService();
    const chatflowId = req.params.chatflowId;
    await service.deleteConfig(chatflowId);
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

// ==================== Pending Jobs ====================

const getPendingJobs = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const service = getService();
    const start = parseInt(req.query.start as string) || 0;
    const end = parseInt(req.query.end as string) || 50;
    const jobs = await service.getPendingJobs(start, end);
    const count = await service.getPendingCount();
    return res.json({ jobs, total: count });
  } catch (error) {
    next(error);
  }
};

const cancelFollowUp = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const service = getService();
    const { chatflowId, chatId } = req.params;
    await service.cancelFollowUp(chatflowId, chatId);
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

// ==================== Logs ====================

const getLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getService();
    const filters = {
      chatflowId: req.query.chatflowId as string,
      chatId: req.query.chatId as string,
      status: req.query.status as string,
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
    };
    const result = await service.getLogs(filters);
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

const getLogsGrouped = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const service = getService();
    const result = await service.getLogsGroupedByChatflow();
    return res.json(result);
  } catch (error) {
    // If service not initialized, return empty array instead of error
    if ((error as Error).message?.includes("not initialized")) {
      return res.json([]);
    }
    next(error);
  }
};

const getLogsByChatflow = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const service = getService();
    const chatflowId = req.params.chatflowId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const result = await service.getLogsByChatflow(chatflowId, page, limit);
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

const getLogsByChatflowSessions = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const service = getService();
    const chatflowId = req.params.chatflowId;
    const result = await service.getLogsByChatflowGroupedBySession(chatflowId);
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

const getLogsBySession = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const service = getService();
    const { chatflowId, chatId } = req.params;
    const result = await service.getLogsBySession(chatflowId, chatId);
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

const getLogById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getService();
    const log = await service.getLogById(req.params.id);
    if (!log) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Log not found" });
    }
    return res.json(log);
  } catch (error) {
    next(error);
  }
};

const retryWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const service = getService();
    const result = await service.retryWebhook(req.params.logId);
    if (!result) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: "Cannot retry this log entry" });
    }
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

// ==================== Stats ====================

const getStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const service = getService();
    const days = parseInt(req.query.days as string) || 7;
    const stats = await service.getStats(days);
    return res.json(stats);
  } catch (error) {
    next(error);
  }
};

export default {
  getAllConfigs,
  getConfig,
  upsertConfig,
  deleteConfig,
  getPendingJobs,
  cancelFollowUp,
  getLogs,
  getLogsGrouped,
  getLogsByChatflow,
  getLogsByChatflowSessions,
  getLogsBySession,
  getLogById,
  retryWebhook,
  getStats,
};
