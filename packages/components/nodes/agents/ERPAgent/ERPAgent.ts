import { flatten } from 'lodash'
import { BaseMessage } from '@langchain/core/messages'
import { ChainValues } from '@langchain/core/utils/types'
import { RunnableSequence } from '@langchain/core/runnables'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatPromptTemplate, MessagesPlaceholder, HumanMessagePromptTemplate, PromptTemplate } from '@langchain/core/prompts'
import { formatToOpenAIToolMessages } from 'langchain/agents/format_scratchpad/openai_tools'
import { type ToolsAgentStep } from 'langchain/agents/openai/output_parser'
import {
    extractOutputFromArray,
    getBaseClasses,
    handleEscapeCharacters,
    removeInvalidImageMarkdown,
    transformBracesWithColon
} from '../../../src/utils'
import { ICommonObject, INode, INodeData, INodeParams, IServerSideEventStreamer, IUsedTool, IVisionChatModal } from '../../../src/Interface'
import { ConsoleCallbackHandler, CustomChainHandler, additionalCallbacks } from '../../../src/handler'
import { AgentExecutor, ToolCallingAgentOutputParser } from '../../../src/agents'
import { addImagesToMessages, llmSupportsVision } from '../../../src/multiModalUtils'

// ── System prompt suffixes per response mode ──────────────────────────
const RESPONSE_MODE_SUFFIXES: Record<string, string> = {
    decisionOnly: `\n\n## 🔴 CRITICAL: TOOLS-FIRST AUTOMATIC EXECUTION MODE

You are an AUTOMATIC execution engine. Your ONLY purpose is to detect orders and execute tools IMMEDIATELY.

### CORE RULES — NO EXCEPTIONS:
1. **DETECT → EXECUTE** — The moment you detect a customer order with name + phone, CALL create_crm_order IMMEDIATELY. Do NOT pause. Do NOT ask for confirmation. Do NOT summarize. Just CALL THE TOOL.

2. **NO CONFIRMATION EVER** — You are in "decisionOnly" mode. You CANNOT ask the customer anything. You CANNOT wait for approval. You CANNOT output confirmation questions. Your ONLY output path is through tools.

3. **DATA EXTRACTION** — Extract all fields from the input message. If a field is missing, use sensible defaults:
   - Missing status → "جديد"
   - Missing governorate → extract from address or use empty string
   - Missing backup size → leave empty
   - Missing orderTotalPrice → calculate from basePrice + shippingPrice

4. **EXECUTE ALL MATCHING TOOLS** — If you see data for create_crm_order → call it. If monitoring_note is available → call it. Call EVERY relevant tool.

5. **AFTER ALL TOOLS EXECUTE** — Output a minimal JSON summary:
   - {"toolCalls": [{"tool": "create_crm_order", "result": "success", "orderId": 123}], "actionsExecuted": ["created_order"]}
   - If NO tools were called (no actionable data): {"toolCalls": [], "actionsExecuted": [], "note": "no actionable data detected"}

6. **TOOLS > TEXT** — You are a TOOL RUNNER first, not a writer. The Sales Agent handles customer communication. Your value is in EXECUTING tools, not writing responses.`,

    modifyResponse: `\n\nIMPORTANT RULES FOR YOUR OUTPUT:
- You will receive the Sales Agent's response to the customer.
- Your job is to MODIFY and ENRICH that response with ERP data.
- Include any discounts, stock info, promotions, or corrections.
- Write the FINAL customer-facing message that replaces the Sales response.
- Keep the same tone and style but add the ERP context.`,

    directResponse: `\n\nIMPORTANT RULES FOR YOUR OUTPUT:
- You are responding DIRECTLY to the customer.
- Be professional, friendly, and helpful.
- Use the ERP data from your tools to give accurate information.
- This is a customer-facing response — make it clear and readable.`
}

