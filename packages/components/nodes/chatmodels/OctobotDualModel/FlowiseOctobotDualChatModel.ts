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
    if (!this.dualConfig.backupApiKey) return;
    this.usingBackup = true;
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
  }

  /**
   * Switch the internal OpenAI client back to the primary API key and model.
   */
  private switchToPrimary(): void {
    this.usingBackup = false;
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
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    try {
      const result = await super._generate(messages, options, runManager);
      return result;
    } catch (error: any) {
      if (!this.usingBackup && this.dualConfig.backupApiKey) {
        this.switchToBackup();
        try {
          const result = await super._generate(messages, options, runManager);
          return result;
        } finally {
          this.switchToPrimary();
        }
      }
      throw error;
    }
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<any> {
    try {
      const generator = super._streamResponseChunks(
        messages,
        options,
        runManager,
      );
      try {
        for await (const chunk of generator) {
          yield chunk;
        }
      } catch (error: any) {
        if (!this.usingBackup && this.dualConfig.backupApiKey) {
          this.switchToBackup();
          const fallbackGen = super._streamResponseChunks(
            messages,
            options,
            runManager,
          );
          try {
            for await (const chunk of fallbackGen) {
              yield chunk;
            }
          } finally {
            this.switchToPrimary();
          }
          return;
        }
        throw error;
      }
    } catch (error: any) {
      if (!this.usingBackup && this.dualConfig.backupApiKey) {
        this.switchToBackup();
        try {
          const fallbackGen = super._streamResponseChunks(
            messages,
            options,
            runManager,
          );
          for await (const chunk of fallbackGen) {
            yield chunk;
          }
        } finally {
          this.switchToPrimary();
        }
        return;
      }
      throw error;
    }
  }
}
