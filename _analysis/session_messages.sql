-- Investigate session 27207245732237039 to understand why it fired twice
-- Check messages timeline for this session
SELECT
  "chatflowid",
  "chatId",
  "sessionId",
  role,
  LEFT(content, 50) as content_preview,
  "createdDate"
FROM chat_message
WHERE "chatflowid" = 'fa6867a5-a4d8-4a19-ac53-aa8cf1475066'
  AND ("chatId" = '27207245732237039' OR "sessionId" = '27207245732237039')
ORDER BY "createdDate" ASC;
