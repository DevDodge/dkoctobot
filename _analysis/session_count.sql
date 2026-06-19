-- Count unique sessions vs total fires
SELECT
  COUNT(DISTINCT "chatId") as unique_sessions,
  COUNT(*) as total_fires,
  COUNT(DISTINCT "chatflowId") as unique_chatflows
FROM follow_up_log;

-- Show all chatIds with their fire counts
SELECT "chatId", COUNT(*) as fires
FROM follow_up_log
GROUP BY "chatId"
ORDER BY fires DESC, "chatId";
