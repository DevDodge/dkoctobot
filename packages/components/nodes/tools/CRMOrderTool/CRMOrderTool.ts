import { Tool } from '@langchain/core/tools'
import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'

// Placeholder that indicates "not yet generated"
const TOOL_DESC_PLACEHOLDER = `⚠️ Click refresh on "Get Key Mapping" above, then copy the generated prompt here.

This field must contain the exact key names from your CRM client.
Each client has different column keys — do NOT use generic names like "name" or "phone".`

class CRMOrderTool_Tools implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]

    constructor() {
        this.label = 'CRM Order Tool'
        this.name = 'crmOrderTool'
        this.version = 1.0
        this.type = 'CRMOrderTool'
        this.icon = 'crm-order.svg'
        this.category = 'AppCity'
        this.description = 'Create orders in the CRM system via API key integration. Used by ERP Agent to submit confirmed orders.'
        this.baseClasses = [this.type, 'Tool', ...getBaseClasses(Tool)]
        this.inputs = [
            {
                label: 'CRM Base URL',
                name: 'crmBaseUrl',
                type: 'string',
                default: 'http://localhost:5000',
                description: 'Base URL of the CRM backend server'
            },
            {
                label: 'API Key',
                name: 'apiKey',
                type: 'password',
                description: 'Integration API key from CRM (found in Integration Keys page). This key is tied to a specific client.'
            },
            {
                label: 'Get Key Mapping',
                name: 'keyMapping',
                type: 'asyncOptions',
                loadMethod: 'getKeyMapping',
                description:
                    'Click refresh → select "📋 Generated Tool Description" → copy the text from the description tooltip → paste into Tool Description below.',
                refresh: true,
                optional: true
            },
            {
                label: 'Tool Name',
                name: 'toolName',
                type: 'string',
                default: 'create_crm_order',
                description: 'Name the agent will use to call this tool',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Tool Description',
                name: 'toolDescription',
                type: 'string',
                rows: 6,
                default: TOOL_DESC_PLACEHOLDER,
                description:
                    'Paste the generated prompt from "Get Key Mapping" here. Click the ↗️ expand button for a full-screen editor. This text tells the agent which exact keys to use.',
                optional: true,
                additionalParams: true
            }
        ]
    }

    //@ts-ignore
    loadMethods = {
        getKeyMapping: async (nodeData: INodeData, _options: ICommonObject): Promise<INodeOptionsValue[]> => {
            try {
                const crmBaseUrl = ((nodeData.inputs?.crmBaseUrl as string) || 'http://localhost:5000').replace(/\/+$/, '')
                const apiKey = nodeData.inputs?.apiKey as string

                if (!apiKey) {
                    return [
                        {
                            label: '⚠️ Enter API Key first, then click refresh',
                            name: 'error',
                            description: 'API Key is required to fetch key mappings.'
                        }
                    ]
                }

                const url = `${crmBaseUrl}/api/integration/columns`
                const response = await fetch(url, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }
                })

                if (!response.ok) {
                    const err = await response.text()
                    let msg = `${response.status}`
                    try {
                        msg = JSON.parse(err).message || msg
                    } catch {
                        /* ignore parse error */
                    }
                    return [{ label: `❌ ${msg}`, name: 'error', description: 'Check URL and API Key' }]
                }

                const result = (await response.json()) as any
                if (!result.success) {
                    return [{ label: `❌ ${result.message || 'Error'}`, name: 'error' }]
                }

                const columns = result.columns || []
                if (columns.length === 0) {
                    return [
                        {
                            label: `✅ ${result.client} (${result.brand}) — No columns configured`,
                            name: 'no_columns',
                            description: 'Add columns in the CRM Orders page first.'
                        }
                    ]
                }

                // === Generate the Tool Description prompt ===
                const fmtOpts = (o: any) => {
                    if (!o) return ''
                    if (typeof o === 'string') return o.trim() || ''
                    if (typeof o === 'object' && Object.keys(o).length === 0) return ''
                    if (Array.isArray(o) && o.length === 0) return ''
                    return JSON.stringify(o)
                }
                const keyLines = columns
                    .map((col: any) => {
                        const optsStr = fmtOpts(col.options)
                        const opts = optsStr ? ` (options: ${optsStr})` : ''
                        return `    { "key": "${col.key_name}", "value": "<${col.display_name}>" }  // ${col.type || 'text'}${opts}`
                    })
                    .join(',\n')

                const toolDescPrompt = `Create a new order in the CRM system for ${result.client} (${result.brand}).

IMPORTANT: Do NOT call this tool unless the customer explicitly confirms the order.
Always verify all details with the customer first.

Input MUST be a valid JSON string with this EXACT structure:
{
  "attributes": [
${keyLines}
  ]
}

You MUST use these EXACT key names. Do not translate or rename them.`

                // === Generate ERP Agent Prompt snippet ===
                const fieldList = columns
                    .map((col: any) => {
                        const optsStr = fmtOpts(col.options)
                        const opts = optsStr ? ` [${optsStr}]` : ''
                        return `  - **${col.display_name}** → key: "${col.key_name}" (${col.type || 'text'})${opts}`
                    })
                    .join('\n')

                const erpPromptSnippet = `### Order Management — ${result.client} (${result.brand})
- **Tool**: create_crm_order
- **When to use**: Customer confirms they want to place an order
- **Required fields** (collect ALL before creating):
${fieldList}
- **Workflow**: Collect all fields → Summarize → Get confirmation → Submit → Report result
- **On success**: Share the order ID with the customer
- **On error**: Apologize and offer to retry`

                // === Return items ===
                const items: INodeOptionsValue[] = []

                // Generated Tool Description
                items.push({
                    label: `📋 Generated Tool Description — Copy into "Tool Description" (Additional Parameters)`,
                    name: 'tool_desc_prompt',
                    description: toolDescPrompt
                })

                // ERP Agent Prompt snippet
                items.push({
                    label: `📝 ERP Prompt Snippet — Copy into ERP Agent Prompt "Applications & Tools"`,
                    name: 'erp_prompt_snippet',
                    description: erpPromptSnippet
                })

                // Connection info
                items.push({
                    label: `✅ ${result.client} (${result.brand}) — ${columns.length} keys loaded`,
                    name: 'info',
                    description: `Client: ${result.client} | Brand: ${result.brand} | Keys: ${columns
                        .map((c: any) => c.key_name)
                        .join(', ')}`
                })

                // Individual keys for reference
                for (const col of columns) {
                    const opts = col.options ? ` [${col.options}]` : ''
                    items.push({
                        label: `🔑 ${col.key_name} → "${col.display_name}" (${col.type || 'text'})${opts}`,
                        name: col.key_name,
                        description: `Key: ${col.key_name} | Display: ${col.display_name} | Type: ${col.type || 'text'}${opts}`
                    })
                }

                return items
            } catch (error: any) {
                return [
                    {
                        label: '❌ Connection failed',
                        name: 'error',
                        description: `${error.message}. Check that CRM is running.`
                    }
                ]
            }
        }
    }

    async init(nodeData: INodeData, _: string, _options: ICommonObject): Promise<any> {
        const crmBaseUrl = ((nodeData.inputs?.crmBaseUrl as string) || 'http://localhost:5000').replace(/\/+$/, '')
        const apiKey = nodeData.inputs?.apiKey as string
        const toolName = (nodeData.inputs?.toolName as string) || 'create_crm_order'
        let toolDescription = (nodeData.inputs?.toolDescription as string) || ''

        if (!apiKey) {
            throw new Error('API Key is required. Generate one from the CRM Integration Keys page.')
        }

        // If the user hasn't pasted the generated prompt yet, auto-generate it as fallback
        if (!toolDescription || toolDescription.includes('⚠️')) {
            try {
                const url = `${crmBaseUrl}/api/integration/columns`
                const response = await fetch(url, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }
                })
                if (response.ok) {
                    const result = (await response.json()) as any
                    if (result.success && result.columns?.length > 0) {
                        const keyLines = result.columns
                            .map((col: any) => {
                                const opts = col.options ? ` (options: ${col.options})` : ''
                                return `    { "key": "${col.key_name}", "value": "<${col.display_name}>" }  // ${col.type || 'text'}${opts}`
                            })
                            .join(',\n')

                        toolDescription = `Create a new order in the CRM system for ${result.client} (${result.brand}).

IMPORTANT: Do NOT call this tool unless the customer explicitly confirms the order.

Input MUST be a valid JSON string with this EXACT structure:
{
  "attributes": [
${keyLines}
  ]
}

You MUST use these EXACT key names. Do not translate or rename them.`
                    }
                }
            } catch {
                // Fallback to generic description
                toolDescription =
                    'Create a new order in the CRM system. Input must be a JSON string with an "attributes" array containing "key" and "value" pairs.'
            }
        }

        return new CRMOrderToolImpl({ crmBaseUrl, apiKey, toolName, toolDescription })
    }
}

