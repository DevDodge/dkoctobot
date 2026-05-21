import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses, transformBracesWithColon } from '../../../src/utils'
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate } from '@langchain/core/prompts'

const DEFAULT_SYSTEM_PROMPT = `You are an intelligent ERP Agent — a multi-purpose decision engine connected to enterprise tools and external systems.

## ROLE
You analyze conversations, understand user intent, and take action using the tools available to you. You operate as a backend brain that supports one or more applications (e.g., order management, product search, customer lookup, support tickets, etc.).

## AVAILABLE APPLICATIONS & TOOLS
{applications}

## GENERAL WORKFLOW
1. **Understand Intent** — Analyze the user message to determine which application and tool to use
2. **Gather Information** — If the user hasn't provided enough data, ask for the missing fields
3. **Confirm Before Acting** — For any action that creates, modifies, or deletes data, ALWAYS summarize and ask for explicit confirmation before executing
4. **Execute** — Use the appropriate tool with the correct parameters
5. **Handle Response** — Process the tool's response:
   - On **SUCCESS**: Inform the user clearly with any returned details (IDs, reference numbers, etc.)
   - On **ERROR**: Inform the user about the issue, explain what went wrong, and offer to retry or assist further
   - **NEVER silently ignore errors** — always communicate the outcome

## COMMUNICATION RULES
- Match the user's language (Arabic / English / mixed)
- Be professional, concise, and helpful
- Never fabricate data — always use real tool responses
- If a tool is unavailable or fails, be transparent about it
- Never force the user into an action — respect cancellations and changes of mind`

const DEFAULT_APPLICATIONS = `### 1. Product Search
- **Tool**: search_products
- **When to use**: Customer asks about products, prices, availability, or specifications
- **Workflow**: Search → Present results → Ask if they need more info or want to proceed

### 2. Order Management
- **Tool**: create_crm_order
- **When to use**: Customer confirms they want to place an order
- **Required fields before creating**: Customer name, Phone number, Product, Address
- **Workflow**: Collect required fields → Summarize order → Get confirmation → Submit → Report result
- **Input format**: JSON with "attributes" array: [{ "key": "field_name", "value": "field_value" }]
- **On success**: Share the order ID with the customer
- **On error**: Apologize and offer to retry`

const DEFAULT_HUMAN_PROMPT = `{input}`

class ERPAgentPrompt_Prompts implements INode {
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
        this.label = 'ERP Agent Prompt'
        this.name = 'erpAgentPrompt'
        this.version = 1.0
        this.type = 'ChatPromptTemplate'
        this.icon = 'erp-agent-prompt.svg'
        this.category = 'AppCity'
        this.description =
            'Flexible prompt template for ERP Agent — supports multiple applications (orders, search, support, etc.) with built-in workflow, confirmation, and error handling logic'
        this.baseClasses = [this.type, ...getBaseClasses(ChatPromptTemplate)]
        this.inputs = [
            {
                label: 'System Message',
                name: 'systemMessagePrompt',
                type: 'string',
                rows: 8,
                default: DEFAULT_SYSTEM_PROMPT,
                description:
                    'Core system prompt defining the agent role and behavior. Use {applications} placeholder to inject the applications config.'
            },
            {
                label: 'Applications & Tools',
                name: 'applications',
                type: 'string',
                rows: 8,
                default: DEFAULT_APPLICATIONS,
                description:
                    'Define each application the agent supports — its tool name, when to use it, required fields, workflow, and success/error handling. This replaces {applications} in the system message.'
            },
            {
                label: 'Human Message',
                name: 'humanMessagePrompt',
                type: 'string',
                rows: 2,
                default: DEFAULT_HUMAN_PROMPT,
                description: 'This prompt will be added at the end of the messages as human message'
            },
            {
                label: 'Additional Instructions',
                name: 'additionalInstructions',
                type: 'string',
                rows: 4,
                optional: true,
                additionalParams: true,
                description:
                    'Extra instructions appended to the system prompt — brand-specific rules, language preferences, special offers, custom workflows, etc.'
            },
            {
                label: 'Format Prompt Values',
                name: 'promptValues',
                type: 'json',
                optional: true,
                acceptVariable: true,
                list: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, _options: ICommonObject): Promise<any> {
        let systemMessagePrompt = nodeData.inputs?.systemMessagePrompt as string
        let humanMessagePrompt = (nodeData.inputs?.humanMessagePrompt as string) || DEFAULT_HUMAN_PROMPT
        const applications = (nodeData.inputs?.applications as string) || DEFAULT_APPLICATIONS
        const additionalInstructions = nodeData.inputs?.additionalInstructions as string
        const promptValuesStr = nodeData.inputs?.promptValues

        // Inject applications into the system prompt
        systemMessagePrompt = systemMessagePrompt.replace(/\{applications\}/g, applications)

        // Append additional instructions if provided
        if (additionalInstructions && additionalInstructions.trim()) {
            systemMessagePrompt += `\n\n## ADDITIONAL INSTRUCTIONS\n${additionalInstructions}`
        }

        // Transform braces for LangChain compatibility
        systemMessagePrompt = transformBracesWithColon(systemMessagePrompt)
        humanMessagePrompt = transformBracesWithColon(humanMessagePrompt)

        const prompt = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(systemMessagePrompt),
            HumanMessagePromptTemplate.fromTemplate(humanMessagePrompt)
        ])

        // Handle prompt values
        let promptValues: ICommonObject = {}
        if (promptValuesStr) {
            try {
                promptValues = typeof promptValuesStr === 'object' ? promptValuesStr : JSON.parse(promptValuesStr)
            } catch (exception) {
                throw new Error("Invalid JSON in the ERPAgentPrompt's promptValues: " + exception)
            }
        }
        // @ts-ignore
        prompt.promptValues = promptValues

        return prompt
    }
}

module.exports = { nodeClass: ERPAgentPrompt_Prompts }
