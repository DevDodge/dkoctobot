import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  ICommonObject,
  INode,
  INodeData,
  INodeOptionsValue,
  INodeParams,
} from "../../../src/Interface";
import {
  getBaseClasses,
  convertMultiOptionsToStringArray,
} from "../../../src/utils";
import { TOOL_ARGS_PREFIX, formatToolError } from "../../../src/agents";

// Placeholder that indicates "not yet generated"
const TOOL_DESC_PLACEHOLDER = `⚠️ Click refresh on "Get Key Mapping" above, then copy the generated prompt here.

This field must contain the exact key names from your CRM client.
Each client has different column keys — do NOT use generic names like "name" or "phone".`;

// ── Smart Alias Map — fuzzy matches common field names to CRM keys ──
const FIELD_ALIAS_MAP: Record<string, string[]> = {
  clientName: [
    "name", "customer_name", "fullName", "full_name", "client_name",
    "الاسم", "اسم", "اسم العميل", "العميل", "customer", "client",
  ],
  clientPhone: [
    "phone", "mobile", "tel", "telephone", "contact", "phoneNumber",
    "رقم", "موبايل", "تليفون", "هاتف", "رقم الموبايل", "رقم الهاتف",
    "رقم التواصل", "جوال", "contact_number", "phone_number", "mobile_number",
  ],
  sessionId: [
    "session", "session_id", "sessionid", "chatId", "chat_id", "chatid",
    "معرف", "الجلسة", "معرف الجلسة",
  ],
  orderDetails: [
    "details", "order", "product", "description", "items", "order_detail",
    "تفاصيل", "الاوردر", "المنتج", "تفاصيل الاوردر", "الطلب",
    "order_description", "what", "item", "service", "package",
  ],
  orderPrice: [
    "price", "total", "amount", "cost", "total_price", "order_total",
    "سعر", "المبلغ", "الاجمالي", "السعر", "سعر الاوردر", "التكلفة",
    "totalPrice", "grand_total", "sum",
  ],
  orderStatus: [
    "status", "حالة", "الحالة", "order_status", "حالة الاوردر",
  ],
  governorate: [
    "governorate", "محافظة", "city", "region", "مدينة", "منطقة",
    "govern", "province", "state",
  ],
  address: [
    "address", "clientAddress", "client_address", "location", "fullAddress", "full_address", "street",
    "عنوان", "مكان", "العنوان", "عنوان الشحن", "shipping_address", "delivery_address", "deliveryAddress",
  ],
  email: [
    "email", "mail", "e_mail", "بريد", "الايميل", "البريد",
    "البريد الإلكتروني", "الايميل الالكتروني",
  ],
  quantity: [
    "quantity", "qty", "count", "amount", "كمية", "الكمية", "عدد", "qty",
  ],
};

/**
 * Normalize keys by fuzzy-matching common field names to CRM column keys.
 * Also handles Arabic ↔ English equivalences.
 */
function normalizeAttributeKeys(
  attributes: { key: string; value: string }[],
  _columns?: any[]
): { key: string; value: string }[] {
  return attributes.map((attr) => {
    const lowerKey = attr.key.toLowerCase().trim();

    // Already a known CRM key? Skip normalization
    for (const knownKey of Object.keys(FIELD_ALIAS_MAP)) {
      if (lowerKey === knownKey.toLowerCase()) {
        return attr;
      }
    }

    // Check alias map
    for (const [knownKey, aliases] of Object.entries(FIELD_ALIAS_MAP)) {
      for (const alias of aliases) {
        if (lowerKey === alias.toLowerCase()) {
          return { key: knownKey, value: attr.value };
        }
      }
    }

    // Check if any alias is a substring of the key (and vice versa)
    for (const [knownKey, aliases] of Object.entries(FIELD_ALIAS_MAP)) {
      for (const alias of aliases) {
        if (lowerKey.includes(alias.toLowerCase()) || alias.toLowerCase().includes(lowerKey)) {
          return { key: knownKey, value: attr.value };
        }
      }
    }

    // No match found — keep original key (CRM may add it dynamically)
    return attr;
  });
}