class ERPAgent_Agents implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]
    sessionId?: string

    constructor(fields?: { sessionId?: string }) {
        this.label = 'ERP Agent'
        this.name = 'erpAgent'
        this.version = 1.1
        this.type = 'ERPAgentExecutor'
        this.category = 'AppCity'
        this.icon = 'erpAgent.svg'
        this.description = 'ERP decision engine that thinks with every response — uses tools to query ERP data and make decisions'
        this.baseClasses = [this.type, ...getBaseClasses(AgentExecutor)]
        this.inputs = [
            {
                label: 'ERP Tools',
                name: 'tools',
                type: 'Tool',
                list: true,
                description: 'Tools for ERP operations: API calls, database queries, product search, order management, etc.'
            },
            {
                label: 'Tool Calling Chat Model',
                name: 'model',
                type: 'BaseChatModel',
                description:
                    'Chat model for the ERP Agent. Compatible with function-calling models: ChatOpenAI, ChatMistral, ChatAnthropic, ChatGoogleGenerativeAI, GroqChat'
            },
            {
                label: 'Response Mode',
                name: 'responseMode',
                type: 'options',
                description: 'How the ERP Agent produces its output',
                options: [
                    {
                        label: 'Decision Only',
                        name: 'decisionOnly',
                        description: 'Returns structured JSON decisions — does not write customer response'
                    },
                    {
                        label: 'Modify Response',
                        name: 'modifyResponse',
                        description: 'Takes Sales Agent response and modifies/enriches it with ERP data'
                    },
                    {
                        label: 'Direct Response',
                        name: 'directResponse',
                        description: 'Responds directly to the customer (bypasses Sales Agent)'
                    }
                ],
                default: 'decisionOnly'
            },
            {
                label: 'Chat Prompt Template',
                name: 'chatPromptTemplate',
                type: 'ChatPromptTemplate',
                description: 'Override the default ERP prompt with a Chat Prompt Template',
                optional: true
            },
            {
                label: 'System Message',
                name: 'systemMessage',
                type: 'string',
                default: `You are an ERP decision engine. You analyze customer messages and make data-driven decisions using your tools.
Your tools connect to the ERP system to check products, prices, stock, customer history, and more.
Think carefully before each decision and always verify with real data from your tools.`,
                description: 'If Chat Prompt Template is provided, this will be ignored',
                rows: 4,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Max Iterations',
                name: 'maxIterations',
                type: 'number',
                optional: true,
                additionalParams: true
            }
        ]
        this.sessionId = fields?.sessionId
    }

    async init(nodeData: INodeData, input: string, options: ICommonObject): Promise<any> {
        return prepareERPAgent(nodeData, options, { sessionId: this.sessionId, chatId: options.chatId, input })
    }

    async run(nodeData: INodeData, input: string, options: ICommonObject): Promise<string | ICommonObject> {
        const shouldStreamResponse = options.shouldStreamResponse
        const sseStreamer: IServerSideEventStreamer = options.sseStreamer as IServerSideEventStreamer
        const chatId = options.chatId

        const executor = await prepareERPAgent(nodeData, options, { sessionId: this.sessionId, chatId: options.chatId, input })

        const loggerHandler = new ConsoleCallbackHandler(options.logger, options?.orgId)
        const callbacks = await additionalCallbacks(nodeData, options)

        let res: ChainValues = {}
        let sourceDocuments: ICommonObject[] = []
        let usedTools: IUsedTool[] = []
        let artifacts: any[] = []

        if (shouldStreamResponse) {
            const handler = new CustomChainHandler(sseStreamer, chatId)
            res = await executor.invoke({ input }, { callbacks: [loggerHandler, handler, ...callbacks] })
            if (res.sourceDocuments) {
                if (sseStreamer) sseStreamer.streamSourceDocumentsEvent(chatId, flatten(res.sourceDocuments))
                sourceDocuments = res.sourceDocuments
            }
            if (res.usedTools) {
                if (sseStreamer) sseStreamer.streamUsedToolsEvent(chatId, flatten(res.usedTools))
                usedTools = res.usedTools
            }
            if (res.artifacts) {
                if (sseStreamer) sseStreamer.streamArtifactsEvent(chatId, flatten(res.artifacts))
                artifacts = res.artifacts
            }
        } else {
            res = await executor.invoke({ input }, { callbacks: [loggerHandler, ...callbacks] })
            if (res.sourceDocuments) sourceDocuments = res.sourceDocuments
            if (res.usedTools) usedTools = res.usedTools
            if (res.artifacts) artifacts = res.artifacts
        }

        let output = res?.output
        output = extractOutputFromArray(res?.output)
        output = removeInvalidImageMarkdown(output)

        // Strip <thinking> tags (Claude)
        const regexPattern: RegExp = /<thinking>[\s\S]*?<\/thinking>/
        const matches: RegExpMatchArray | null = output.match(regexPattern)
        if (matches) {
            for (const match of matches) {
                output = output.replace(match, '')
            }
        }

        let finalRes = output
        if (sourceDocuments.length || usedTools.length || artifacts.length) {
            const finalRes: ICommonObject = { text: output }
            if (sourceDocuments.length) finalRes.sourceDocuments = flatten(sourceDocuments)
            if (usedTools.length) finalRes.usedTools = usedTools
            if (artifacts.length) finalRes.artifacts = artifacts
            return finalRes
        }

        return finalRes
    }
}

