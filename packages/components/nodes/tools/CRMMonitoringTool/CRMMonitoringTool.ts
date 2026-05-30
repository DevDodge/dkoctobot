import { Tool } from "@langchain/core/tools";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  INode,
  INodeData,
  INodeParams,
  ICommonObject,
} from "../../../src/Interface";
import {
  getBaseClasses,
  convertMultiOptionsToStringArray,
} from "../../../src/utils";
import { TOOL_ARGS_PREFIX } from "../../../src/agents";

class CRMMonitoringTool_Tools implements INode {
  label: string;
  name: string;
  version: number;
  description: string;
  type: string;
  icon: string;
  category: string;
  baseClasses: string[];
  inputs: INodeParams[];

  constructor() {
    this.label = "CRM Monitoring Tool";
    this.name = "crmMonitoringTool";
    this.version = 1.0;
    this.type = "CRMMonitoringTool";
    this.icon = "crm-monitoring.svg";
    this.category = "AppCity";
    this.description =
      "Dynamic monitoring node to extract metadata, sentiment and alerts for any business type.";
    this.baseClasses = [this.type, "Tool", ...getBaseClasses(Tool)];
    this.inputs = [
      {
        label: "Chat Model",
        name: "model",
        type: "BaseChatModel",
        description:
          "Select the high-speed economical LLM model for background monitoring.",
      },
      {
        label: "Monitoring Prompt Template",
        name: "monitoringPrompt",
        type: "MonitoringPromptTemplate",
        description:
          "Connect the Monitoring Prompt Template here to define business keys.",
      },
      {
        label: "CRM Base URL",
        name: "crmBaseUrl",
        type: "string",
        default: "https://crm.octobot.it.com",
        description: "The secure host address for your CRM backend",
      },
      {
        label: "API Key",
        name: "apiKey",
        type: "password",
        description:
          "The secure API integration key associated with this brand.",
      },
      {
        label: "Variables",
        name: "variables",
        type: "multiOptions",
        options: [
          {
            label: "Session ID",
            name: "sessionId",
            description:
              "Uses $flow.sessionId – vital for keeping analytics tied to chats.",
          },
        ],
        optional: true,
      },
    ];
  }

  async init(
    nodeData: INodeData,
    _: string,
    _options: ICommonObject
  ): Promise<any> {
    const crmBaseUrl = (
      (nodeData.inputs?.crmBaseUrl as string) || "https://crm.octobot.it.com"
    ).replace(/\/+$/, "");
    const apiKey = nodeData.inputs?.apiKey as string;
    const model = nodeData.inputs?.model as BaseChatModel;
    const monitoringPrompt = nodeData.inputs?.monitoringPrompt as any;

    const selectedVars = convertMultiOptionsToStringArray(
      nodeData.inputs?.variables
    );
    const useFlowSessionId = selectedVars.includes("sessionId");
    const resolvedSessionId = useFlowSessionId
      ? (_options.sessionId as string) || (_options.chatId as string) || ""
      : "";

    return new CRMMonitoringToolImpl({
      crmBaseUrl,
      apiKey,
      model,
      extractionKeys: monitoringPrompt?.extractionKeys || [],
      enableSentiment: monitoringPrompt?.enableSentiment ?? true,
      alertRules: monitoringPrompt?.alertRules || [],
      analysisInstructions: monitoringPrompt?.analysisInstructions || "",
      resolvedSessionId,
    });
  }
}

interface ToolConfig {
  crmBaseUrl: string;
  apiKey: string;
  model: BaseChatModel;
  extractionKeys: any[];
  enableSentiment: boolean;
  alertRules: any[];
  analysisInstructions: string;
  resolvedSessionId: string;
}

class CRMMonitoringToolImpl extends Tool {
  name = "crm_monitoring_note";
  description = `Silently records key milestones and user parameters to CRM dashboard.
Input is the customer's last message.
Format: {"message": "<customer raw message>"}
Call after EVERY user turn that provides new information.`;

  private crmBaseUrl: string;
  private apiKey: string;
  private model: BaseChatModel;
  private extractionKeys: any[];
  private enableSentiment: boolean;
  private alertRules: any[];
  private analysisInstructions: string;
  private resolvedSessionId: string;

  constructor(config: ToolConfig) {
    super();
    this.crmBaseUrl = config.crmBaseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.extractionKeys = config.extractionKeys;
    this.enableSentiment = config.enableSentiment;
    this.alertRules = config.alertRules;
    this.analysisInstructions = config.analysisInstructions;
    this.resolvedSessionId = config.resolvedSessionId;
  }

  async _call(input: string): Promise<string> {
    try {
      let message: string;
      try {
        const parsed = JSON.parse(input);
        message = parsed.message || parsed.input || input;
      } catch {
        message = input;
      }

      const keysSchema = this.extractionKeys
        .map((k) => {
          const opts = k.options ? `, options: [${k.options}]` : "";
          return `  - "${k.key}": "${k.display}" (type: ${k.type}${opts})`;
        })
        .join("\n");

      const rulesSchema = this.alertRules
        .map((r, i) => {
          return `  Rule ${i + 1}: Name "${r.rule_name}" [Level: ${
            r.alert_level
          }] -> trigger condition: "${r.condition}"`;
        })
        .join("\n");

      const systemPrompt = `${this.analysisInstructions}

[Extraction Keys to Find]:
${keysSchema || "None"}

[Sentiment Analysis Enabled]: ${this.enableSentiment ? "Yes" : "No"}

[Business Custom Alert Rules]:
${rulesSchema || "None"}

From the customer's message, extract information strictly adhering to the configured extraction keys.
Return a clean, raw JSON output without any markdown fence or text formatting.

Output structure:
{
  "note": "Concise professional note summarizing only the new information, adhering strictly to the language specified in the system message",
  "keys": {
     // only populate keys that were explicitly discovered/updated in this message
  },
  "sentiment": "positive" | "neutral" | "negative" | "mixed",
  "alert_level": "none" | "warning" | "danger",
  "alert_reason": "why warning/danger alert triggered, empty string if none"
}`;

      const response = await this.model.invoke([
        ["system", systemPrompt],
        ["user", `Message: "${message}"`],
      ]);

      const content = (
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content)
      ).trim();

      let note = message;
      let keys: Record<string, any> = {};
      let sentiment = "neutral";
      let alert_level = "none";
      let alert_reason = "";

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          note = parsed.note || message;
          keys = parsed.keys || {};
          if (this.enableSentiment) sentiment = parsed.sentiment || "neutral";
          alert_level = parsed.alert_level || "none";
          alert_reason = parsed.alert_reason || "";
        }
      } catch {
        note = message;
      }

      const payload = {
        sessionId: this.resolvedSessionId,
        note,
        keys,
        sentiment,
        alertLevel: alert_level,
        alertReason: alert_reason,
        keyDefinitions: this.extractionKeys,
      };

      const res = await fetch(
        `${this.crmBaseUrl}/api/integration/monitoring/note`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": this.apiKey,
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await res.json();

      if (!res.ok) {
        const errMsg = `Monitoring failed: ${result.message || res.status}`;
        return errMsg + TOOL_ARGS_PREFIX + JSON.stringify(payload);
      }

      return `Monitoring indexed.` + TOOL_ARGS_PREFIX + JSON.stringify(payload);
    } catch (error: any) {
      return `Monitoring Tool system error: ${error.message}`;
    }
  }
}

module.exports = { nodeClass: CRMMonitoringTool_Tools };