class CRMOrderTool_Tools implements INode {
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
    this.label = "CRM Order Tool";
    this.name = "crmOrderTool";
    this.version = 2.0;
    this.type = "CRMOrderTool";
    this.icon = "crm-order.svg";
    this.category = "AppCity";
    this.description =
      "Create or update orders in the CRM system via API key integration. Uses dynamic schema from CRM columns — works automatically with any client configuration.";
    this.baseClasses = [
      this.type,
      "StructuredTool",
      "Tool",
      ...getBaseClasses(StructuredTool),
    ];
    this.inputs = [
      {
        label: "CRM Base URL",
        name: "crmBaseUrl",
        type: "string",
        default: "https://crm.octobot.it.com",
        description: "Base URL of the CRM backend server",
      },
      {
        label: "API Key",
        name: "apiKey",
        type: "password",
        description:
          "Integration API key from CRM (found in Integration Keys page). This key is tied to a specific client.",
      },
      // ── Variables dropdown ──
      {
        label: "Variables",
        name: "variables",
        type: "multiOptions",
        description:
          "Select flow variables to use in the tool. Selected variables are automatically resolved at runtime.",
        options: [
          {
            label: "Session ID",
            name: "sessionId",
            description:
              "Uses $flow.sessionId – the chat session identifier from the current workflow session",
          },
        ],
        optional: true,
      },
      // ── Orders Actions ──
      {
        label: "Orders Actions",
        name: "ordersActions",
        type: "multiOptions",
        description:
          "Select which CRM order actions to enable (defaults to Create Order if left empty)",
        options: [
          {
            label: "Create Order",
            name: "createOrder",
            description: "Create a new order in the CRM",
          },
          {
            label: "Update Order",
            name: "updateOrder",
            description: "Update an existing order in the CRM via sessionId",
          },
        ],
        optional: true,
      },
      {
        label: "Get Key Mapping",
        name: "keyMapping",
        type: "asyncOptions",
        loadMethod: "getKeyMapping",
        description:
          'Click refresh → select "📋 Generated Tool Description" → copy the text from the description tooltip → paste into Tool Description below.',
        refresh: true,
        optional: true,
      },
      {
        label: "Tool Name",
        name: "toolName",
        type: "string",
        default: "create_crm_order",
        description: "Name the agent will use to call this tool",
        optional: true,
        additionalParams: true,
      },
      {
        label: "Tool Description",
        name: "toolDescription",
        type: "string",
        rows: 6,
        default: TOOL_DESC_PLACEHOLDER,
        description:
          'Paste the generated prompt from "Get Key Mapping" here. Click the ↗️ expand button for a full-screen editor. Leave empty for auto-generation from CRM.',
        optional: true,
        additionalParams: true,
      },
    ];
  }

  //@ts-ignore
  loadMethods = {
    getKeyMapping: async (
      nodeData: INodeData,
      _options: ICommonObject
    ): Promise<INodeOptionsValue[]> => {
      try {
        const crmBaseUrl = (
          (nodeData.inputs?.crmBaseUrl as string) ||
          "https://crm.octobot.it.com"
        ).replace(/\/+$/, "");
        const apiKey = nodeData.inputs?.apiKey as string;

        if (!apiKey) {
          return [
            {
              label: "⚠️ Enter API Key first, then click refresh",
              name: "error",
              description: "API Key is required to fetch key mappings.",
            },
          ];
        }

        const url = `${crmBaseUrl}/api/integration/columns`;
        const response = await fetch(url, {
          method: "GET",
          headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        });

        if (!response.ok) {
          const err = await response.text();
          let msg = `${response.status}`;
          try {
            msg = JSON.parse(err).message || msg;
          } catch {
            /* ignore parse error */
          }
          return [
            {
              label: `❌ ${msg}`,
              name: "error",
              description: "Check URL and API Key",
            },
          ];
        }

        const result = (await response.json()) as any;
        if (!result.success) {
          return [{ label: `❌ ${result.message || "Error"}`, name: "error" }];
        }

        const columns = result.columns || [];
        if (columns.length === 0) {
          return [
            {
              label: `✅ ${result.client} (${result.brand}) — No columns configured`,
              name: "no_columns",
              description: "Add columns in the CRM Orders page first.",
            },
          ];
        }

        // === Generate the Tool Description prompt ===
        const fmtOpts = (o: any) => {
          if (!o) return "";
          if (typeof o === "string") return o.trim() || "";
          if (typeof o === "object" && Object.keys(o).length === 0) return "";
          if (Array.isArray(o) && o.length === 0) return "";
          return JSON.stringify(o);
        };
        const keyLines = columns
          .filter((col: any) => col.key_name.toLowerCase() !== "sessionid" && col.key_name.toLowerCase() !== "session_id")
          .map((col: any) => {
            const optsStr = fmtOpts(col.options);
            const opts = optsStr ? ` (options: ${optsStr})` : "";
            return `    { "key": "${col.key_name}", "value": "<${
              col.display_name
            }>" }  // ${col.type || "text"}${opts}`;
          })
          .join(",\n");

        const toolDescPromptCreate = `Create a new order in the CRM system for ${result.client} (${result.brand}).

IMPORTANT: Do NOT call this tool unless the customer explicitly confirms the order.
Always verify all details with the customer first.

Call this tool with an "attributes" parameter — an array of key-value objects:
attributes: [
${keyLines}
]

Do NOT include sessionId in attributes — the system injects it automatically.

You MUST use these EXACT key names. Do not translate or rename them.`;

        const toolDescPromptUpdate = `Update an existing order in the CRM system for ${result.client} (${result.brand}).

IMPORTANT: This tool updates only the keys specified in the attributes array. All other non-specified keys will remain untouched.

Call this tool with an "attributes" parameter — an array of key-value objects:
attributes: [
${keyLines}
]

Do NOT include sessionId in attributes — the system injects it automatically.

You MUST use these EXACT key names. Do not translate or rename them.`;

        // === Generate ERP Agent Prompt snippet ===
        const fieldList = columns
          .map((col: any) => {
            const optsStr = fmtOpts(col.options);
            const opts = optsStr ? ` [${optsStr}]` : "";
            return `  - **${col.display_name}** → key: "${col.key_name}" (${
              col.type || "text"
            })${opts}`;
          })
          .join("\n");

        const erpPromptSnippet = `### Order Management — ${result.client} (${result.brand})
- **Tool**: create_crm_order (or update_crm_order)
- **When to use**: Customer confirms they want to place or update an order
- **Required fields** (collect ALL before creating):
${fieldList}
- **Workflow**: Collect all fields → Summarize → Get confirmation → Submit → Report result
- **On success**: Share the order ID with the customer
- **On error**: Apologize and offer to retry`;

        // === Return items ===
        const items: INodeOptionsValue[] = [];

        // Generated Tool Description - Create
        items.push({
          label: `📋 Generated Tool Description (Create) — Copy into "Tool Description"`,
          name: "tool_desc_prompt_create",
          description: toolDescPromptCreate,
        });

        // Generated Tool Description - Update
        items.push({
          label: `📋 Generated Tool Description (Update)`,
          name: "tool_desc_prompt_update",
          description: toolDescPromptUpdate,
        });

        // ERP Agent Prompt snippet
        items.push({
          label: `📝 ERP Prompt Snippet — Copy into ERP Agent Prompt "Applications & Tools"`,
          name: "erp_prompt_snippet",
          description: erpPromptSnippet,
        });

        // Schema info for structured tool
        items.push({
          label: `📐 Dynamic Schema Active — ${columns.length} fields auto-detected from CRM`,
          name: "schema_info",
          description: `The tool uses a dynamic Zod schema built from CRM columns. The AI agent will see these fields via function calling: ${columns.map((c: any) => c.key_name).join(", ")}`,
        });

        // Connection info
        items.push({
          label: `✅ ${result.client} (${result.brand}) — ${columns.length} keys loaded`,
          name: "info",
          description: `Client: ${result.client} | Brand: ${
            result.brand
          } | Keys: ${columns.map((c: any) => c.key_name).join(", ")}`,
        });

        // Individual keys for reference
        for (const col of columns) {
          const opts = col.options ? ` [${col.options}]` : "";
          items.push({
            label: `🔑 ${col.key_name} → "${col.display_name}" (${
              col.type || "text"
            })${opts}`,
            name: col.key_name,
            description: `Key: ${col.key_name} | Display: ${
              col.display_name
            } | Type: ${col.type || "text"}${opts}`,
          });
        }

        return items;
      } catch (error: any) {
        return [
          {
            label: "❌ Connection failed",
            name: "error",
            description: `${error.message}. Check that CRM is running.`,
          },
        ];
      }
    },
  };

  async init(
    nodeData: INodeData,
    _: string,
    _options: ICommonObject
  ): Promise<any> {
    const crmBaseUrl = (
      (nodeData.inputs?.crmBaseUrl as string) || "https://crm.octobot.it.com"
    ).replace(/\/+$/, "");
    const apiKey = nodeData.inputs?.apiKey as string;

    const selectedVars = convertMultiOptionsToStringArray(
      nodeData.inputs?.variables
    );
    const useFlowSessionId = selectedVars.includes("sessionId");

    // Resolve sessionId at init time from options (passed by the framework)
    const resolvedSessionId = useFlowSessionId
      ? (_options.sessionId as string) || (_options.chatId as string) || ""
      : "";

    let actions = convertMultiOptionsToStringArray(
      nodeData.inputs?.ordersActions
    );
    // Backward compatibility: default to createOrder if none configured
    if (actions.length === 0) {
      actions = ["createOrder"];
    }

    if (!apiKey) {
      throw new Error(
        "API Key is required. Generate one from the CRM Integration Keys page."
      );
    }

    // ── Fetch CRM columns for dynamic schema building ──
    let columns: any[] = [];
    try {
      const columnsUrl = `${crmBaseUrl}/api/integration/columns`;
      const colResponse = await fetch(columnsUrl, {
        method: "GET",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      });
      if (colResponse.ok) {
        const colResult = (await colResponse.json()) as any;
        if (colResult.success && colResult.columns?.length > 0) {
          columns = colResult.columns;
        }
      }
    } catch {
      // Non-fatal: the tool can still work without columns (no schema validation)
      console.warn("[CRMOrderTool] Could not fetch columns from CRM. Schema will be minimal.");
    }

    const tools: StructuredTool[] = [];

    // If 'createOrder' is enabled
    if (actions.includes("createOrder")) {
      const toolName =
        (nodeData.inputs?.toolName as string) || "create_crm_order";
      let toolDescription = (nodeData.inputs?.toolDescription as string) || "";

      if (!toolDescription || isPlaceholder(toolDescription)) {
        toolDescription = await getOnTheFlyDescription(
          crmBaseUrl,
          apiKey,
          "create"
        );
      }

      tools.push(
        // @ts-ignore
        new CRMOrderToolImpl({
          crmBaseUrl,
          apiKey,
          toolName,
          toolDescription,
          action: "create",
          useFlowSessionId,
          resolvedSessionId,
          columns,
        })
      );
    }

    // If 'updateOrder' is enabled
    if (actions.includes("updateOrder")) {
      const baseToolName =
        (nodeData.inputs?.toolName as string) || "create_crm_order";
      const updateToolName =
        baseToolName.replace("create", "update").replace("Create", "Update") ===
        baseToolName
          ? `${baseToolName}_update`
          : baseToolName
              .replace("create", "update")
              .replace("Create", "Update");

      const toolDescription = await getOnTheFlyDescription(
        crmBaseUrl,
        apiKey,
        "update"
      );

      tools.push(
        // @ts-ignore
        new CRMOrderToolImpl({
          crmBaseUrl,
          apiKey,
          toolName: updateToolName,
          toolDescription,
          action: "update",
          useFlowSessionId,
          resolvedSessionId,
          columns,
        })
      );
    }

    return tools.length === 1 ? tools[0] : tools;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Check if a tool description is still a placeholder (not yet configured).
 */
function isPlaceholder(desc: string): boolean {
  if (!desc || desc.trim().length === 0) return true;
  const placeholderPatterns = [
    "⚠️",
    "Click refresh",
    "copy the generated",
    "generated prompt here",
    "enter api key first",
  ];
  return placeholderPatterns.some((p) => desc.toLowerCase().includes(p.toLowerCase()));
}

/**
 * Fetch CRM columns and auto-generate a tool description on the fly.
 */
async function getOnTheFlyDescription(
  crmBaseUrl: string,
  apiKey: string,
  actionType: "create" | "update"
): Promise<string> {
  try {
    const url = `${crmBaseUrl}/api/integration/columns`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    });
    if (response.ok) {
      const result = (await response.json()) as any;
      if (result.success && result.columns?.length > 0) {
        const keyLines = result.columns
          .filter((col: any) => col.key_name.toLowerCase() !== "sessionid" && col.key_name.toLowerCase() !== "session_id")
          .map((col: any) => {
            const opts = col.options ? ` (options: ${col.options})` : "";
            return `    { "key": "${col.key_name}", "value": "<${
              col.display_name
            }>" }  // ${col.type || "text"}${opts}`;
          })
          .join(",\n");

        if (actionType === "create") {
          return `Create a new order in the CRM system for ${result.client} (${result.brand}).

IMPORTANT: Do NOT call this tool unless the customer explicitly confirms the order.

Call this tool with an "attributes" parameter — an array of key-value objects:
attributes: [
${keyLines}
]

Do NOT include sessionId in attributes — the system injects it automatically.

You MUST use these EXACT key names. Do not translate or rename them.`;
        } else {
          return `Update an existing order in the CRM system for ${result.client} (${result.brand}).

IMPORTANT: This tool updates only the keys specified. All other fields will remain untouched.

Call this tool with an "attributes" parameter — an array of key-value objects:
attributes: [
${keyLines}
]

Do NOT include sessionId in attributes — the system injects it automatically.

You MUST use these EXACT key names. Do not translate or rename them.`;
        }
      }
    }
  } catch {
    // Fallback — return a minimal description
  }

  // Minimal fallback description
  if (actionType === "create") {
    return "Create a new order in the CRM system. Provide any known customer information — all fields are optional. The system will automatically map your input to the correct CRM fields.";
  } else {
    return "Update an existing order in the CRM system. Provide the sessionId and any fields to update. All fields are optional — only specified fields will be changed.";
  }
}

