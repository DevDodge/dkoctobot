import { Request, Response, NextFunction } from "express";
import { RateLimiterManager } from "../../utils/rateLimit";
import chatflowsService from "../../services/chatflows";
import logger from "../../utils/logger";
import predictionsServices from "../../services/predictions";
import { InternalFlowiseError } from "../../errors/internalFlowiseError";
import { StatusCodes } from "http-status-codes";
import { getRunningExpressApp } from "../../utils/getRunningExpressApp";
import { v4 as uuidv4 } from "uuid";
import { getErrorMessage } from "../../errors/utils";
import { MODE } from "../../Interface";
import { FollowUpService } from "../../services/follow-up";
import { publishFollowUpEvent } from "../../utils/followUpPublisher";

// When true, use the legacy in-process follow-up worker (Postgres + BullMQ).
// Default (false) publishes lightweight events to the standalone follow-up service.
const FOLLOWUP_LEGACY = process.env.FOLLOWUP_LEGACY === "true";


// Follow-up service singleton (lazy init)
let followUpService: FollowUpService | null = null;

function getFollowUpService(): FollowUpService | null {
  if (followUpService) return followUpService;
  try {
    const app = getRunningExpressApp();
    if (app.followUpService) {
      followUpService = app.followUpService;
    }
  } catch (e) {
    // App not ready yet
  }
  return followUpService;
}

function getFollowUpQueue(): any {
  try {
    const app = getRunningExpressApp();
    return app.followUpQueue || null;
  } catch (e) {
    return null;
  }
}

/**
 * Called when a message is received. New path (default): publish a lightweight
 * event to the standalone follow-up service via Redis Stream — no Postgres, no
 * BullMQ in the request path. Legacy path (FOLLOWUP_LEGACY=true): the old
 * in-process worker.
 * Uses sessionId as primary tracking key (stable per customer), falls back to chatId.
 */
async function scheduleFollowUpIfEnabled(
  chatflowId: string,
  chatId?: string,
  sessionId?: string,
  question?: string
): Promise<void> {
  const trackingId = sessionId || chatId;
  if (!trackingId) return;

  // New path: fire-and-forget event to the follow-up microservice.
  if (!FOLLOWUP_LEGACY) {
    await publishFollowUpEvent({
      chatflowId,
      chatId: chatId || trackingId,
      sessionId,
      role: "userMessage",
      content: question || "",
    });
    return;
  }

  // ===== Legacy in-process path =====
  const service = getFollowUpService();
  if (!service) return;

  // Step 1: Set cancel flag immediately (emergency brake for any active worker)
  const queue = getFollowUpQueue();
  if (queue) {
    try {
      await queue.setCancelFlag(chatflowId, trackingId);
      await queue.setLastMessageTime(chatflowId, trackingId, Date.now());
    } catch (e) {
      // Non-fatal
    }
  }

  // Step 2: Schedule follow-up with true idle calculation
  try {
    await service.scheduleFollowUp(chatflowId, trackingId, sessionId);
  } catch (error) {
    logger.debug(
      `[FollowUp] Failed to schedule follow-up for chatflow=${chatflowId}: ${error}`
    );
  }

  // Step 3: Clear cancel flag after scheduling is done (new timers are in place)
  if (queue) {
    try {
      await queue.clearCancelFlag(chatflowId, trackingId);
    } catch (e) {
      // Non-fatal — will auto-expire via TTL anyway
    }
  }
}

