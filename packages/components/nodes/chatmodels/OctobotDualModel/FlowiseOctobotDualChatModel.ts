import {
  ChatOpenAI as LangchainChatOpenAI,
  ChatOpenAIFields,
} from "@langchain/openai";
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
} from "@langchain/core/messages";
import {
  ChatGeneration,
  ChatGenerationChunk,
  ChatResult,
} from "@langchain/core/outputs";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { IMultiModalOption, IVisionChatModal } from "../../../src";
import OpenAI from "openai";

const GATEWAY_BASE_URL = "https://aipilotads.com/api/v1";

export interface DualKeyConfig {
  primaryApiKey: string;
  backupApiKey: string | null;
  primaryModel: string;
  backupModel: string | null;
}

export class OctobotDualChatModel
  extends LangchainChatOpenAI
  implements IVisionChatModal
{
  configuredModel: string;
  configuredMaxToken?: number;
  multiModalOption: IMultiModalOption;
  id: string;

  private dualConfig: DualKeyConfig;
  private usingBackup: boolean = false;

  constructor(
    id: string,
    fields?: ChatOpenAIFields,
    dualConfig?: DualKeyConfig,
  ) {
    super(fields);
    this.id = id;
    this.configuredModel = fields?.model || fields?.modelName || "";
    this.configuredMaxToken = fields?.maxTokens;
    this.dualConfig = dualConfig || {
      primaryApiKey: "",
      backupApiKey: null,
      primaryModel: fields?.model || fields?.modelName || "",
      backupModel: null,
    };

    if (fields?.model) {
      this.model = fields.model;
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

    const addUnique = (tc: (typeof results)[0]) => {
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
              id: parsed.id || `dual_extracted_${results.length}`,
              type: "tool_call",
            });
          }
          if (parsed.function?.name) {
            addUnique({
              name: parsed.function.name,
              args:
                typeof parsed.function.arguments === "string"
                  ? JSON.parse(parsed.function.arguments)
                  : parsed.function.arguments || {},
              id: parsed.id || `dual_fn_${results.length}`,
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
            id: parsed.id || `dual_xml_${results.length}`,
            type: "tool_call",
          });
        }
      } catch {
        // skip
      }
    }

    // --- Pattern 3: Anthropic-style tool_use blocks ---------------------
    const anthropicRegex =
      /"name"\s*:\s*"([^"]+)"[\s\S]*?"input"\s*:\s*(\{[^}]+\})/g;
    let anthropicMatch;
    while ((anthropicMatch = anthropicRegex.exec(content)) !== null) {
      try {
        const name = anthropicMatch[1];
        const args = JSON.parse(anthropicMatch[2]);
        if (name && args) {
          addUnique({
            name,
            args,
            id: `dual_anthropic_${results.length}`,
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
   * Post-process a generation result: extract tool calls from content
   * if missing, and bridge content as synthetic tokens to the UI.
   */
  private async _postProcessGeneration(
    result: ChatResult,
    runManager?: CallbackManagerForLLMRun,
    tag: string = "PRIMARY"
  ): Promise<void> {
    for (const generation of result.generations) {
      const message = generation.message as AIMessage;
      const hasToolCalls =
        (message.tool_calls && message.tool_calls.length > 0) ||
        (message.additional_kwargs?.tool_calls &&
          message.additional_kwargs.tool_calls.length > 0);

      console.log(
        `[OctobotDual:${this.id}] [${tag}] message — content=${
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
          `[OctobotDual:${this.id}] [${tag}] ⚠️ No tool_calls — extracting from content…`
        );

        const extracted = this._extractToolCallsFromContent(contentStr);

        if (extracted.length > 0) {
          console.log(
            `[OctobotDual:${this.id}] [${tag}] ✅ Extracted ${extracted.length} tool call(s): ` +
              JSON.stringify(extracted)
          );

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
            `[OctobotDual:${this.id}] [${tag}] ✅ Injected tool calls into message`
          );
        } else {
          console.log(
            `[OctobotDual:${this.id}] [${tag}] ℹ️ No tool calls extractable`
          );
        }
      }

      // Bridge: emit content as synthetic tokens so the UI sees it
      if (
        runManager &&
        typeof message.content === "string" &&
        message.content
      ) {
        console.log(
          `[OctobotDual:${this.id}] [${tag}] 🔄 Bridging: synthetic tokens (${message.content.length} chars)`
        );
        await this._emitSyntheticTokens(runManager, message.content, generation);
      }
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
      for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        const token = content.substring(i, i + CHUNK_SIZE);
        const chunk = new ChatGenerationChunk({
          message: new AIMessageChunk({ content: token }),
          text: token,
        });
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
      console.log(
        `[OctobotDual:${this.id}] ⚠️ handleLLMNewToken failed — UI may not stream, ` +
          `but tool calls were processed`
      );
    }
  }

  /**
   * Replace the internal OpenAI client on BOTH the outer instance AND
   * the completions sub-object (ChatOpenAI delegates _streamResponseChunks
   * via yield* to this.completions, which has its OWN client/model).
   *
   * @param isPrimary - if true, disable retries for fast failover to backup
   */
  private replaceClient(apiKey: string, modelName: string, isPrimary: boolean = false): void {
    const newClient = new OpenAI({
      apiKey,
      baseURL: GATEWAY_BASE_URL,
      defaultHeaders: { Authorization: `Bearer ${apiKey}` },
      maxRetries: isPrimary ? 0 : 2, // No retries on primary for fast failover, 2 retries on backup
    });

    // Outer instance
    // @ts-ignore
    this.client = newClient;
    this.model = modelName;
    // @ts-ignore
    this.modelName = modelName;

    // Inner completions sub-object (ChatOpenAI delegates to this)
    // @ts-ignore
    if (this.completions) {
      // @ts-ignore
      this.completions.client = newClient;
      // @ts-ignore
      this.completions.model = modelName;
      // @ts-ignore
      this.completions.modelName = modelName;
    }
  }

  /**
   * Switch the internal OpenAI client to use the backup API key and model.
   */
  private switchToBackup(): void {
    if (!this.dualConfig.backupApiKey) {
      console.log(`[OctobotDual:${this.id}] ❌ Cannot switch to backup - no backup key configured`);
      return;
    }

    this.usingBackup = true;
    const keyPreview = `${this.dualConfig.backupApiKey.substring(0, 8)}...${this.dualConfig.backupApiKey.substring(this.dualConfig.backupApiKey.length - 4)}`;
    const modelForBackup = this.dualConfig.backupModel || this.dualConfig.primaryModel;
    console.log(`[OctobotDual:${this.id}] 🔄 Switching to BACKUP`);
    console.log(`[OctobotDual:${this.id}]    - Backup API Key: ${keyPreview}`);
    console.log(`[OctobotDual:${this.id}]    - Backup Model: ${modelForBackup}`);

    this.replaceClient(this.dualConfig.backupApiKey, modelForBackup, false);
    console.log(`[OctobotDual:${this.id}] ✅ Switched to backup successfully`);
  }

  /**
   * Switch the internal OpenAI client back to the primary API key and model.
   */
  private switchToPrimary(): void {
    this.usingBackup = false;
    const keyPreview = `${this.dualConfig.primaryApiKey.substring(0, 8)}...${this.dualConfig.primaryApiKey.substring(this.dualConfig.primaryApiKey.length - 4)}`;
    console.log(`[OctobotDual:${this.id}] 🔄 Switching to PRIMARY`);
    console.log(`[OctobotDual:${this.id}]    - Primary API Key: ${keyPreview}`);
    console.log(`[OctobotDual:${this.id}]    - Primary Model: ${this.dualConfig.primaryModel}`);

    this.replaceClient(this.dualConfig.primaryApiKey, this.dualConfig.primaryModel, true);
    console.log(`[OctobotDual:${this.id}] ✅ Switched to primary successfully`);
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    console.log(`[OctobotDual:${this.id}] 🚀 Starting _generate (non-streaming)`);

    // Force non-streaming for tool calling compatibility (same as OrbitChatModel)
    const originalStreaming = this.streaming;
    this.streaming = false;

    try {
      console.log(`[OctobotDual:${this.id}] 📤 Calling PRIMARY endpoint...`);
      const result = await super._generate(messages, options, runManager);
      console.log(`[OctobotDual:${this.id}] ✅ PRIMARY _generate completed successfully`);

      // Post-process: extract tool calls from content if missing, bridge to UI
      await this._postProcessGeneration(result, runManager, "PRIMARY");

      return result;
    } catch (primaryError: any) {
      console.log(`[OctobotDual:${this.id}] ❌ PRIMARY _generate failed:`);
      console.log(`[OctobotDual:${this.id}]    - Error type: ${primaryError.constructor.name}`);
      console.log(`[OctobotDual:${this.id}]    - Error message: ${primaryError.message}`);
      console.log(`[OctobotDual:${this.id}]    - Error status: ${primaryError.status || 'N/A'}`);

      // If primary fails and we have backup, try backup
      if (this.dualConfig.backupApiKey) {
        console.log(`[OctobotDual:${this.id}] 🔄 Attempting BACKUP...`);
        this.switchToBackup();
        try {
          console.log(`[OctobotDual:${this.id}] 📤 Calling BACKUP endpoint...`);
          const result = await super._generate(messages, options, runManager);
          console.log(`[OctobotDual:${this.id}] ✅ BACKUP _generate completed successfully`);
          return result;
        } catch (backupError: any) {
          console.log(`[OctobotDual:${this.id}] ❌ BACKUP _generate also failed:`);
          console.log(`[OctobotDual:${this.id}]    - Error type: ${backupError.constructor.name}`);
          console.log(`[OctobotDual:${this.id}]    - Error message: ${backupError.message}`);
          console.log(`[OctobotDual:${this.id}]    - Error status: ${backupError.status || 'N/A'}`);
          console.log(`[OctobotDual:${this.id}] 💀 Both PRIMARY and BACKUP failed - throwing error`);
          throw backupError;
        } finally {
          // Always revert to primary after request completes
          this.switchToPrimary();
        }
      }
      // No backup available, throw original error
      console.log(`[OctobotDual:${this.id}] ⚠️ No backup configured - throwing PRIMARY error`);
      throw primaryError;
    } finally {
      // Restore original streaming setting
      this.streaming = originalStreaming;
    }
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<any> {
    console.log(`[OctobotDual:${this.id}] 🚀 Starting _streamResponseChunks (streaming)`);
    console.log(`[OctobotDual:${this.id}]    - Message count: ${messages.length}`);
    console.log(`[OctobotDual:${this.id}]    - Has backup: ${!!this.dualConfig.backupApiKey}`);

    let chunkCount = 0;
    try {
      console.log(`[OctobotDual:${this.id}] 📤 Starting PRIMARY stream...`);
      // Try primary
      const gen = super._streamResponseChunks(messages, options, runManager);
      for await (const chunk of gen) {
        chunkCount++;
        if (chunkCount === 1) {
          console.log(`[OctobotDual:${this.id}] 📨 First chunk received from PRIMARY`);
        }
        yield chunk;
      }
      console.log(`[OctobotDual:${this.id}] ✅ PRIMARY stream completed successfully (${chunkCount} chunks)`);
    } catch (primaryError: any) {
      console.log(`[OctobotDual:${this.id}] ❌ PRIMARY stream failed after ${chunkCount} chunks:`);
      console.log(`[OctobotDual:${this.id}]    - Error type: ${primaryError.constructor.name}`);
      console.log(`[OctobotDual:${this.id}]    - Error message: ${primaryError.message}`);
      console.log(`[OctobotDual:${this.id}]    - Error status: ${primaryError.status || 'N/A'}`);
      console.log(`[OctobotDual:${this.id}]    - Error code: ${primaryError.code || 'N/A'}`);
      if (primaryError.stack) {
        console.log(`[OctobotDual:${this.id}]    - Stack trace (first 200 chars): ${primaryError.stack.substring(0, 200)}`);
      }

      // If primary fails and we have backup, try backup
      if (this.dualConfig.backupApiKey) {
        console.log(`[OctobotDual:${this.id}] 🔄 Attempting BACKUP stream...`);
        this.switchToBackup();

        let backupChunkCount = 0;
        try {
          console.log(`[OctobotDual:${this.id}] 📤 Starting BACKUP stream...`);
          const gen = super._streamResponseChunks(messages, options, runManager);
          for await (const chunk of gen) {
            backupChunkCount++;
            if (backupChunkCount === 1) {
              console.log(`[OctobotDual:${this.id}] 📨 First chunk received from BACKUP`);
            }
            yield chunk;
          }
          console.log(`[OctobotDual:${this.id}] ✅ BACKUP stream completed successfully (${backupChunkCount} chunks)`);
        } catch (backupError: any) {
          console.log(`[OctobotDual:${this.id}] ❌ BACKUP stream also failed after ${backupChunkCount} chunks:`);
          console.log(`[OctobotDual:${this.id}]    - Error type: ${backupError.constructor.name}`);
          console.log(`[OctobotDual:${this.id}]    - Error message: ${backupError.message}`);
          console.log(`[OctobotDual:${this.id}]    - Error status: ${backupError.status || 'N/A'}`);
          console.log(`[OctobotDual:${this.id}]    - Error code: ${backupError.code || 'N/A'}`);
          if (backupError.stack) {
            console.log(`[OctobotDual:${this.id}]    - Stack trace (first 200 chars): ${backupError.stack.substring(0, 200)}`);
          }
          console.log(`[OctobotDual:${this.id}] 💀 Both PRIMARY and BACKUP streams failed - throwing error`);
          throw backupError;
        } finally {
          // Always revert to primary after request completes
          this.switchToPrimary();
        }
      } else {
        console.log(`[OctobotDual:${this.id}] ⚠️ No backup configured - throwing PRIMARY error`);
        throw primaryError;
      }
    }
  }
}