const prepareERPAgent = async (
    nodeData: INodeData,
    options: ICommonObject,
    flowObj: { sessionId?: string; chatId?: string; input?: string }
) => {
    const model = nodeData.inputs?.model as BaseChatModel
    const maxIterations = nodeData.inputs?.maxIterations as string
    const responseMode = (nodeData.inputs?.responseMode as string) || 'decisionOnly'
    let systemMessage = nodeData.inputs?.systemMessage as string
    let tools = nodeData.inputs?.tools
    tools = flatten(tools)

    // Append response mode instructions to system message
    const modeSuffix = RESPONSE_MODE_SUFFIXES[responseMode] || ''
    systemMessage = transformBracesWithColon(systemMessage + modeSuffix)

    const inputKey = 'input'

    // Build prompt — include memory placeholder + scratchpad
    // Memory will be injected by AppCityAgent
    let prompt = ChatPromptTemplate.fromMessages([
        ['system', systemMessage],
        new MessagesPlaceholder('chat_history'),
        ['human', `{${inputKey}}`],
        new MessagesPlaceholder('agent_scratchpad')
    ])

    let promptVariables = {}
    const chatPromptTemplate = nodeData.inputs?.chatPromptTemplate as ChatPromptTemplate
    if (chatPromptTemplate && chatPromptTemplate.promptMessages.length) {
        // 🔧 FIX: Inject modeSuffix into the first SystemMessagePromptTemplate
        // Previously the modeSuffix was appended to systemMessage but then
        // the entire prompt was replaced by chatPromptTemplate, discarding it.
        // Now we find the first SystemMessage and inject the modeSuffix into it.
        const modifiedMessages = chatPromptTemplate.promptMessages.map((msg, idx) => {
            if (idx === 0 && (msg as any).prompt && (msg as any).prompt.template !== undefined) {
                // This is likely a SystemMessagePromptTemplate — inject modeSuffix
                const template = (msg as any).prompt.template as string
                if (template && !template.includes(modeSuffix)) {
                    const modifiedMsg = { ...msg }
                    ;(modifiedMsg as any).prompt = { ...(msg as any).prompt, template: template + modeSuffix }
                    return modifiedMsg
                }
            }
            return msg
        })

        const humanPrompt = modifiedMessages[modifiedMessages.length - 1]
        const messages = [
            ...modifiedMessages.slice(0, -1),
            new MessagesPlaceholder('chat_history'),
            humanPrompt,
            new MessagesPlaceholder('agent_scratchpad')
        ]
        prompt = ChatPromptTemplate.fromMessages(messages)
        if ((chatPromptTemplate as any).promptValues) {
            const promptValuesRaw = (chatPromptTemplate as any).promptValues
            const promptValues = handleEscapeCharacters(promptValuesRaw, true)
            for (const val in promptValues) {
                promptVariables = {
                    ...promptVariables,
                    [val]: () => {
                        return promptValues[val]
                    }
                }
            }
        }
    }

    if (llmSupportsVision(model)) {
        const visionChatModel = model as IVisionChatModal
        const messageContent = await addImagesToMessages(nodeData, options, model.multiModalOption)
        if (messageContent?.length) {
            visionChatModel.setVisionModel()
            let messagePlaceholder = prompt.promptMessages.pop() as MessagesPlaceholder
            if (prompt.promptMessages[prompt.promptMessages.length - 1] instanceof HumanMessagePromptTemplate) {
                const lastMessage = prompt.promptMessages.pop() as HumanMessagePromptTemplate
                const template = (lastMessage.prompt as PromptTemplate).template as string
                const msg = HumanMessagePromptTemplate.fromTemplate([...messageContent, { text: template }])
                msg.inputVariables = lastMessage.inputVariables
                prompt.promptMessages.push(msg)
            }
            prompt.promptMessages.push(messagePlaceholder)
        } else {
            visionChatModel.revertToOriginalModel()
        }
    }

    if (model.bindTools === undefined) {
        throw new Error(`This agent requires that the "bindTools()" method be implemented on the input model.`)
    }

    const modelWithTools = model.bindTools(tools)

    const runnableAgent = RunnableSequence.from([
        {
            [inputKey]: (i: { input: string; steps: ToolsAgentStep[] }) => i.input,
            agent_scratchpad: (i: { input: string; steps: ToolsAgentStep[] }) => formatToOpenAIToolMessages(i.steps),
            chat_history: async (_: { input: string; steps: ToolsAgentStep[] }) => {
                // Memory is managed by AppCityAgent — return empty if standalone
                const prependMessages = options?.prependMessages
                if (prependMessages && Array.isArray(prependMessages)) {
                    return prependMessages as BaseMessage[]
                }
                return []
            },
            ...promptVariables
        },
        prompt,
        modelWithTools,
        new ToolCallingAgentOutputParser()
    ])

    const executor = AgentExecutor.fromAgentAndTools({
        agent: runnableAgent,
        tools,
        sessionId: flowObj?.sessionId,
        chatId: flowObj?.chatId,
        input: flowObj?.input,
        verbose: process.env.DEBUG === 'true' ? true : false,
        maxIterations: maxIterations ? parseFloat(maxIterations) : undefined
    })

    // Attach metadata for AppCityAgent to read
    ;(executor as any).responseMode = responseMode

    return executor
}

module.exports = { nodeClass: ERPAgent_Agents }
