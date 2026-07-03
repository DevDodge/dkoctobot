import { Redis } from "ioredis";
import { getBlockingRedis, getRedis } from "../redis/client";
import { StateStore } from "../redis/stateStore";
import { Scheduler } from "../scheduler/scheduler";
import { ConfigProvider } from "../config/configProvider";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import { MessageEvent } from "../domain/types";

/**
 * Consumes message events from the dedicated Redis Stream (consumer group, so
 * multiple service instances share the load). For each message:
 *  - sets the cancel flag (emergency brake for any in-flight timer)
 *  - caches the message + records last-user-message time
 *  - reschedules the session's timers
 *
 * The main app never queries Postgres for messages — content arrives in the event.
 */
export class IngestConsumer {
  private blocking: Redis;
  private control: Redis;
  private running = false;

  /** Exposed for health monitoring. */
  _lag = 0;
  _lastEventTs = 0;

  constructor(
    private state: StateStore,
    private scheduler: Scheduler,
    private config: ConfigProvider
  ) {
    this.blocking = getBlockingRedis();
    this.control = getRedis();
  }

  async start(): Promise<void> {
    await this.ensureGroup();
    this.running = true;
    this.loop().catch((e) => logger.error("Consumer loop crashed:", e));
    logger.info(
      `Ingest consumer started (stream=${env.eventsStream}, group=${env.consumerGroup})`
    );
  }

  stop(): void {
    this.running = false;
  }

  private async ensureGroup(): Promise<void> {
    try {
      await this.control.xgroup(
        "CREATE",
        env.eventsStream,
        env.consumerGroup,
        "$",
        "MKSTREAM"
      );
    } catch (e: any) {
      if (!String(e?.message || e).includes("BUSYGROUP")) throw e;
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const res = await this.blocking.xreadgroup(
          "GROUP",
          env.consumerGroup,
          env.consumerName,
          "COUNT",
          env.streamReadCount,
          "BLOCK",
          env.streamBlockMs,
          "STREAMS",
          env.eventsStream,
          ">"
        );
        if (!res) continue;

        // res: [[streamName, [[id, [field, value, ...]], ...]]]
        const entries = (res as any[])[0][1] as Array<[string, string[]]>;
        const ackIds: string[] = [];
        for (const [id, fields] of entries) {
          try {
            await this.handle(this.parseFields(fields));
          } catch (e) {
            logger.warn(`Failed to handle event ${id}:`, e);
          }
          ackIds.push(id);
        }
        if (ackIds.length > 0) {
          await this.control.xack(
            env.eventsStream,
            env.consumerGroup,
            ...ackIds
          );
          this._lastEventTs = Date.now();

          // Compute approximate lag for health monitoring.
          try {
            const info = (await this.control.xinfo(
              "STREAM",
              env.eventsStream
            )) as any;
            this._lag =
              (info?.length || 0) -
              ((info?.lastGeneratedId?.split("-")[0]) || 0);
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        logger.error("xreadgroup error:", e);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private parseFields(fields: string[]): MessageEvent {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      obj[fields[i]] = fields[i + 1];
    }
    return {
      chatflowId: obj.chatflowId,
      chatId: obj.chatId,
      sessionId: obj.sessionId || undefined,
      role: obj.role || "userMessage",
      content: obj.content || "",
      ts: obj.ts ? parseInt(obj.ts, 10) : Date.now(),
    };
  }

  private async handle(ev: MessageEvent): Promise<void> {
    if (!ev.chatflowId) return;
    const trackingId = ev.sessionId || ev.chatId;
    if (!trackingId) return;

    // Early filter: if chatIdFilterRegex is configured, completely ignore non-matching sessions.
    // This prevents non-matching sessions from being cached, scheduled, or appearing in Pending.
    const bundle = await this.config.getConfig(ev.chatflowId);
    if (bundle?.config.chatIdFilterRegex) {
      try {
        const filterRegex = new RegExp(bundle.config.chatIdFilterRegex);
        if (!filterRegex.test(trackingId)) {
          logger.debug(
            `[Consumer] Ignored ${ev.chatflowId}:${trackingId} — does not match chatIdFilterRegex`
          );
          return;
        }
      } catch (err: any) {
        logger.error(
          `[Consumer] Invalid chatIdFilterRegex for ${ev.chatflowId}: ${bundle.config.chatIdFilterRegex}`,
          err
        );
        return;
      }
    }

    const isUser = ev.role === "userMessage";

    // 1. Emergency brake for any worker about to fire on this session.
    await this.state.setCancelFlag(ev.chatflowId, trackingId);

    // 2. Cache the message + record last-user-message time.
    await this.state.recordMessage(
      ev.chatflowId,
      trackingId,
      {
        role: ev.role,
        content: ev.content,
        createdDate: new Date(ev.ts).toISOString(),
      },
      isUser,
      ev.ts
    );

    // 3. Reschedule timers from the true last-user-message time.
    const lastUserMsgTime =
      (await this.state.getLastMessageTime(ev.chatflowId, trackingId)) || ev.ts;
    await this.scheduler.scheduleForSession(
      ev.chatflowId,
      trackingId,
      ev.sessionId,
      lastUserMsgTime
    );

    // 4. Release the brake — new timers are in place.
    await this.state.clearCancelFlag(ev.chatflowId, trackingId);
  }
}
