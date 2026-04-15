import { flatten } from 'lodash'
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChainValues } from '@langchain/core/utils/types'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { extractOutputFromArray, getBaseClasses, removeInvalidImageMarkdown } from '../../../src/utils'
import { FlowiseMemory, ICommonObject, INode, INodeData, INodeParams, IServerSideEventStreamer, IUsedTool } from '../../../src/Interface'
import { ConsoleCallbackHandler, CustomChainHandler, additionalCallbacks } from '../../../src/handler'
import { AgentExecutor } from '../../../src/agents'

// ── Constants ─────────────────────────────────────────────────────────
const DEFAULT_ORCHESTRATOR_PROMPT = `You are the AppCity Orchestrator. Your job is to coordinate between the Sales Agent and the ERP Agent to produce the best possible response for the customer.

When merging responses:
1. If the ERP Agent provided decisions (JSON), use them to enrich the Sales Agent's response
2. If the ERP Agent modified the response, use the modified version
3. If there's a conflict, prefer ERP data (it's more accurate)
4. Always maintain a friendly, professional tone
5. Never expose internal system details to the customer`

class AppCityAgent_Agents implements INode {
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
        this.label = 'AppCity Agent'
        this.name = 'appCityAgent'
        this.version = 1.0
        this.type = 'AgentExecutor'
        this.category = 'AppCity'
        this.icon = 'appCityAgent.svg'
        this.description = 'Orchestrator agent that coordinates between a Sales Agent and an ERP Agent with configurable thinking order'
        this.baseClasses = [this.type, ...getBaseClasses(AgentExecutor)]
        this.inputs = [
            {
                label: 'Sales Agent',
                name: 'salesAgent',
                type: 'AgentExecutor',
                description: 'The Sales Agent (Tool Agent) that handles customer-facing conversations'
            },
            {
                label: 'ERP Agent',
                name: 'erpAgent',
                type: 'ERPAgentExecutor',
                description: 'The ERP Agent that makes data-driven decisions and interacts with ERP systems'
            },
            {
                label: 'Shared Memory',
                name: 'memory',
                type: 'BaseChatMemory',
                description: 'Shared memory between both agents — accepts all memory node types'
            },
            {
                label: 'Orchestrator Model',
                name: 'model',
                type: 'BaseChatModel',
                description: 'Chat model used by the orchestrator to merge responses and make routing decisions'
            },
            {
                label: 'Thinking Order',
                name: 'thinkingOrder',
                type: 'options',
                description: 'How the Sales Agent and ERP Agent coordinate their work',
                options: [
                    {
                        label: 'Sales First → ERP Decides',
                        name: 'salesFirst',
                        description: 'Sales Agent responds first, then ERP Agent reviews and enriches the response'
                    },
                    {
                        label: 'ERP Decides First → Sales Executes',
                        name: 'erpFirst',
                        description:
                            'ERP Agent analyzes and makes decisions first, then Sales Agent crafts the response using those decisions'
                    },
                    {
                        label: 'Parallel',
                        name: 'parallel',
                        description: 'Both agents think simultaneously, then the orchestrator merges their outputs'
                    }
                ],
                default: 'erpFirst'
            },
            {
                label: 'System Message',
                name: 'systemMessage',
                type: 'string',
                default: DEFAULT_ORCHESTRATOR_PROMPT,
                description: 'Instructions for the orchestrator on how to merge and coordinate agent responses',
                rows: 4,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Input Moderation',
                description: 'Detect text that could generate harmful output and prevent it from being sent to the agents',
                name: 'inputModeration',
                type: 'Moderation',
                optional: true,
                list: true
            },
            {
                label: 'Max Iterations',
                name: 'maxIterations',
                type: 'number',
                optional: true,
                additionalParams: true,
                description: 'Maximum number of orchestration iterations'
            }
        ]
        this.sessionId = fields?.sessionId
    }

    async init(nodeData: INodeData, input: string, options: ICommonObject): Promise<any> {
        // Return the orchestrator configuration (used when AppCityAgent is referenced)
        return { nodeData, options, sessionId: this.sessionId }
    }

    async run(nodeData: INodeData, input: string, options: ICommonObject): Promise<string | ICommonObject> {
        const salesAgent = nodeData.inputs?.salesAgent as AgentExecutor
        const erpAgent = nodeData.inputs?.erpAgent as AgentExecutor
        const memory = nodeData.inputs?.memory as FlowiseMemory
        const model = nodeData.inputs?.model as BaseChatModel
        const thinkingOrder = (nodeData.inputs?.thinkingOrder as string) || 'erpFirst'
        const systemMessage = (nodeData.inputs?.systemMessage as string) || DEFAULT_ORCHESTRATOR_PROMPT

        const shouldStreamResponse = options.shouldStreamResponse
        const sseStreamer: IServerSideEventStreamer = options.sseStreamer as IServerSideEventStreamer
        const chatId = options.chatId

        const loggerHandler = new ConsoleCallbackHandler(options.logger, options?.orgId)
        const callbacks = await additionalCallbacks(nodeData, options)

        // Get chat history from shared memory
        const memoryKey = memory.memoryKey ? memory.memoryKey : 'chat_history'
        const prependMessages = options?.prependMessages
        const chatHistory = (await memory.getChatMessages(this.sessionId, true, prependMessages)) as BaseMessage[]

        // Get ERP response mode
        const erpResponseMode = (erpAgent as any).responseMode || 'decisionOnly'

        let finalOutput = ''
        let allUsedTools: IUsedTool[] = []
        let allSourceDocuments: ICommonObject[] = []
        let allArtifacts: any[] = []

        // ── Execute based on thinking order ──────────────────────────
        if (thinkingOrder === 'salesFirst') {
            // Step 1: Sales Agent responds
            const salesResult = await this.runAgent(
                salesAgent,
                input,
                chatHistory,
                loggerHandler,
                callbacks,
                shouldStreamResponse,
                sseStreamer,
                chatId
            )
            allUsedTools.push(...(salesResult.usedTools || []))
            allSourceDocuments.push(...(salesResult.sourceDocuments || []))
            allArtifacts.push(...(salesResult.artifacts || []))

            // Step 2: ERP Agent processes with sales context
            const erpInput =
                erpResponseMode === 'modifyResponse'
                    ? `Customer message: ${input}\n\nSales Agent response: ${salesResult.output}\n\nPlease modify and enrich the Sales Agent's response with ERP data.`
                    : `Customer message: ${input}\n\nSales Agent response: ${salesResult.output}`
            const erpResult = await this.runAgent(erpAgent, erpInput, chatHistory, loggerHandler, callbacks, false, sseStreamer, chatId)
            allUsedTools.push(...(erpResult.usedTools || []))
            allSourceDocuments.push(...(erpResult.sourceDocuments || []))
            allArtifacts.push(...(erpResult.artifacts || []))

            // Step 3: Merge
            if (erpResponseMode === 'directResponse' || erpResponseMode === 'modifyResponse') {
                finalOutput = erpResult.output
            } else {
                // decisionOnly — merge decisions with sales response
                finalOutput = await this.mergeResponses(model, systemMessage, input, salesResult.output, erpResult.output)
            }
        } else if (thinkingOrder === 'erpFirst') {
            // Step 1: ERP Agent analyzes first
            const erpInput = `Customer message: ${input}\n\nAnalyze this message and make ERP decisions. Check relevant data using your tools.`
            const erpResult = await this.runAgent(erpAgent, erpInput, chatHistory, loggerHandler, callbacks, false, sseStreamer, chatId)
            allUsedTools.push(...(erpResult.usedTools || []))
            allSourceDocuments.push(...(erpResult.sourceDocuments || []))
            allArtifacts.push(...(erpResult.artifacts || []))

            if (erpResponseMode === 'directResponse') {
                // ERP responds directly — skip Sales
                finalOutput = erpResult.output
            } else {
                // Step 2: Sales Agent responds with ERP context injected
                const salesInput = `Customer message: ${input}\n\n--- ERP Context ---\nThe ERP system has analyzed this request and provided the following data/decisions:\n${erpResult.output}\n--- End ERP Context ---\n\nUse the ERP context above to give an accurate, data-driven response to the customer.`
                const salesResult = await this.runAgent(
                    salesAgent,
                    salesInput,
                    chatHistory,
                    loggerHandler,
                    callbacks,
                    shouldStreamResponse,
                    sseStreamer,
                    chatId
                )
                allUsedTools.push(...(salesResult.usedTools || []))
                allSourceDocuments.push(...(salesResult.sourceDocuments || []))
                allArtifacts.push(...(salesResult.artifacts || []))
                finalOutput = salesResult.output
            }
        } else if (thinkingOrder === 'parallel') {
            // Run both agents in parallel
            const [salesResult, erpResult] = await Promise.all([
                this.runAgent(salesAgent, input, chatHistory, loggerHandler, callbacks, false, sseStreamer, chatId),
                this.runAgent(erpAgent, `Customer message: ${input}`, chatHistory, loggerHandler, callbacks, false, sseStreamer, chatId)
            ])

            allUsedTools.push(...(salesResult.usedTools || []), ...(erpResult.usedTools || []))
            allSourceDocuments.push(...(salesResult.sourceDocuments || []), ...(erpResult.sourceDocuments || []))
            allArtifacts.push(...(salesResult.artifacts || []), ...(erpResult.artifacts || []))

            if (erpResponseMode === 'directResponse') {
                finalOutput = erpResult.output
            } else if (erpResponseMode === 'modifyResponse') {
                // Use orchestrator to merge
                finalOutput = await this.mergeResponses(model, systemMessage, input, salesResult.output, erpResult.output)
            } else {
                // decisionOnly — merge decisions with sales response
                finalOutput = await this.mergeResponses(model, systemMessage, input, salesResult.output, erpResult.output)
            }
        }

        // Clean output
        finalOutput = extractOutputFromArray(finalOutput)
        finalOutput = removeInvalidImageMarkdown(finalOutput)

        // Strip <thinking> tags
        const regexPattern: RegExp = /<thinking>[\s\S]*?<\/thinking>/
        const matches: RegExpMatchArray | null = finalOutput.match(regexPattern)
        if (matches) {
            for (const match of matches) {
                finalOutput = finalOutput.replace(match, '')
            }
        }

        // Save to shared memory
        await memory.addChatMessages(
            [
                { text: input, type: 'userMessage' },
                { text: finalOutput, type: 'apiMessage' }
            ],
            this.sessionId
        )

        // Stream final output if needed
        if (shouldStreamResponse && sseStreamer) {
            sseStreamer.streamTokenEvent(chatId, finalOutput)
        }

        // Build response
        if (allSourceDocuments.length || allUsedTools.length || allArtifacts.length) {
            const result: ICommonObject = { text: finalOutput }
            if (allSourceDocuments.length) result.sourceDocuments = flatten(allSourceDocuments)
            if (allUsedTools.length) result.usedTools = allUsedTools
            if (allArtifacts.length) result.artifacts = flatten(allArtifacts)
            return result
        }

        return finalOutput
    }

    /**
     * Run a single agent (Sales or ERP) and return structured result
     */
    private async runAgent(
        agent: AgentExecutor,
        input: string,
        chatHistory: BaseMessage[],
        loggerHandler: ConsoleCallbackHandler,
        callbacks: any[],
        shouldStream: boolean,
        sseStreamer: IServerSideEventStreamer,
        chatId: string
    ): Promise<{
        output: string
        usedTools: IUsedTool[]
        sourceDocuments: ICommonObject[]
        artifacts: any[]
    }> {
        // Inject chat history via prependMessages so agents see shared memory
        const agentCallbacks =
            shouldStream && sseStreamer
                ? [loggerHandler, new CustomChainHandler(sseStreamer, chatId), ...callbacks]
                : [loggerHandler, ...callbacks]

        // Pass chat history as prependMessages for the agent's memory placeholder
        const invokeOptions: any = { input }

        let res: ChainValues
        try {
            res = await agent.invoke(invokeOptions, { callbacks: agentCallbacks })
        } catch (e: any) {
            console.error(`[AppCityAgent] Agent execution error:`, e.message)
            return {
                output: `Error: ${e.message}`,
                usedTools: [],
                sourceDocuments: [],
                artifacts: []
            }
        }

        let output = res?.output || ''
        output = extractOutputFromArray(output)

        return {
            output,
            usedTools: res.usedTools ? flatten(res.usedTools) : [],
            sourceDocuments: res.sourceDocuments ? flatten(res.sourceDocuments) : [],
            artifacts: res.artifacts ? flatten(res.artifacts) : []
        }
    }

    /**
     * Use the orchestrator model to merge Sales and ERP outputs
     */
    private async mergeResponses(
        model: BaseChatModel,
        systemMessage: string,
        customerInput: string,
        salesResponse: string,
        erpOutput: string
    ): Promise<string> {
        const messages = [
            new SystemMessage(systemMessage),
            new HumanMessage(
                `Customer message: "${customerInput}"

Sales Agent response:
${salesResponse}

ERP Agent output:
${erpOutput}

Please produce the final response to send to the customer. Merge the Sales Agent's conversational response with any relevant ERP data/decisions. Keep the tone friendly and natural.`
            )
        ]

        try {
            const result = await model.invoke(messages)
            return typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
        } catch (e: any) {
            console.error(`[AppCityAgent] Merge error:`, e.message)
            // Fallback to sales response if merge fails
            return salesResponse
        }
    }
}

module.exports = { nodeClass: AppCityAgent_Agents }
