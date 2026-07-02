import {
  ChatOpenAI as LangchainChatOpenAI,
  ChatOpenAIFields,
} from "@langchain/openai";
import { BaseCache } from "@langchain/core/caches";
import {
  ICommonObject,
  IMultiModalOption,
  INode,
  INodeData,
  INodeParams,
} from "../../../src/Interface";
import {
  getBaseClasses,
  getCredentialData,
  getCredentialParam,
} from "../../../src/utils";
import { OrbitChatModel } from "./OrbitChatModelBase";

class OrbitChatModel_ChatModels implements INode {
  label: string;
  name: string;
  version: number;
  type: string;
  icon: string;
  category: string;
  description: string;
  baseClasses: string[];
  credential: INodeParams;
  inputs: INodeParams[];

  constructor() {
    this.label = "OctoModel";
    this.name = "octoModel";
    this.version = 1.0;
    this.type = "OrbitChatModel";
    this.icon = "orbit.svg";
    this.category = "Chat Models";
    this.description =
      "Chat model for any OpenAI-compatible API endpoint — type your own Base URL and Model ID";
    this.baseClasses = [this.type, ...getBaseClasses(LangchainChatOpenAI)];
    this.credential = {
      label: "Connect Credential",
      name: "credential",
      type: "credential",
      credentialNames: ["orbitApi"],
    };
    this.inputs = [
      {
        label: "Cache",
        name: "cache",
        type: "BaseCache",
        optional: true,
      },
      {
        label: "Base URL",
        name: "baseURL",
        type: "string",
        placeholder: "https://api.orbit-provider.com/v1",
        description: "OpenAI-compatible API base URL (e.g. https://api.orbit-provider.com/v1)",
      },
      {
        label: "Model ID",
        name: "modelName",
        type: "string",
        placeholder: "claude-opus-4-8",
        description: "Model identifier your provider expects (e.g. claude-opus-4-8, gpt-4o)",
      },
      {
        label: "Temperature",
        name: "temperature",
        type: "number",
        step: 0.1,
        default: 0.7,
        optional: true,
      },
      {
        label: "Streaming",
        name: "streaming",
        type: "boolean",
        default: true,
        optional: true,
        additionalParams: true,
        description: "Stream tokens as they are generated (live typing effect)",
      },
      {
        label: "Max Tokens",
        name: "maxTokens",
        type: "number",
        step: 1,
        optional: true,
        additionalParams: true,
      },
      {
        label: "Top Probability",
        name: "topP",
        type: "number",
        step: 0.1,
        optional: true,
        additionalParams: true,
      },
      {
        label: "Frequency Penalty",
        name: "frequencyPenalty",
        type: "number",
        step: 0.1,
        optional: true,
        additionalParams: true,
      },
      {
        label: "Presence Penalty",
        name: "presencePenalty",
        type: "number",
        step: 0.1,
        optional: true,
        additionalParams: true,
      },
      {
        label: "Timeout",
        name: "timeout",
        type: "number",
        step: 1,
        optional: true,
        additionalParams: true,
      },
      {
        label: "Allow Image Uploads",
        name: "allowImageUploads",
        type: "boolean",
        default: false,
        optional: true,
      },
      {
        label: "Image Resolution",
        name: "imageResolution",
        type: "options",
        options: [
          { label: "Low", name: "low" },
          { label: "High", name: "high" },
          { label: "Auto", name: "auto" },
        ],
        default: "low",
        optional: false,
        show: { allowImageUploads: true },
      },
    ];
  }

  async init(
    nodeData: INodeData,
    _: string,
    options: ICommonObject
  ): Promise<any> {
    const baseURL = nodeData.inputs?.baseURL as string;
    const modelName = nodeData.inputs?.modelName as string;
    const temperature = nodeData.inputs?.temperature as string;
    const maxTokens = nodeData.inputs?.maxTokens as string;
    const topP = nodeData.inputs?.topP as string;
    const frequencyPenalty = nodeData.inputs?.frequencyPenalty as string;
    const presencePenalty = nodeData.inputs?.presencePenalty as string;
    const timeout = nodeData.inputs?.timeout as string;
    const cache = nodeData.inputs?.cache as BaseCache;
    const allowImageUploads = nodeData.inputs?.allowImageUploads as boolean;
    const imageResolution = nodeData.inputs?.imageResolution as string;

    if (nodeData.inputs?.credentialId) {
      nodeData.credential = nodeData.inputs?.credentialId;
    }

    const credentialData = await getCredentialData(
      nodeData.credential ?? "",
      options
    );
    const apiKey = getCredentialParam(
      "orbitApiKey",
      credentialData,
      nodeData
    );

    if (!baseURL) {
      throw new Error("Base URL is required");
    }

    if (!modelName) {
      throw new Error("Model ID is required");
    }

    const obj: ChatOpenAIFields = {
      temperature: temperature ? parseFloat(temperature) : 0.7,
      model: modelName,
      modelName,
      openAIApiKey: apiKey ?? "sk-",
      apiKey: apiKey ?? "sk-",
      streaming: false,
      disableStreaming: true,
      streamUsage: false,
      configuration: {
        baseURL,
      },
    };

    if (maxTokens) obj.maxTokens = parseInt(maxTokens, 10);
    if (topP) obj.topP = parseFloat(topP);
    if (frequencyPenalty) obj.frequencyPenalty = parseFloat(frequencyPenalty);
    if (presencePenalty) obj.presencePenalty = parseFloat(presencePenalty);
    if (timeout) obj.timeout = parseInt(timeout, 10);
    if (cache) obj.cache = cache;

    const multiModalOption: IMultiModalOption = {
      image: {
        allowImageUploads: allowImageUploads ?? false,
        imageResolution,
      },
    };

    const model = new OrbitChatModel(nodeData.id, obj);
    model.setMultiModalOption(multiModalOption);
    return model;
  }
}

module.exports = { nodeClass: OrbitChatModel_ChatModels };