// Send input message and get prediction result (External)
const createPrediction = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const chatflowId = req.params?.id;
  try {
    if (typeof req.params === "undefined" || !chatflowId) {
      throw new InternalFlowiseError(
        StatusCodes.PRECONDITION_FAILED,
        `Error: predictionsController.createPrediction - id not provided!`
      );
    }
    if (!req.body) {
      throw new InternalFlowiseError(
        StatusCodes.PRECONDITION_FAILED,
        `Error: predictionsController.createPrediction - body not provided!`
      );
    }

    const workspaceId = req.user?.activeWorkspaceId;

    const chatflow = await chatflowsService.getChatflowById(
      chatflowId,
      workspaceId
    );
    if (!chatflow) {
      throw new InternalFlowiseError(
        StatusCodes.NOT_FOUND,
        `Chatflow ${chatflowId} not found`
      );
    }
    let isDomainAllowed = true;
    let unauthorizedOriginError =
      "This site is not allowed to access this chatbot";
    logger.info(
      `[server]: Request originated from ${
        req.headers.origin || "UNKNOWN ORIGIN"
      }`
    );
    if (chatflow.chatbotConfig) {
      const parsedConfig = JSON.parse(chatflow.chatbotConfig);
      // check whether the first one is not empty. if it is empty that means the user set a value and then removed it.
      const isValidAllowedOrigins =
        parsedConfig.allowedOrigins?.length &&
        parsedConfig.allowedOrigins[0] !== "";
      unauthorizedOriginError =
        parsedConfig.allowedOriginsError ||
        "This site is not allowed to access this chatbot";
      if (isValidAllowedOrigins && req.headers.origin) {
        const originHeader = req.headers.origin;
        const origin = new URL(originHeader).host;
        isDomainAllowed =
          parsedConfig.allowedOrigins.filter((domain: string) => {
            try {
              const allowedOrigin = new URL(domain).host;
              return origin === allowedOrigin;
            } catch (e) {
              return false;
            }
          }).length > 0;
      }
    }
    if (isDomainAllowed) {
      const streamable =
        await chatflowsService.checkIfChatflowIsValidForStreaming(chatflowId);
      const isStreamingRequested =
        req.body.streaming === "true" || req.body.streaming === true;
      if (streamable?.isStreaming && isStreamingRequested) {
        const sseStreamer = getRunningExpressApp().sseStreamer;

        let chatId = req.body.chatId;
        if (!req.body.chatId) {
          chatId =
            req.body.chatId ?? req.body.overrideConfig?.sessionId ?? uuidv4();
          req.body.chatId = chatId;
        }
        try {
          sseStreamer.addExternalClient(chatId, res);
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no"); //nginx config: https://serverfault.com/a/801629
          res.flushHeaders();

          if (process.env.MODE === MODE.QUEUE) {
            getRunningExpressApp().redisSubscriber.subscribe(chatId);
          }

          const apiResponse = await predictionsServices.buildChatflow(req);
          sseStreamer.streamMetadataEvent(apiResponse.chatId, apiResponse);

          // Schedule follow-up timers (fire and forget — don't block response)
          const effectiveSessionId =
            req.body.overrideConfig?.sessionId || req.body.sessionId || chatId;
          scheduleFollowUpIfEnabled(
            chatflowId,
            chatId,
            effectiveSessionId,
            req.body.question
          ).catch(() => {});
        } catch (error) {
          if (chatId) {
            sseStreamer.streamErrorEvent(chatId, getErrorMessage(error));
          }
          next(error);
        } finally {
          sseStreamer.removeClient(chatId);
        }
      } else {
        const apiResponse = await predictionsServices.buildChatflow(req);

        // Schedule follow-up timers (fire and forget — don't block response)
        const respChatId =
          apiResponse?.chatId ||
          req.body.chatId ||
          req.body.overrideConfig?.sessionId;
        const effectiveSessionId =
          req.body.overrideConfig?.sessionId ||
          req.body.sessionId ||
          apiResponse?.sessionId ||
          respChatId;
        scheduleFollowUpIfEnabled(
          chatflowId,
          respChatId,
          effectiveSessionId,
          req.body.question
        ).catch(() => {});

        return res.json(apiResponse);
      }
    } else {
      const isStreamingRequested =
        req.body.streaming === "true" || req.body.streaming === true;
      if (isStreamingRequested) {
        return res.status(StatusCodes.FORBIDDEN).send(unauthorizedOriginError);
      }
      throw new InternalFlowiseError(
        StatusCodes.FORBIDDEN,
        unauthorizedOriginError
      );
    }
  } catch (error) {
    next(error);
  } finally {
  }
};

const getRateLimiterMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    return RateLimiterManager.getInstance().getRateLimiter()(req, res, next);
  } catch (error) {
    next(error);
  }
};

export default {
  createPrediction,
  getRateLimiterMiddleware,
};
