import {
  ChatOpenAI as LangchainChatOpenAI,
  ChatOpenAIFields,
} from "@langchain/openai";
import { IMultiModalOption, IVisionChatModal } from "../../../src";
import { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { ChatResult } from "@langchain/core/outputs";
import { BaseMessage } from "@langchain/core/messages";
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
    // Also revert to primary key
    this.switchToPrimary();
  }

  setMultiModalOption(multiModalOption: IMultiModalOption): void {
    this.multiModalOption = multiModalOption;
  }

  setVisionModel(): void {
    // pass
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
    const backupKeyPreview = `${this.dualConfig.backupApiKey.substring(0, 8)}...${this.dualConfig.backupApiKey.substring(this.dualConfig.backupApiKey.length - 4)}`;
    console.log(`[OctobotDual:${this.id}] 🔄 Switching to BACKUP`);
    console.log(`[OctobotDual:${this.id}]    - Backup API Key: ${backupKeyPreview}`);
    console.log(`[OctobotDual:${this.id}]    - Backup Model: ${this.dualConfig.backupModel || '(same as primary)'}`);

    // @ts-ignore — replace internal client
    this.client = new OpenAI({
      apiKey: this.dualConfig.backupApiKey,
      baseURL: GATEWAY_BASE_URL,
      defaultHeaders: {
        Authorization: `Bearer ${this.dualConfig.backupApiKey}`,
      },
    });
    if (this.dualConfig.backupModel) {
      this.model = this.dualConfig.backupModel;
      // @ts-ignore
      this.modelName = this.dualConfig.backupModel;
    }
    console.log(`[OctobotDual:${this.id}] ✅ Switched to backup successfully`);
  }

  /**
   * Switch the internal OpenAI client back to the primary API key and model.
   */
  private switchToPrimary(): void {
    this.usingBackup = false;
    const primaryKeyPreview = `${this.dualConfig.primaryApiKey.substring(0, 8)}...${this.dualConfig.primaryApiKey.substring(this.dualConfig.primaryApiKey.length - 4)}`;
    console.log(`[OctobotDual:${this.id}] 🔄 Switching to PRIMARY`);
    console.log(`[OctobotDual:${this.id}]    - Primary API Key: ${primaryKeyPreview}`);
    console.log(`[OctobotDual:${this.id}]    - Primary Model: ${this.dualConfig.primaryModel}`);

    // @ts-ignore — replace internal client
    this.client = new OpenAI({
      apiKey: this.dualConfig.primaryApiKey,
      baseURL: GATEWAY_BASE_URL,
      defaultHeaders: {
        Authorization: `Bearer ${this.dualConfig.primaryApiKey}`,
      },
    });
    this.model = this.dualConfig.primaryModel;
    // @ts-ignore
    this.modelName = this.dualConfig.primaryModel;
    console.log(`[OctobotDual:${this.id}] ✅ Switched to primary successfully`);
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    console.log(`[OctobotDual:${this.id}] 🚀 Starting _generate (non-streaming)`);

    // Always start with primary
    this.switchToPrimary();

    try {
      console.log(`[OctobotDual:${this.id}] 📤 Calling PRIMARY endpoint...`);
      const result = await super._generate(messages, options, runManager);
      console.log(`[OctobotDual:${this.id}] ✅ PRIMARY _generate completed successfully`);
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

    // Always start with primary
    this.switchToPrimary();

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
