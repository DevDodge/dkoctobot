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
  INodeOptionsValue,
  INodeParams,
} from "../../../src/Interface";
import {
  getBaseClasses,
  getCredentialData,
  getCredentialParam,
} from "../../../src/utils";
import { OctobotChatModel } from "./FlowiseOctobotChatModel";

const GATEWAY_BASE_URL = "https://aipilotads.com/api/v1";

class OctobotChatModel_ChatModels implements INode {
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
    this.label = "Octobot Chat Model";
    this.name = "octobotChatModel";
    this.version = 1.0;
    this.type = "OctobotChatModel";
    this.icon = "octobot.svg";
    this.category = "Chat Models";
    this.description =
      "Chat model powered by Octobot AI Gateway — supports all configured providers and models with real-time streaming";
    this.baseClasses = [this.type, ...getBaseClasses(LangchainChatOpenAI)];
    this.credential = {
      label: "Connect Credential",
      name: "credential",
      type: "credential",
      credentialNames: ["octobotApi"],
    };
    this.inputs = [
      {
        label: "Cache",
        name: "cache",
        type: "BaseCache",
        optional: true,
      },
      {
        label: "Model Name",
        name: "modelName",
        type: "asyncOptions",
        loadMethod: "listModels",
        refresh: true,
        description: "Select a model from your Octobot Gateway",
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

  //@ts-ignore
  loadMethods = {
    async listModels(
      nodeData: INodeData,
      options: ICommonObject
    ): Promise<INodeOptionsValue[]> {
      const credentialData = await getCredentialData(
        nodeData.credential ?? "",
        options
      );
      const apiKey = getCredentialParam(
        "octobotApiKey",
        credentialData,
        nodeData
      );

      if (!apiKey) {
        return [{ label: "⚠️ Add credential first", name: "" }];
      }

      try {
        const response = await fetch(`${GATEWAY_BASE_URL}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          return [{ label: `⚠️ Auth failed (${response.status})`, name: "" }];
        }

        const json = await response.json();
        const models: Array<{ id: string; display_name?: string }> =
          json.data ?? [];

        if (models.length === 0) {
          return [{ label: "No models available", name: "" }];
        }

        return models.map((m) => ({
          label: m.display_name || m.id,
          name: m.id,
        }));
      } catch (err: any) {
        return [{ label: `⚠️ ${err.message}`, name: "" }];
      }
    },
  };

  async init(
    nodeData: INodeData,
    _: string,
    options: ICommonObject
  ): Promise<any> {
    const temperature = nodeData.inputs?.temperature as string;
    const modelName = nodeData.inputs?.modelName as string;
    const maxTokens = nodeData.inputs?.maxTokens as string;
    const topP = nodeData.inputs?.topP as string;
    const frequencyPenalty = nodeData.inputs?.frequencyPenalty as string;
    const presencePenalty = nodeData.inputs?.presencePenalty as string;
    const timeout = nodeData.inputs?.timeout as string;
    const streaming = nodeData.inputs?.streaming as boolean;
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
      "octobotApiKey",
      credentialData,
      nodeData
    );

    const obj: ChatOpenAIFields = {
      temperature: temperature ? parseFloat(temperature) : 0.7,
      modelName,
      openAIApiKey: apiKey,
      apiKey,
      streaming: streaming ?? true,
      configuration: {
        baseURL: GATEWAY_BASE_URL,
        defaultHeaders: {
          Authorization: `Bearer ${apiKey}`,
        },
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

    const model = new OctobotChatModel(nodeData.id, obj);
    model.setMultiModalOption(multiModalOption);
    return model;
  }
}

module.exports = { nodeClass: OctobotChatModel_ChatModels };
