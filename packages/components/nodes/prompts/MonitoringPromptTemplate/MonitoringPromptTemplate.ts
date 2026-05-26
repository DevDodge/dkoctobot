import { INode, INodeData, INodeParams } from "../../../src/Interface";

class MonitoringPromptTemplate_Prompts implements INode {
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
    this.label = "Monitoring Prompt Template";
    this.name = "monitoringPromptTemplate";
    this.version = 1.0;
    this.type = "MonitoringPromptTemplate";
    this.icon = "monitoring-prompt.svg";
    this.category = "AppCity";
    this.description =
      "Universal extraction keys and analysis prompt builder for CRM live monitoring across any business domain.";
    this.baseClasses = [this.type];
    this.inputs = [
      {
        label: "Extraction Keys",
        name: "extractionKeys",
        type: "datagrid",
        description:
          "Define the dynamic parameters of your business that the AI should extract from customer messages.",
        datagrid: [
          {
            field: "key",
            headerName: "Key Name (English code)",
            editable: true,
          },
          {
            field: "display",
            headerName: "Display Name (Arabic UI)",
            editable: true,
          },
          {
            field: "type",
            headerName: "Type",
            type: "singleSelect",
            valueOptions: ["text", "number", "boolean", "select"],
            editable: true,
          },
          {
            field: "options",
            headerName: "Options (comma-separated)",
            flex: 1,
            editable: true,
          },
        ],
      },
      {
        label: "Enable Sentiment Analysis",
        name: "enableSentiment",
        type: "boolean",
        default: true,
        description:
          "Analyze and index customer sentiment (Positive, Neutral, Negative, Mixed) to track customer satisfaction.",
      },
      {
        label: "Custom Alert Rules",
        name: "alertRules",
        type: "datagrid",
        optional: true,
        description:
          "Specify rules to trigger urgent visual notifications/alarms in the CRM when specific business conditions are met.",
        datagrid: [
          { field: "rule_name", headerName: "Rule Name", editable: true },
          {
            field: "alert_level",
            headerName: "Alert Level",
            type: "singleSelect",
            valueOptions: ["none", "warning", "danger"],
            editable: true,
          },
          {
            field: "condition",
            headerName: "Trigger Condition Prompt",
            flex: 1,
            editable: true,
          },
        ],
      },
      {
        label: "Analysis Instructions",
        name: "analysisInstructions",
        type: "string",
        rows: 8,
        default: `You are an expert conversation data analyst and precise customer information extractor.
From the customer's current message and conversation context:
1. Fill the required variable values with absolute accuracy and without any assumptions or guesses.
2. Write a concise note in English summarizing only the new information in a professional and expert manner.
3. Focus on extracting the customer's core desires, budget, specific requirements, or any objections or obstacles that may affect completing the sale.`,
        description:
          "Industry-agnostic prompt instructions that direct the AI model on how to extract parameters for any business.",
      },
    ];
  }

  async init(nodeData: INodeData): Promise<any> {
    const rawKeys = nodeData.inputs?.extractionKeys as string;
    const enableSentiment = nodeData.inputs?.enableSentiment as boolean;
    const rawAlertRules = nodeData.inputs?.alertRules as string;
    const analysisInstructions = nodeData.inputs
      ?.analysisInstructions as string;

    let extractionKeys: any[] = [];
    if (rawKeys) {
      try {
        extractionKeys =
          typeof rawKeys === "string" ? JSON.parse(rawKeys) : rawKeys;
      } catch {
        extractionKeys = [];
      }
    }

    let alertRules: any[] = [];
    if (rawAlertRules) {
      try {
        alertRules =
          typeof rawAlertRules === "string"
            ? JSON.parse(rawAlertRules)
            : rawAlertRules;
      } catch {
        alertRules = [];
      }
    }

    return {
      extractionKeys,
      enableSentiment: enableSentiment ?? true,
      alertRules,
      analysisInstructions: analysisInstructions || "",
    };
  }
}

module.exports = { nodeClass: MonitoringPromptTemplate_Prompts };