// ── Tool Implementation Config ──────────────────────────────────────

interface CRMOrderToolConfig {
  crmBaseUrl: string;
  apiKey: string;
  toolName: string;
  toolDescription: string;
  action: "create" | "update";
  useFlowSessionId: boolean;
  resolvedSessionId: string;
  columns: any[];
}

// ── Dynamic Schema Builder ──────────────────────────────────────────

/**
 * Build a Zod schema dynamically from CRM column definitions.
 * Every field is optional — the LLM sends only what it knows.
 * Number fields accept both numbers and numeric strings.
 */
function buildDynamicSchema(columns: any[]): z.ZodObject<any> {
  // All schemas include an optional "attributes" array for the LLM to send key-value pairs
  // directly (matching the tool description format). Flat fields also accepted via .passthrough().
  const attributesField: any = z
    .array(
      z.object({
        key: z.string().describe("CRM column key name"),
        value: z.string().describe("CR column value"),
      })
    )
    .optional()
    .describe("Array of key-value pairs representing CRM order fields");

  if (!columns || columns.length === 0) {
    // Minimal fallback: accept flat fields + attributes array
    return z.object({
      attributes: attributesField,
      clientName: z.string().optional().describe("Customer's full name"),
      clientPhone: z.string().optional().describe("Customer's phone number"),
      orderDetails: z.string().optional().describe("Order details — what the customer wants"),
      orderPrice: z
        .union([z.number(), z.string().transform((v) => Number(v))])
        .optional()
        .describe("Order total price"),
      orderStatus: z.string().optional().describe("Order status — use \"جديد\" as default"),
      sessionId: z.string().optional().describe("Session identifier — auto-injected, can be omitted"),
      governorate: z.string().optional().describe("Customer's governorate/city"),
      clientAddress: z.string().optional().describe("Full delivery address"),
      address: z.string().optional().describe("Full delivery address (alias)"),
      email: z.string().optional().describe("Customer's email address"),
      quantity: z
        .union([z.number(), z.string().transform((v) => Number(v))])
        .optional()
        .describe("Quantity of items ordered"),
    }).passthrough(); // .passthrough() allows unknown keys
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  // Always add the attributes array field — matches the tool description format
  shape["attributes"] = attributesField;

  for (const col of columns) {
    const desc = col.display_name || col.key_name || "";
    const opts = col.options
      ? ` (allowed: ${typeof col.options === "string" ? col.options : JSON.stringify(col.options)})`
      : "";

    switch (col.type) {
      case "number":
        shape[col.key_name] = z
          .union([
            z.number(),
            z.string().transform((v) => {
              const n = Number(v);
              if (isNaN(n)) return v; // keep as string if not parseable
              return n;
            }),
          ])
          .optional()
          .describe(desc + opts);
        break;

      case "boolean":
        shape[col.key_name] = z
          .union([
            z.boolean(),
            z
              .string()
              .transform((v) =>
                v === "true" || v === "1" || v === "yes" ? true : false
              ),
          ])
          .optional()
          .describe(desc + opts);
        break;

      case "select":
        shape[col.key_name] = z.string().optional().describe(desc + opts);
        break;

      default: // text, date, dropdown, or unknown
        shape[col.key_name] = z.string().optional().describe(desc + opts);
    }
  }

  return z.object(shape).passthrough(); // Allow extra/unknown keys
}

// ── Structured Tool Implementation ──────────────────────────────────

// @ts-ignore
class CRMOrderToolImpl extends StructuredTool {
  name: string;
  description: string;
  schema: z.ZodObject<any>;

  private crmBaseUrl: string;
  private apiKey: string;
  private action: "create" | "update";
  private useFlowSessionId: boolean;
  private resolvedSessionId: string;
  private columns: any[];

  constructor(config: CRMOrderToolConfig) {
    super();
    this.name = config.toolName;
    this.description = config.toolDescription;
    this.crmBaseUrl = config.crmBaseUrl;
    this.apiKey = config.apiKey;
    this.action = config.action;
    this.useFlowSessionId = config.useFlowSessionId;
    this.resolvedSessionId = config.resolvedSessionId;
    this.columns = config.columns || [];

    // 🔥 Build the Zod schema dynamically from CRM columns
    this.schema = buildDynamicSchema(this.columns);
  }

  // @ts-ignore
  async _call(
    arg: z.infer<typeof this.schema>,
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
      // ── 1. Build attributes array from arg (supports both formats) ──
      // Format A: LLM sent { attributes: [{key, value}, ...] } — use directly
      // Format B: LLM sent flat fields { clientName: "...", clientPhone: "..." } — convert
      let attributes: { key: string; value: string }[] = [];

      const argAny = arg as any;

      if (
        argAny.attributes &&
        Array.isArray(argAny.attributes) &&
        argAny.attributes.length > 0
      ) {
        // Format A: LLM used the "attributes" array as described in the tool prompt
        attributes = argAny.attributes.map((item: any) => ({
          key: String(item.key || ""),
          value: String(item.value || ""),
        })).filter((a: any) => a.key !== "");
      }

      // Also collect any flat fields (Format B) — merge with attributes array
      const flatAttrs = Object.entries(arg)
        .filter(
          ([k, v]) =>
            k !== "attributes" && // skip the attributes key itself
            v !== undefined &&
            v !== null &&
            v !== ""
        )
        .map(([key, value]) => ({
          key,
          value: String(value),
        }));

      // Merge: flat fields take lower priority than explicit attributes array
      const existingKeys = new Set(attributes.map((a) => a.key.toLowerCase()));
      for (const fa of flatAttrs) {
        if (!existingKeys.has(fa.key.toLowerCase())) {
          attributes.push(fa);
          existingKeys.add(fa.key.toLowerCase());
        }
      }

      // ── 2. ALWAYS override sessionId with the REAL chat session ID ──
      // The LLM may hallucinate a fake sessionId — we ignore it completely.
      // The real sessionId comes from the AgentExecutor's flow config (runtime)
      // or from the node's init options (resolved at startup).
      const effectiveSessionId =
        flowConfig?.sessionId ||
        flowConfig?.chatId ||
        this.resolvedSessionId ||
        "";

      // Strip ANY sessionId attribute the LLM sent — we use our own
      attributes = attributes.filter(
        (a) =>
          a.key.toLowerCase() !== "sessionid" &&
          a.key.toLowerCase() !== "session_id" &&
          a.key.toLowerCase() !== "session id" &&
          a.key.toLowerCase() !== "session"
      );

      // Hard-inject the real session ID
      if (effectiveSessionId) {
        attributes.push({ key: "sessionId", value: effectiveSessionId });
      }

      // ── 3. Smart fuzzy key matching ──
      // Normalize common field name aliases to CRM column keys
      attributes = normalizeAttributeKeys(attributes, this.columns);

      // ── 4. Validate we have at least something ──
      const nonSessionAttrs = attributes.filter(
        (a) => a.key !== "sessionId"
      );
      if (nonSessionAttrs.length === 0) {
        return formatToolError(
          "No order data provided. Please provide at least customer name and phone number.",
          { provided: attributes }
        );
      }

      // ── 5. Construct payload and send to CRM ──
      const payload: any = {
        action: this.action,
        attributes,
      };

      if (effectiveSessionId) {
        payload.sessionId = effectiveSessionId;
      }

      console.info(
        `[CRMOrderTool v2] action=${this.action} sessionId=${
          effectiveSessionId || "(none)"
        } attrs=${attributes.length} keys=${attributes
          .map((a) => a.key)
          .join(", ")}`
      );

      const actualToolInput = {
        input: JSON.stringify({ attributes }),
      };
      const toolArgsSuffix =
        TOOL_ARGS_PREFIX + JSON.stringify(actualToolInput);

      // Send to CRM
      const url = `${this.crmBaseUrl}/api/integration/orders`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as any;

      if (!response.ok) {
        return formatToolError(
          `Failed to ${this.action} order. Status: ${response.status}. Message: ${
            result.message || "Unknown error"
          }. Please inform the customer that there was a technical issue and try again.`,
          payload
        );
      }

      if (result.success) {
        const actionStr =
          this.action === "update" ? "updated" : "created";
        return `Order ${actionStr} successfully!\nOrder ID: #${result.order_id}\nClient: ${result.client}\nBrand: ${result.brand}\n\nPlease confirm to the customer that their order has been ${actionStr} with order number #${result.order_id}.${toolArgsSuffix}`;
      } else {
        return formatToolError(
          `${result.message || `Failed to ${this.action} order`}. Please inform the customer about this issue.`,
          payload
        );
      }
    } catch (error: any) {
      return formatToolError(
        `Failed to connect to CRM at ${this.crmBaseUrl}: ${error.message}. Please inform the customer that there is a temporary connection issue.`,
        {}
      );
    }
  }
}

module.exports = { nodeClass: CRMOrderTool_Tools };