interface CRMOrderToolConfig {
    crmBaseUrl: string
    apiKey: string
    toolName: string
    toolDescription: string
}

class CRMOrderToolImpl extends Tool {
    name: string
    description: string
    private crmBaseUrl: string
    private apiKey: string

    constructor(config: CRMOrderToolConfig) {
        super()
        this.name = config.toolName
        this.description = config.toolDescription
        this.crmBaseUrl = config.crmBaseUrl
        this.apiKey = config.apiKey
    }

    async _call(input: string): Promise<string> {
        try {
            let parsedInput: any
            try {
                parsedInput = JSON.parse(input)
            } catch {
                const jsonMatch = input.match(/\{[\s\S]*\}/)
                if (jsonMatch) {
                    parsedInput = JSON.parse(jsonMatch[0])
                } else {
                    return `ERROR: Invalid input format. Please provide a valid JSON string with an "attributes" array.`
                }
            }

            const attributes = parsedInput.attributes
            if (!attributes || !Array.isArray(attributes) || attributes.length === 0) {
                return `ERROR: The "attributes" array is required and must contain at least one item with "key" and "value" fields.`
            }

            // Send to CRM
            const url = `${this.crmBaseUrl}/api/integration/orders`
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.apiKey
                },
                body: JSON.stringify({ attributes })
            })

            const result = (await response.json()) as any

            if (!response.ok) {
                return `ERROR: Failed to create order. Status: ${response.status}. Message: ${
                    result.message || 'Unknown error'
                }. Please inform the customer that there was a technical issue and try again.`
            }

            if (result.success) {
                return `SUCCESS: Order created successfully!\nOrder ID: #${result.order_id}\nClient: ${result.client}\nBrand: ${result.brand}\n\nPlease confirm to the customer that their order has been registered with order number #${result.order_id}.`
            } else {
                return `ERROR: ${result.message || 'Failed to create order'}. Please inform the customer about this issue.`
            }
        } catch (error: any) {
            return `ERROR: Failed to connect to CRM at ${this.crmBaseUrl}: ${error.message}. Please inform the customer that there is a temporary connection issue.`
        }
    }
}

module.exports = { nodeClass: CRMOrderTool_Tools }
