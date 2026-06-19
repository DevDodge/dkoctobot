SELECT
  id,
  "chatflowId",
  "chatId",
  "stepName",
  "stepOrder",
  status,
  "firedAt",
  "createdDate",
  "errorMessage",
  "responseStatus"
FROM follow_up_log
ORDER BY "createdDate" DESC
LIMIT 30;
