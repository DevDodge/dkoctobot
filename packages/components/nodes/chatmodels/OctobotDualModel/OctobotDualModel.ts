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
import {
  OctobotDualChatModel,
  DualKeyConfig,
} from "./FlowiseOctobotDualChatModel";

const GATEWAY_BASE_URL = "https://aipilotads.com/api/v1";

/**
 * Fetch models from the Gateway for a given API key.
 */
async function fetchModelsForApiKey(
  apiKey: string,
  emptyLabel: string,
): Promise<INodeOptionsValue[]> {
  if (!apiKey) {
    return [{ label: `⚠️ ${emptyLabel}`, name: "" }];
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
      return [{ label: "No models available for this key", name: "" }];
    }

    return models.map((m) => ({
      label: m.id,
      name: m.id,
    }));
  } catch (err: any) {
    return [{ label: `⚠️ ${err.message}`, name: "" }];
  }
}

class OctobotDualModel_ChatModels implements INode {
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
    this.label = "Octobot Dual Model";
    this.name = "octobotDualModel";
    this.version = 1.0;
    this.type = "OctobotDualModel";
    this.icon = "octobot-dual.svg";
    this.category = "Chat Models";
    this.description =
      "Chat model with dual API key failover — primary + backup keys with automatic fallback on error. Each key fetches its own model list independently.";
    this.baseClasses = [this.type, ...getBaseClasses(LangchainChatOpenAI)];
    this.credential = {
      label: "Connect Credential",
      name: "credential",
      type: "credential",
      credentialNames: ["octobotDualApi"],
    };
    this.inputs = [
      {
        label: "Cache",
        name: "cache",
        type: "BaseCache",
        optional: true,
      },
      {
        label: "Primary Model",
        name: "primaryModel",
        type: "asyncOptions",
        loadMethod: "listPrimaryModels",
        refresh: true,
        description:
          "Select primary model — models are fetched using your Primary API Key",
      },
      {
        label: "Backup Model",
        name: "backupModel",
        type: "asyncOptions",
        loadMethod: "listBackupModels",
        refresh: true,
        optional: true,
        description:
          "Select backup/fallback model — models are fetched using your Backup API Key. Leave empty if you only want a single key.",
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
    /**
     * Fetch models using the primary API key from the credential.
     */
    async listPrimaryModels(
      nodeData: INodeData,
      options: ICommonObject,
    ): Promise<INodeOptionsValue[]> {
      const credentialData = await getCredentialData(
        nodeData.credential ?? "",
        options,
      );
      const primaryKey = getCredentialParam(
        "octobotPrimaryApiKey",
        credentialData,
        nodeData,
      );
      return fetchModelsForApiKey(
        primaryKey,
        "Add primary API key in credential",
      );
    },

    /**
     * Fetch models using the backup API key from the credential.
     */
    async listBackupModels(
      nodeData: INodeData,
      options: ICommonObject,
    ): Promise<INodeOptionsValue[]> {
      const credentialData = await getCredentialData(
        nodeData.credential ?? "",
        options,
      );
      const backupKey = getCredentialParam(
        "octobotBackupApiKey",
        credentialData,
        nodeData,
      );
      if (!backupKey) {
        return [{ label: "No backup key configured", name: "" }];
      }
      return fetchModelsForApiKey(
        backupKey,
        "Add backup API key in credential",
      );
    },
  };

  async init(
    nodeData: INodeData,
    _: string,
    options: ICommonObject,
  ): Promise<any> {
    const temperature = nodeData.inputs?.temperature as string;
    const primaryModel = nodeData.inputs?.primaryModel as string;
    const backupModel = (nodeData.inputs?.backupModel as string) || null;
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
      options,
    );
    const primaryApiKey = getCredentialParam(
      "octobotPrimaryApiKey",
      credentialData,
      nodeData,
    );
    const backupApiKey =
      getCredentialParam("octobotBackupApiKey", credentialData, nodeData) ||
      null;

    const obj: ChatOpenAIFields = {
      temperature: temperature ? parseFloat(temperature) : 0.7,
      model: primaryModel,
      modelName: primaryModel,
      openAIApiKey: primaryApiKey,
      apiKey: primaryApiKey,
      streaming: streaming ?? true,
      configuration: {
        baseURL: GATEWAY_BASE_URL,
        defaultHeaders: {
          Authorization: `Bearer ${primaryApiKey}`,
        },
      },
    };

    if (maxTokens) obj.maxTokens = parseInt(maxTokens, 10);
    if (topP) obj.topP = parseFloat(topP);
    if (frequencyPenalty) obj.frequencyPenalty = parseFloat(frequencyPenalty);
    if (presencePenalty) obj.presencePenalty = parseFloat(presencePenalty);
    if (timeout) obj.timeout = parseInt(timeout, 10);
    if (cache) obj.cache = cache;

    const dualConfig: DualKeyConfig = {
      primaryApiKey,
      backupApiKey,
      primaryModel: primaryModel || "",
      backupModel,
    };

    const multiModalOption: IMultiModalOption = {
      image: {
        allowImageUploads: allowImageUploads ?? false,
        imageResolution,
      },
    };

    const model = new OctobotDualChatModel(nodeData.id, obj, dualConfig);
    model.setMultiModalOption(multiModalOption);
    return model;
  }
}

module.exports = { nodeClass: OctobotDualModel_ChatModels };
