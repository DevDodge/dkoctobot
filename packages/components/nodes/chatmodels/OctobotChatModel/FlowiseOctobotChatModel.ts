import {
  ChatOpenAI as LangchainChatOpenAI,
  ChatOpenAIFields,
} from "@langchain/openai";
import { IMultiModalOption, IVisionChatModal } from "../../../src";

export class OctobotChatModel
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
    // Ensure model is set for @langchain/openai v0.6+
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
}
