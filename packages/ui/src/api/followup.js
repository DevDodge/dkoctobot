import client from "./client";

// Config
const getAllConfigs = () => client.get("/followup/config");
const getConfig = (chatflowId) => client.get(`/followup/config/${chatflowId}`);
const upsertConfig = (data) => client.post("/followup/config", data);
const updateConfig = (chatflowId, data) =>
  client.put(`/followup/config/${chatflowId}`, data);
const deleteConfig = (chatflowId) =>
  client.delete(`/followup/config/${chatflowId}`);

// Pending
const getPendingJobs = (params = {}) =>
  client.get("/followup/pending", { params });
const cancelFollowUp = (chatflowId, chatId) =>
  client.post(`/followup/cancel/${chatflowId}/${chatId}`);

// Logs
const getLogs = (params = {}) => client.get("/followup/logs", { params });
const getLogsGrouped = () => client.get("/followup/logs/grouped");
const getLogsByChatflow = (chatflowId, params = {}) =>
  client.get(`/followup/logs/chatflow/${chatflowId}`, { params });
const getLogsByChatflowSessions = (chatflowId) =>
  client.get(`/followup/logs/chatflow/${chatflowId}/sessions`);
const getLogsBySession = (chatflowId, chatId) =>
  client.get(`/followup/logs/chatflow/${chatflowId}/session/${chatId}`);
const getLogById = (id) => client.get(`/followup/logs/${id}`);
const retryWebhook = (logId) => client.post(`/followup/retry/${logId}`);

// Stats
const getStats = (params = {}) => client.get("/followup/stats", { params });

// Service Health & Admin (P0 resilience)
const getHealth = () => client.get("/followup/health");
const getCircuits = () => client.get("/followup/admin/circuits");
const resetCircuits = (url) =>
  client.post("/followup/admin/circuits/reset", url ? { url } : {});

export default {
  getAllConfigs,
  getConfig,
  upsertConfig,
  updateConfig,
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
  getHealth,
  getCircuits,
  resetCircuits,
};
