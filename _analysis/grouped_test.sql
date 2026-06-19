SELECT "chatflowId",
  COUNT(*) as total,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
  SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
  COUNT(DISTINCT "chatId") as unique_sessions,
  MAX("firedAt") as last_fired
FROM follow_up_log
GROUP BY "chatflowId";
