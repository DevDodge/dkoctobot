-- Check for duplicate chatIds (same session fired more than once)
SELECT "chatId", COUNT(*) as fire_count,
       MIN("firedAt") as first_fire,
       MAX("firedAt") as last_fire
FROM follow_up_log
WHERE "chatflowId" = 'fa6867a5-a4d8-4a19-ac53-aa8cf1475066'
GROUP BY "chatId"
HAVING COUNT(*) > 1
ORDER BY fire_count DESC;
