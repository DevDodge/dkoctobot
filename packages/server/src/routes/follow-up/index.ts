import express, { Request, Response, NextFunction } from "express";
import axios from "axios";
import followUpController from "../../controllers/follow-up";
import logger from "../../utils/logger";

const router = express.Router();

// When FOLLOWUP_LEGACY=true, use the in-process controller (old Postgres/BullMQ path).
// Otherwise proxy every /followup request to the standalone follow-up microservice.
const FOLLOWUP_LEGACY = process.env.FOLLOWUP_LEGACY === "true";
const SERVICE_URL = (
  process.env.FOLLOWUP_SERVICE_URL || "http://localhost:3100"
).replace(/\/$/, "");

/**
 * Generic reverse-proxy: forwards method, path (under /followup), query, and body
 * to the follow-up service, preserving the exact API contract the UI depends on.
 */
async function proxy(req: Request, res: Response, next: NextFunction) {
  try {
    const target = `${SERVICE_URL}/followup${req.path}`;
    const response = await axios.request({
      method: req.method as any,
      url: target,
      params: req.query,
      data: ["GET", "DELETE", "HEAD"].includes(req.method)
        ? undefined
        : req.body,
      timeout: 30000,
      validateStatus: () => true,
      headers: { "Content-Type": "application/json" },
    });
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    logger.error(`[FollowUpProxy] ${req.method} ${req.path} failed: ${error?.message}`);
    // Soft-fail for grouped/list endpoints so the dashboard doesn't hard-error.
    if (req.method === "GET") {
      return res.json(req.path.includes("grouped") ? [] : { jobs: [], total: 0, logs: [] });
    }
    next(error);
  }
}

if (FOLLOWUP_LEGACY) {
  // ===== Legacy in-process routes =====
  router.get("/config", followUpController.getAllConfigs);
  router.get("/config/:chatflowId", followUpController.getConfig);
  router.post("/config", followUpController.upsertConfig);
  router.put("/config/:chatflowId", followUpController.upsertConfig);
  router.delete("/config/:chatflowId", followUpController.deleteConfig);
  router.get("/pending", followUpController.getPendingJobs);
  router.post("/cancel/:chatflowId/:chatId", followUpController.cancelFollowUp);
  router.get("/logs", followUpController.getLogs);
  router.get("/logs/grouped", followUpController.getLogsGrouped);
  router.get("/logs/chatflow/:chatflowId", followUpController.getLogsByChatflow);
  router.get(
    "/logs/chatflow/:chatflowId/sessions",
    followUpController.getLogsByChatflowSessions
  );
  router.get(
    "/logs/chatflow/:chatflowId/session/:chatId",
    followUpController.getLogsBySession
  );
  router.get("/logs/:id", followUpController.getLogById);
  router.post("/retry/:logId", followUpController.retryWebhook);
  router.get("/stats", followUpController.getStats);
} else {
  // ===== Proxy to the standalone follow-up microservice =====
  router.use(proxy);
}

export default router;
