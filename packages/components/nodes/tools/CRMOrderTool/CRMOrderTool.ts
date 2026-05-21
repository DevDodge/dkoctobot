import { Tool } from '@langchain/core/tools'
import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'

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
                rows: 4,
                default: `Create a new order in the CRM system. Use this tool ONLY when the customer has confirmed they want to place an order AND you have collected all required information (name, phone, product, price, address).

Input MUST be a valid JSON string with this structure:
{
  "attributes": [
    { "key": "customer_name", "value": "Ahmed Mohamed" },
    { "key": "phone", "value": "01012345678" },
    { "key": "product", "value": "Electric Scooter X5" },
    { "key": "price", "value": "15000" },
    { "key": "address", "value": "Cairo - Nasr City" },
    { "key": "notes", "value": "Deliver before 5 PM" }
  ]
}

IMPORTANT: Do NOT call this tool unless the customer explicitly confirms the order. Always verify the details with the customer first.`,
                description: 'Description that helps the agent understand when and how to use this tool',
                optional: true,
                additionalParams: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const crmBaseUrl = ((nodeData.inputs?.crmBaseUrl as string) || 'http://localhost:5000').replace(/\/+$/, '')
        const apiKey = nodeData.inputs?.apiKey as string
        const toolName = (nodeData.inputs?.toolName as string) || 'create_crm_order'
        const toolDescription =
            (nodeData.inputs?.toolDescription as string) ||
            'Create a new order in the CRM system. Input must be a JSON string with an "attributes" array.'

        if (!apiKey) {
            throw new Error('API Key is required. Generate one from the CRM Integration Keys page.')
        }

        return new CRMOrderToolImpl({
            crmBaseUrl,
            apiKey,
            toolName,
            toolDescription
        })
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
            // Parse input - the agent should send JSON
            let parsedInput: any
            try {
                parsedInput = JSON.parse(input)
            } catch {
                // Try to extract JSON from the input string (agent might wrap it in text)
                const jsonMatch = input.match(/\{[\s\S]*\}/)
                if (jsonMatch) {
                    parsedInput = JSON.parse(jsonMatch[0])
                } else {
                    return `ERROR: Invalid input format. Please provide a valid JSON string with an "attributes" array. Example: {"attributes": [{"key": "customer_name", "value": "Ahmed"}, {"key": "phone", "value": "01012345678"}]}`
                }
            }

            const attributes = parsedInput.attributes
            if (!attributes || !Array.isArray(attributes) || attributes.length === 0) {
                return `ERROR: The "attributes" array is required and must contain at least one item with "key" and "value" fields.`
            }

            // Validate required fields
            const keys = attributes.map((a: any) => a.key?.toLowerCase())
            const hasPhone = keys.some(
                (k: string) =>
                    k &&
                    ['phone', 'mobile', 'هاتف', 'موبايل', 'تليفون', 'رقم', 'الهاتف', 'الموبايل'].some(
                        (pk) => k.includes(pk) || pk.includes(k)
                    )
            )
            const hasName = keys.some((k: string) => k && ['name', 'اسم', 'العميل', 'الاسم'].some((nk) => k.includes(nk) || nk.includes(k)))

            if (!hasPhone) {
                return `ERROR: Phone number is required. Please ask the customer for their phone number before creating the order.`
            }
            if (!hasName) {
                return `ERROR: Customer name is required. Please ask the customer for their name before creating the order.`
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
