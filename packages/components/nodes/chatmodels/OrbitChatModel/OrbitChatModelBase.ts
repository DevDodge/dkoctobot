import {
  ChatOpenAI as LangchainChatOpenAI,
  ChatOpenAIFields,
} from "@langchain/openai";
import { AIMessage, AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { ChatGeneration } from "@langchain/core/outputs";
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

  /**
   * Try to extract tool calls from text content.
   *
   * Orbit Provider / Anthropic-to-OpenAI proxies may return tool calls as
   * JSON text embedded in the `content` field instead of the standard
   * `tool_calls` field — even in non-streaming mode.
   *
   * This covers three common patterns:
   *  1. Raw JSON blocks:  {"name": "calc", "arguments": {...}}
   *  2. XML wrappers:     <function_call>{"name": "...", ...}</function_call>
   *  3. Anthropic passthrough: "name": "..." "input": {...}
   */
  private _extractToolCallsFromContent(content: string): Array<{
    name: string;
    args: Record<string, unknown>;
    id: string;
    type: string;
  }> {
    const seen = new Set<string>();
    const results: Array<{
      name: string;
      args: Record<string, unknown>;
      id: string;
      type: string;
    }> = [];

    const addUnique = (tc: typeof results[0]) => {
      const key = `${tc.name}:${JSON.stringify(tc.args)}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(tc);
      }
    };

    if (!content || typeof content !== "string") return results;

    // --- Pattern 1: JSON objects with name+arguments keys ---------------
    const jsonBlockRegex = /\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g;
    const matches = content.match(jsonBlockRegex);
    if (matches) {
      for (const match of matches) {
        try {
          const parsed = JSON.parse(match);
          if (parsed.name && parsed.arguments !== undefined) {
            addUnique({
              name: parsed.name,
              args:
                typeof parsed.arguments === "string"
                  ? JSON.parse(parsed.arguments)
                  : parsed.arguments,
              id: parsed.id || `orbit_extracted_${results.length}`,
              type: "tool_call",
            });
          }
          // Also check nested "function" wrapper (OpenAI style embedded in text)
          if (parsed.function?.name) {
            addUnique({
              name: parsed.function.name,
              args:
                typeof parsed.function.arguments === "string"
                  ? JSON.parse(parsed.function.arguments)
                  : parsed.function.arguments || {},
              id: parsed.id || `orbit_fn_${results.length}`,
              type: "tool_call",
            });
          }
        } catch {
          // not valid JSON — skip
        }
      }
    }

    // --- Pattern 2: XML <function_call> blocks --------------------------
    const xmlRegex = /<function_call>([\s\S]*?)<\/function_call>/g;
    let xmlMatch;
    while ((xmlMatch = xmlRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(xmlMatch[1].trim());
        if (parsed.name && parsed.arguments !== undefined) {
          addUnique({
            name: parsed.name,
            args:
              typeof parsed.arguments === "string"
                ? JSON.parse(parsed.arguments)
                : parsed.arguments,
            id: parsed.id || `orbit_xml_${results.length}`,
            type: "tool_call",
          });
        }
      } catch {
        // skip
      }
    }

    // --- Pattern 3: Anthropic-style tool_use blocks ---------------------
    // Looks for "name": "tool_name" followed by "input": {...}
    const anthropicRegex = /"name"\s*:\s*"([^"]+)"[\s\S]*?"input"\s*:\s*(\{[^}]+\})/g;
    let anthropicMatch;
    while ((anthropicMatch = anthropicRegex.exec(content)) !== null) {
      try {
        const name = anthropicMatch[1];
        const args = JSON.parse(anthropicMatch[2]);
        if (name && args) {
          addUnique({
            name,
            args,
            id: `orbit_anthropic_${results.length}`,
            type: "tool_call",
          });
        }
      } catch {
        // skip
      }
    }

    return results;
  }

  /**
   * Override *_streamResponseChunks* to intercept streaming responses.
   * Also added: detailed logging of each chunk to diagnose tool-call embedding.
   */
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

  /**
   * Override _generate to:
   *  1. Force non-streaming before every call (belt-and-suspenders)
   *  2. Log the raw response for diagnostics
   *  3. Attempt to extract tool calls from content if they are missing
   *     from the standard tool_calls / additional_kwargs.tool_calls fields
   *     (Orbit Provider quirk)
   */
  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    console.log(
      `\n[OrbitChatModel DEBUG] _generate — streaming=${this.streaming}, ` +
        `model=${this.model}, tool_choice=${JSON.stringify(options?.tool_choice)}`
    );

    // Force non-streaming at runtime
    const originalStreaming = this.streaming;
    this.streaming = false;

    try {
      const result = await super._generate(messages, options, runManager);

      console.log(
        `[OrbitChatModel DEBUG] _generate result — generations=${result.generations.length}, ` +
          `llmOutput=${JSON.stringify(result.llmOutput)}`
      );

      // --- Post-process each generation ---------------------------------
      for (const generation of result.generations) {
        const message = generation.message as AIMessage;
        const hasToolCalls =
          (message.tool_calls && message.tool_calls.length > 0) ||
          (message.additional_kwargs?.tool_calls &&
            message.additional_kwargs.tool_calls.length > 0);

        console.log(
          `[OrbitChatModel DEBUG] message — content=${
            typeof message.content === "string"
              ? JSON.stringify(message.content)?.substring(0, 200)
              : "[non-string]"
          }, ` +
            `tool_calls.length=${message.tool_calls?.length || 0}, ` +
            `additional_kwargs.tool_calls.length=${
              message.additional_kwargs?.tool_calls?.length || 0
            }`
        );

        if (!hasToolCalls && message.content) {
          const contentStr =
            typeof message.content === "string"
              ? message.content
              : JSON.stringify(message.content);

          console.log(
            `[OrbitChatModel DEBUG] ⚠️ No tool_calls detected — attempting extraction from content…`
          );

          const extracted = this._extractToolCallsFromContent(contentStr);

          if (extracted.length > 0) {
            console.log(
              `[OrbitChatModel DEBUG] ✅ Extracted ${extracted.length} tool call(s) from content: ` +
                JSON.stringify(extracted)
            );

            // Inject into the message so ToolCallingAgentOutputParser finds them
            message.tool_calls = extracted.map((tc) => ({
              name: tc.name,
              args: tc.args,
              id: tc.id,
              type: "tool_call" as const,
            }));

            message.additional_kwargs = {
              ...message.additional_kwargs,
              tool_calls: extracted.map((tc) => ({
                id: tc.id,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.args),
                },
              })),
            };

            console.log(
              `[OrbitChatModel DEBUG] ✅ Injected tool calls into message`
            );
          } else {
            console.log(
              `[OrbitChatModel DEBUG] ℹ️ No tool calls extractable from content`
            );
          }
        }

        // --- Bridge: emit content as synthetic streaming tokens ----------
        // When shouldStreamResponse=true, CustomChainHandler listens for
        // handleLLMNewToken events. Since we force non-streaming, those
        // events never fire and the UI never sees the final answer.
        // We simulate streaming by emitting the full content as tokens.
        if (runManager && typeof message.content === "string" && message.content) {
          console.log(
            `[OrbitChatModel DEBUG] 🔄 Bridging: emitting synthetic tokens to runManager (${message.content.length} chars)`
          );
          await this._emitSyntheticTokens(runManager, message.content, generation);
        }
      }

      return result;
    } finally {
      this.streaming = originalStreaming;
    }
  }

  /**
   * Emit the final content as synthetic streaming tokens.
   *
   * When the upstream agent runs in streaming mode (shouldStreamResponse=true),
   * it attaches a CustomChainHandler that listens for handleLLMNewToken events.
   * Since we force non-streaming, those events never fire and the UI never
   * sees the final answer. This bridge simulates streaming by emitting the
   * complete content as a sequence of tokens.
   */
  private async _emitSyntheticTokens(
    runManager: CallbackManagerForLLMRun,
    content: string,
    generation: ChatGeneration
  ): Promise<void> {
    const CHUNK_SIZE = 20;
    try {
      // Emit the content in small chunks to simulate normal streaming
      for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        const token = content.substring(i, i + CHUNK_SIZE);
        // Build a lightweight chunk so handlers that expect `chunk.message` don't crash
        const chunk = new ChatGenerationChunk({
          message: new AIMessageChunk({ content: token }),
          text: token,
        });
        // Pass `undefined` for runId and tags — the handler only needs the content
        await runManager.handleLLMNewToken(
          token,
          undefined,
          undefined,
          undefined,
          undefined,
          { chunk }
        );
      }
    } catch {
      // Best effort — if handleLLMNewToken isn't available or throws, that's OK.
      // The tool calling result is already captured in `generation.message`.
      console.log(
        `[OrbitChatModel DEBUG] ⚠️ handleLLMNewToken failed — UI may not stream, ` +
          `but tool calls were processed`
      );
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
