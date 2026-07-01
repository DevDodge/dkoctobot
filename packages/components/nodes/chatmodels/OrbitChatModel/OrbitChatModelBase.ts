import {
  ChatOpenAI as LangchainChatOpenAI,
  ChatOpenAIFields,
} from "@langchain/openai";
import { BaseMessage } from "@langchain/core/messages";
import { IMultiModalOption, IVisionChatModal } from "../../../src";

export class OrbitChatModel
  extends LangchainChatOpenAI
  implements IVisionChatModal
{
  configuredModel: string;
  configuredMaxToken?: number;
  multiModalOption: IMultiModalOption;
  id: string;

  constructor(id: string, fields?: ChatOpenAIFields) {
    super(fields);
    this.id = id;
    this.configuredModel = fields?.model || fields?.modelName || "";
    this.configuredMaxToken = fields?.maxTokens;
    if (fields?.model) {
      this.model = fields.model;
    }

    // Monkey-patch the completions sub-instance to log the ACTUAL request payload
    // This is necessary because ChatOpenAI._streamResponseChunks delegates to
    // this.completions._streamResponseChunks, which calls this.completions.invocationParams()
    // — our class-level overrides won't fire on that sub-instance.
    const originalInvocationParams = (this.completions as any).invocationParams.bind(
      this.completions
    );
    (this.completions as any).invocationParams = (
      options: any,
      extra?: { streaming?: boolean }
    ) => {
      const params = originalInvocationParams(options, extra);

      console.log(
        "\n[OrbitChatModel DEBUG] ===== REQUEST PAYLOAD TO ORBIT ====="
      );
      console.log(
        "[OrbitChatModel DEBUG] Base URL:",
        (this as any).configuration?.baseURL || "not set"
      );
      console.log("[OrbitChatModel DEBUG] Model:", params.model);
      console.log("[OrbitChatModel DEBUG] Streaming:", params.stream);
      console.log(
        "[OrbitChatModel DEBUG] Tools count in params:",
        params.tools?.length ?? 0
      );
      if (params.tools?.length) {
        console.log(
          "[OrbitChatModel DEBUG] Tools:",
          JSON.stringify(params.tools, null, 2)
        );
      } else {
        console.log(
          "[OrbitChatModel DEBUG] ⚠️ NO TOOLS in request — tool calling will NOT work!"
        );
      }
      console.log(
        "[OrbitChatModel DEBUG] Tool choice:",
        params.tool_choice ?? "not set"
      );
      console.log(
        "[OrbitChatModel DEBUG] ===== END REQUEST PAYLOAD =====\n"
      );

      return params;
    };
  }

  // Override _streamResponseChunks to log the streaming response
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: any,
    runManager?: any
  ): AsyncGenerator<any, void, unknown> {
    console.log(
      "\n[OrbitChatModel DEBUG] ===== STREAMING REQUEST STARTED ====="
    );

    // Log last user message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg: any = messages[i];
      if (msg._getType?.() === "human") {
        console.log(
          "[OrbitChatModel DEBUG] Last user msg:",
          typeof msg.content === "string"
            ? msg.content.substring(0, 300)
            : JSON.stringify(msg.content).substring(0, 300)
        );
        break;
      }
    }

    // Log all messages for context
    console.log("[OrbitChatModel DEBUG] Total messages:", messages.length);
    console.log(
      "[OrbitChatModel DEBUG] Message roles:",
      messages.map((m: any) => m._getType?.() || "unknown")
    );

    let allContent = "";
    let toolCallsSeen = false;
    let finishReason = "";

    try {
      const stream = super._streamResponseChunks(messages, options, runManager);
      for await (const chunk of stream) {
        // Inspect chunk for tool calls
        const genInfo: any = (chunk as any)?.generationInfo;
        if (genInfo?.finish_reason) {
          finishReason = genInfo.finish_reason;
        }

        const chunkMsg: any = (chunk as any)?.message;
        if (chunkMsg) {
          // Check for tool_calls in delta
          const deltaToolCalls =
            chunkMsg.tool_calls ||
            chunkMsg.additional_kwargs?.tool_calls;
          if (deltaToolCalls?.length) {
            toolCallsSeen = true;
            console.log(
              "[OrbitChatModel DEBUG] 🔧 Tool call chunk:",
              JSON.stringify(deltaToolCalls, null, 2)
            );
          }

          // Accumulate content
          if (typeof chunkMsg.content === "string") {
            allContent += chunkMsg.content;
          }
        }

        yield chunk;
      }

      console.log(
        "[OrbitChatModel DEBUG] Stream finished. finish_reason:",
        finishReason
      );
      console.log(
        "[OrbitChatModel DEBUG] Total accumulated content:",
        allContent.substring(0, 500)
      );
      console.log("[OrbitChatModel DEBUG] Any tool_calls seen:", toolCallsSeen);
      console.log(
        "[OrbitChatModel DEBUG] ===== STREAMING REQUEST ENDED =====\n"
      );
    } catch (err: any) {
      console.error(
        "[OrbitChatModel DEBUG] Stream ERROR:",
        err.message,
        err.stack
      );
      throw err;
    }
  }

  revertToOriginalModel(): void {
    this.model = this.configuredModel;
    this.maxTokens = this.configuredMaxToken;
  }

  setMultiModalOption(multiModalOption: IMultiModalOption): void {
    this.multiModalOption = multiModalOption;
  }

  setVisionModel(): void {
    // pass
  }
}
