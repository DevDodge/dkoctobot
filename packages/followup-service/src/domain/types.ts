/**
 * Domain types for the follow-up service.
 * Mirrors the original FollowUpJobData / entity shapes so the UI contract is preserved.
 */

export type IdleUnit = "minutes" | "hours" | "days";

export type LogStatus = "sent" | "failed" | "cancelled" | "pending";

/** A single follow-up step (ported from FollowUpStep entity). */
export interface FollowUpStep {
  id: string;
  configId: string;
  chatflowId: string;
  stepOrder: number;
  stepName: string;
  idleTimeout: number;
  idleTimeoutUnit: IdleUnit;
  webhookUrl: string;
  webhookHeaders?: string | null;
  maxFires: number; // 0 = unlimited
  createdDate?: string;
  updatedDate?: string;
}

/** Per-chatflow follow-up config (ported from FollowUpConfig entity). */
export interface FollowUpConfig {
  id: string;
  chatflowId: string;
  enabled: boolean;
  includeSessionDetails: boolean;
  maxMessages: number;
  createdDate?: string;
  updatedDate?: string;
}

export interface ConfigBundle {
  config: FollowUpConfig;
  steps: FollowUpStep[];
}

/** A message event published by the main app on every chat message. */
export interface MessageEvent {
  chatflowId: string;
  chatId: string;
  sessionId?: string;
  role: string; // "userMessage" | "apiMessage"
  content: string;
  ts: number; // epoch ms
}

/** A cached chat message stored in Redis for building the webhook payload. */
export interface CachedMessage {
  role: string;
  content: string;
  createdDate: string; // ISO
}

/** A scheduled timer entry. The ZSET member encodes this; score = fireAt ms. */
export interface TimerKey {
  chatflowId: string;
  trackingId: string; // sessionId or chatId
  stepOrder: number;
}

/** The full data needed to process a fired timer (stored alongside the ZSET member). */
export interface TimerJob extends TimerKey {
  stepId: string;
  stepName: string;
  idleTimeout: number;
  idleTimeoutUnit: IdleUnit;
  webhookUrl: string;
  webhookHeaders?: string | null;
  maxMessages: number;
  includeSessionDetails: boolean;
  maxFires: number;
  sessionId?: string;
  scheduledAt: string;
  fireAt: number;
}

/** Log row written to ClickHouse (preserves UI field names). */
export interface FollowUpLogRow {
  id: string;
  chatflowId: string;
  chatId: string;
  stepId: string;
  stepName: string;
  stepOrder: number;
  status: LogStatus;
  webhookUrl: string;
  payload: string;
  responseStatus: number | null;
  responseBody: string;
  errorMessage: string;
  idleTimeout: number;
  idleTimeoutUnit: string;
  lastMessageAt: string | null;
  firedAt: string;
  createdDate: string;
  retryCount: number;
}

export function idleTimeoutToMs(timeout: number, unit: string): number {
  switch (unit) {
    case "minutes":
      return timeout * 60 * 1000;
    case "hours":
      return timeout * 60 * 60 * 1000;
    case "days":
      return timeout * 24 * 60 * 60 * 1000;
    default:
      return timeout * 60 * 1000;
  }
}
