import { getClickHouse } from "./client";

/**
 * Query helpers for the dashboard/history endpoints. All reads hit ClickHouse,
 * never Postgres. Field names match what the UI expects.
 */

async function query<T = any>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const ch = getClickHouse();
  const rs = await ch.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
  });
  return (await rs.json()) as T[];
}

export interface LogFilters {
  chatflowId?: string;
  chatId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export async function getLogs(
  filters: LogFilters
): Promise<{ logs: any[]; total: number }> {
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filters.chatflowId) {
    where.push("chatflowId = {chatflowId:String}");
    params.chatflowId = filters.chatflowId;
  }
  if (filters.chatId) {
    where.push("chatId = {chatId:String}");
    params.chatId = filters.chatId;
  }
  if (filters.status) {
    where.push("status = {status:String}");
    params.status = filters.status;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const totalRows = await query<{ c: string }>(
    `SELECT count() AS c FROM follow_up_log ${whereSql}`,
    params
  );
  const total = parseInt(totalRows[0]?.c || "0", 10);

  const logs = await query(
    `SELECT * FROM follow_up_log ${whereSql}
     ORDER BY createdDate DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    { ...params, limit, offset: (page - 1) * limit }
  );
  return { logs, total };
}

export async function getLogById(id: string): Promise<any | null> {
  const rows = await query(
    `SELECT * FROM follow_up_log WHERE id = {id:String} LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

export async function getLogsGrouped(): Promise<any[]> {
  return query(`
    SELECT chatflowId,
           count() AS total,
           countIf(status = 'sent') AS sent,
           countIf(status = 'failed') AS failed,
           countIf(status = 'cancelled') AS cancelled,
           uniqExact(chatId) AS uniqueSessions,
           max(firedAt) AS lastFiredAt
    FROM follow_up_log
    GROUP BY chatflowId
    ORDER BY lastFiredAt DESC
  `);
}

export async function getLogsByChatflowGroupedBySession(
  chatflowId: string
): Promise<any[]> {
  return query(
    `SELECT chatId,
            count() AS total,
            countIf(status = 'sent') AS sent,
            countIf(status = 'failed') AS failed,
            countIf(status = 'cancelled') AS cancelled,
            max(firedAt) AS lastFiredAt,
            min(firedAt) AS firstFiredAt
     FROM follow_up_log
     WHERE chatflowId = {chatflowId:String}
     GROUP BY chatId
     ORDER BY lastFiredAt DESC`,
    { chatflowId }
  );
}

export async function getLogsBySession(
  chatflowId: string,
  chatId: string
): Promise<any[]> {
  return query(
    `SELECT * FROM follow_up_log
     WHERE chatflowId = {chatflowId:String} AND chatId = {chatId:String}
     ORDER BY createdDate DESC`,
    { chatflowId, chatId }
  );
}

export async function getLogsByChatflow(
  chatflowId: string,
  page = 1,
  limit = 50
): Promise<{ logs: any[]; total: number }> {
  const totalRows = await query<{ c: string }>(
    `SELECT count() AS c FROM follow_up_log WHERE chatflowId = {chatflowId:String}`,
    { chatflowId }
  );
  const total = parseInt(totalRows[0]?.c || "0", 10);
  const logs = await query(
    `SELECT * FROM follow_up_log WHERE chatflowId = {chatflowId:String}
     ORDER BY createdDate DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    { chatflowId, limit, offset: (page - 1) * limit }
  );
  return { logs, total };
}

export async function getStats(days = 7): Promise<any> {
  const rows = await query<any>(
    `SELECT count() AS total,
            countIf(status = 'sent') AS sent,
            countIf(status = 'failed') AS failed,
            uniqExactIf(chatId, status = 'sent') AS uniqueSessions
     FROM follow_up_log
     WHERE firedAt >= now() - INTERVAL {days:UInt32} DAY`,
    { days }
  );
  const r = rows[0] || {};
  const total = parseInt(r.total || "0", 10);
  const sent = parseInt(r.sent || "0", 10);
  return {
    total,
    sent,
    failed: parseInt(r.failed || "0", 10),
    uniqueSessions: parseInt(r.uniqueSessions || "0", 10),
    successRate: total > 0 ? Math.round((sent / total) * 100) : 0,
    days,
  };
}

/** Per-chatflow counts used to enrich the config dashboard. */
export async function getChatflowCounts(
  chatflowId: string
): Promise<{ sentToday: number; failedToday: number; totalFired: number }> {
  const rows = await query<any>(
    `SELECT countIf(status = 'sent' AND firedAt >= toStartOfDay(now())) AS sentToday,
            countIf(status = 'failed' AND firedAt >= toStartOfDay(now())) AS failedToday,
            count() AS totalFired
     FROM follow_up_log WHERE chatflowId = {chatflowId:String}`,
    { chatflowId }
  );
  const r = rows[0] || {};
  return {
    sentToday: parseInt(r.sentToday || "0", 10),
    failedToday: parseInt(r.failedToday || "0", 10),
    totalFired: parseInt(r.totalFired || "0", 10),
  };
}
