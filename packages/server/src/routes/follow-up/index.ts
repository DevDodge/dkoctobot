import express from "express";
import followUpController from "../../controllers/follow-up";
const router = express.Router();

// Config
router.get("/config", followUpController.getAllConfigs);
router.get("/config/:chatflowId", followUpController.getConfig);
router.post("/config", followUpController.upsertConfig);
router.put("/config/:chatflowId", followUpController.upsertConfig);
router.delete("/config/:chatflowId", followUpController.deleteConfig);

// Pending jobs
router.get("/pending", followUpController.getPendingJobs);
router.post("/cancel/:chatflowId/:chatId", followUpController.cancelFollowUp);

// Logs
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

// Stats
router.get("/stats", followUpController.getStats);

export default router;
