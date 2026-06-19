/** Centralized Redis key builders for the follow-up service. */

export const keys = {
  /** ZSET of due timers. member = timer member string, score = fireAt (ms). */
  timers: "followup:timers",

  /** HASH storing the full TimerJob JSON keyed by timer member. */
  timerJobs: "followup:timerjobs",

  /** Capped LIST of recent messages for a session. */
  msgs: (chatflowId: string, trackingId: string) =>
    `followup:msgs:${chatflowId}:${trackingId}`,

  /** Last user-message timestamp (ms) for a session. */
  lastMsg: (chatflowId: string, trackingId: string) =>
    `followup:lastmsg:${chatflowId}:${trackingId}`,

  /** maxFires counter per step+session. */
  fires: (chatflowId: string, trackingId: string, stepOrder: number) =>
    `followup:fires:${chatflowId}:${trackingId}:step${stepOrder}`,

  /** Emergency cancel flag set when a new message arrives. */
  cancel: (chatflowId: string, trackingId: string) =>
    `followup:cancel:${chatflowId}:${trackingId}`,

  /** Per-chatflow config cache (JSON string). */
  config: (chatflowId: string) => `followup:config:${chatflowId}`,
};

/** Encode a deterministic timer member (one per chatflow+session+step). */
export function timerMember(
  chatflowId: string,
  trackingId: string,
  stepOrder: number
): string {
  return `${chatflowId}|${trackingId}|${stepOrder}`;
}
