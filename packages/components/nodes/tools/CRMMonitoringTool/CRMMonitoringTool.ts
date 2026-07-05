import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
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
import { TOOL_ARGS_PREFIX, formatToolError } from "../../../src/agents";

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
    this.version = 2.0;
    this.type = "CRMMonitoringTool";
    this.icon = "crm-monitoring.svg";
    this.category = "AppCity";
    this.description =
      "Dynamic monitoring node to extract metadata, sentiment and alerts for any business type. Uses structured input via function calling.";
    this.baseClasses = [
      this.type,
      "StructuredTool",
      "Tool",
      ...getBaseClasses(StructuredTool),
    ];
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

// ── Structured Input Schema ─────────────────────────────────────────
// The LLM sends { message, previousContext } directly via function calling.
// No JSON parsing needed — the framework handles it.

const MonitoringInputSchema = z.object({
  message: z
    .string()
    .describe(
      "The customer's latest message to analyze. Extract new information, sentiment, and check alert rules."
    ),
  previousContext: z
    .string()
    .optional()
    .describe(
      "Optional: Brief summary of the conversation so far to provide context for analysis."
    ),
});

class CRMMonitoringToolImpl extends StructuredTool {
  name = "crm_monitoring_note";
  description =
    "Analyzes customer messages and records key milestones, extracted data, sentiment, and alerts to the CRM dashboard. Call this after EVERY user turn that contains new information.";

  // 🔥 StructuredTool with Zod schema — LLM calls this via function calling
  schema = MonitoringInputSchema;

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

  // @ts-ignore
  async _call(
    arg: z.infer<typeof MonitoringInputSchema>,
    _runManager?: any,
    _config?: any,
    flowConfig?: {
      sessionId?: string;
      chatId?: string;
      input?: string;
      state?: any;
    }
  ): Promise<string> {
    try {
      const message = arg.message;
      const previousContext = arg.previousContext || "";

      // ── Build the analysis prompt dynamically ──
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

      // Build context-aware system prompt
      let systemPrompt = `${this.analysisInstructions}

[Extraction Keys to Find]:
${keysSchema || "None"}

[Sentiment Analysis Enabled]: ${this.enableSentiment ? "Yes" : "No"}

[Business Custom Alert Rules]:
${rulesSchema || "None"}`;

      // If previous context is provided, include it
      if (previousContext) {
        systemPrompt += `\n\n[Conversation Context So Far]:\n${previousContext}`;
      }

      systemPrompt += `\n\nFrom the customer's message, extract information strictly adhering to the configured extraction keys.
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
        // If JSON parsing fails, use the raw content as note
        note = content || message;
      }

      // ── Resolve session ID ──
      const effectiveSessionId =
        flowConfig?.sessionId ||
        flowConfig?.chatId ||
        this.resolvedSessionId ||
        "";

      // ── Send to CRM ──
      const payload = {
        sessionId: effectiveSessionId,
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
        return formatToolError(
          `Monitoring failed: ${result.message || res.status}`,
          payload
        );
      }

      return (
        `Monitoring indexed — sentiment: ${sentiment}, alert: ${alert_level}` +
        TOOL_ARGS_PREFIX +
        JSON.stringify(payload)
      );
    } catch (error: any) {
      return formatToolError(
        `Monitoring Tool system error: ${error.message}`,
        {}
      );
    }
  }
}

module.exports = { nodeClass: CRMMonitoringTool_Tools };
