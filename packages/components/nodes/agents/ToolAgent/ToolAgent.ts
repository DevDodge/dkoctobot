import { flatten } from 'lodash'
import { Tool } from '@langchain/core/tools'
import { BaseMessage } from '@langchain/core/messages'
import { ChainValues } from '@langchain/core/utils/types'
import { RunnableSequence } from '@langchain/core/runnables'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatPromptTemplate, MessagesPlaceholder, HumanMessagePromptTemplate, PromptTemplate } from '@langchain/core/prompts'
import { formatToOpenAIToolMessages } from '@langchain/classic/agents/format_scratchpad/openai_tools'
import { type ToolsAgentStep } from '@langchain/classic/agents/openai/output_parser'
import {
    extractOutputFromArray,
    getBaseClasses,
    handleEscapeCharacters,
    removeInvalidImageMarkdown,
    transformBracesWithColon
} from '../../../src/utils'
import { FlowiseMemory, ICommonObject, INode, INodeData, INodeParams, IServerSideEventStreamer, IUsedTool } from '../../../src/Interface'
import { ConsoleCallbackHandler, CustomChainHandler, CustomStreamingHandler, additionalCallbacks } from '../../../src/handler'
import { AgentExecutor, ToolCallingAgentOutputParser } from '../../../src/agents'
import { Moderation, OutputModeration, OutputCheckResult, checkInputs, checkOutputs, streamResponse } from '../../moderation/Moderation'
import { formatResponse } from '../../outputparsers/OutputParserHelpers'
import { addImagesToMessages, llmSupportsVision } from '../../../src/multiModalUtils'

class ToolAgent_Agents implements INode {
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
        this.label = 'Tool Agent'
        this.name = 'toolAgent'
        this.version = 2.0
        this.type = 'AgentExecutor'
        this.category = 'Agents'
        this.icon = 'toolAgent.png'
        this.description = `Agent that uses Function Calling to pick the tools and args to call`
        this.baseClasses = [this.type, ...getBaseClasses(AgentExecutor)]
        this.inputs = [
            {
                label: 'Tools',
                name: 'tools',
                type: 'Tool',
                list: true
            },
            {
                label: 'Memory',
                name: 'memory',
                type: 'BaseChatMemory'
            },
            {
                label: 'Tool Calling Chat Model',
                name: 'model',
                type: 'BaseChatModel',
                description:
                    'Only compatible with models that are capable of function calling: ChatOpenAI, ChatMistral, ChatAnthropic, ChatGoogleGenerativeAI, ChatVertexAI, GroqChat'
            },
            {
                label: 'Chat Prompt Template',
                name: 'chatPromptTemplate',
                type: 'ChatPromptTemplate',
                description: 'Override existing prompt with Chat Prompt Template. Human Message must includes {input} variable',
                optional: true
            },
            {
                label: 'System Message',
                name: 'systemMessage',
                type: 'string',
                default: `You are a helpful AI assistant.`,
                description: 'If Chat Prompt Template is provided, this will be ignored',
                rows: 4,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Input Moderation',
                description: 'Detect text that could generate harmful output and prevent it from being sent to the language model',
                name: 'inputModeration',
                type: 'Moderation',
                optional: true,
                list: true
            },
            {
                label: 'Output Supervisor',
                description:
                    'Review agent output against validation rules before sending to user. Acts as a quality gate to prevent hallucinations.',
                name: 'outputModeration',
                type: 'OutputModeration',
                optional: true,
                list: true
            },
            {
                label: 'Max Iterations',
                name: 'maxIterations',
                type: 'number',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Enable Detailed Streaming',
                name: 'enableDetailedStreaming',
                type: 'boolean',
                default: false,
                description: 'Stream detailed intermediate steps during agent execution',
                optional: true,
                additionalParams: true
            }
        ]
        this.sessionId = fields?.sessionId
    }

    async init(nodeData: INodeData, input: string, options: ICommonObject): Promise<any> {
        return prepareAgent(nodeData, options, { sessionId: this.sessionId, chatId: options.chatId, input })
    }

    async run(nodeData: INodeData, input: string, options: ICommonObject): Promise<string | ICommonObject> {
        const memory = nodeData.inputs?.memory as FlowiseMemory
        const moderations = nodeData.inputs?.inputModeration as Moderation[]
        const outputModerations = nodeData.inputs?.outputModeration as OutputModeration[]
        const enableDetailedStreaming = nodeData.inputs?.enableDetailedStreaming as boolean

        const shouldStreamResponse = options.shouldStreamResponse
        const sseStreamer: IServerSideEventStreamer = options.sseStreamer as IServerSideEventStreamer
        const chatId = options.chatId

        if (moderations && moderations.length > 0) {
            try {
                // Use the output of the moderation chain as input for the OpenAI Function Agent
                input = await checkInputs(moderations, input)
            } catch (e) {
                await new Promise((resolve) => setTimeout(resolve, 500))
                if (shouldStreamResponse) {
                    streamResponse(sseStreamer, chatId, e.message)
                }
                return formatResponse(e.message)
            }
        }

        const executor = await prepareAgent(nodeData, options, { sessionId: this.sessionId, chatId: options.chatId, input })

        const loggerHandler = new ConsoleCallbackHandler(options.logger, options?.orgId)
        const callbacks = await additionalCallbacks(nodeData, options)

        // Add custom streaming handler if detailed streaming is enabled
        let customStreamingHandler = null

        if (enableDetailedStreaming && shouldStreamResponse) {
            customStreamingHandler = new CustomStreamingHandler(sseStreamer, chatId)
        }

        let res: ChainValues = {}
        let sourceDocuments: ICommonObject[] = []
        let usedTools: IUsedTool[] = []
        let artifacts = []

        // Determine if we need to buffer output for supervisor review
        const hasSupervisor = outputModerations && outputModerations.length > 0
        const useBufferedMode = hasSupervisor && shouldStreamResponse

        if (useBufferedMode) {
            // === BUFFERED MODE: Run agent WITHOUT streaming, supervisor checks first ===
            const allCallbacks = [loggerHandler, ...callbacks]
            if (enableDetailedStreaming && customStreamingHandler) {
                // Don't add streaming handler — we buffer the output
            }

            res = await executor.invoke({ input }, { callbacks: allCallbacks })
            if (res.sourceDocuments) sourceDocuments = res.sourceDocuments
            if (res.usedTools) usedTools = res.usedTools
            if (res.artifacts) artifacts = res.artifacts
        } else if (shouldStreamResponse) {
            // === NORMAL STREAMING: No supervisor, stream directly ===
            const handler = new CustomChainHandler(sseStreamer, chatId)
            const allCallbacks = [loggerHandler, handler, ...callbacks]

            // Add detailed streaming handler if enabled
            if (enableDetailedStreaming && customStreamingHandler) {
                allCallbacks.push(customStreamingHandler)
            }

            res = await executor.invoke({ input }, { callbacks: allCallbacks })
            if (res.sourceDocuments) {
                if (sseStreamer) {
                    sseStreamer.streamSourceDocumentsEvent(chatId, flatten(res.sourceDocuments))
                }
                sourceDocuments = res.sourceDocuments
            }
            if (res.usedTools) {
                if (sseStreamer) {
                    sseStreamer.streamUsedToolsEvent(chatId, flatten(res.usedTools))
                }
                usedTools = res.usedTools
            }
            if (res.artifacts) {
                if (sseStreamer) {
                    sseStreamer.streamArtifactsEvent(chatId, flatten(res.artifacts))
                }
                artifacts = res.artifacts
            }
            // If the tool is set to returnDirect, stream the output to the client
            if (res.usedTools && res.usedTools.length) {
                let inputTools = nodeData.inputs?.tools
                inputTools = flatten(inputTools)
                for (const tool of res.usedTools) {
                    const inputTool = inputTools.find((inputTool: Tool) => inputTool.name === tool.tool)
                    if (inputTool && inputTool.returnDirect && shouldStreamResponse) {
                        sseStreamer.streamTokenEvent(chatId, tool.toolOutput)
                    }
                }
            }
        } else {
            // === NON-STREAMING MODE ===
            const allCallbacks = [loggerHandler, ...callbacks]

            // Add detailed streaming handler if enabled
            if (enableDetailedStreaming && customStreamingHandler) {
                allCallbacks.push(customStreamingHandler)
            }

            res = await executor.invoke({ input }, { callbacks: allCallbacks })
            if (res.sourceDocuments) {
                sourceDocuments = res.sourceDocuments
            }
            if (res.usedTools) {
                usedTools = res.usedTools
            }
            if (res.artifacts) {
                artifacts = res.artifacts
            }
        }

        let output = res?.output
        output = extractOutputFromArray(res?.output)
        output = removeInvalidImageMarkdown(output)

        // Claude 3 Opus tends to spit out <thinking>..</thinking> as well, discard that in final output
        // https://docs.anthropic.com/en/docs/build-with-claude/tool-use#chain-of-thought
        const regexPattern: RegExp = /<thinking>[\s\S]*?<\/thinking>/
        const matches: RegExpMatchArray | null = output.match(regexPattern)
        if (matches) {
            for (const match of matches) {
                output = output.replace(match, '')
            }
        }

        // Output Supervisor: validate response before sending
        let supervisorResults: IUsedTool[] = []
        if (hasSupervisor) {
            const maxRetries = (outputModerations[0] as any).maxRetries || 1
            const onFailureAction = (outputModerations[0] as any).onFailureAction || 'returnOriginal'
            const errorMessage = (outputModerations[0] as any).errorMessage || 'عذراً، حدث خطأ في معالجة ردك.'
            let retryCount = 0
            let lastResult: OutputCheckResult | null = null

            while (retryCount <= maxRetries) {
                const result = await checkOutputs(outputModerations, output, input)
                lastResult = result
                const currentOutput = output // Capture full output for this attempt

                const supervisorEntry: IUsedTool = {
                    tool: '🛡️ Output Supervisor',
                    toolInput: { output_reviewed: currentOutput, rules_checked: true },
                    toolOutput: JSON.stringify({
                        approved: result.approved,
                        violations: result.violations,
                        feedback: result.feedback,
                        confidence: result.confidence,
                        attempt: retryCount + 1
                    })
                }

                if (result.approved) {
                    supervisorResults.push(supervisorEntry)
                    break
                }

                supervisorResults.push({ ...supervisorEntry, error: result.violations.join('; ') })

                if (retryCount < maxRetries) {
                    // Re-generate with correction feedback
                    const correctionInput = `${input}\n\n[SUPERVISOR CORRECTION - Attempt ${
                        retryCount + 1
                    }]: The previous response violated these rules: ${result.violations.join(', ')}. ${
                        result.feedback
                    }. Please regenerate a corrected response.`

                    const retryExecutor = await prepareAgent(nodeData, options, {
                        sessionId: this.sessionId,
                        chatId: options.chatId,
                        input: correctionInput
                    })
                    const retryRes = await retryExecutor.invoke(
                        { input: correctionInput },
                        {
                            callbacks: [
                                new ConsoleCallbackHandler(options.logger, options?.orgId),
                                ...(await additionalCallbacks(nodeData, options))
                            ]
                        }
                    )
                    output = extractOutputFromArray(retryRes?.output)
                    output = removeInvalidImageMarkdown(output)
                }
                retryCount++
            }

            // Handle final failure
            if (lastResult && !lastResult.approved && onFailureAction === 'returnError') {
                output = errorMessage
            }

            // NOW stream the final approved/corrected output to the client
            if (useBufferedMode && sseStreamer) {
                // Send start event first (client needs this to begin rendering)
                sseStreamer.streamStartEvent(chatId, '')

                // Stream the final output (after supervisor approval)
                sseStreamer.streamTokenEvent(chatId, output)

                // Stream source documents, used tools, artifacts
                if (sourceDocuments.length) {
                    sseStreamer.streamSourceDocumentsEvent(chatId, flatten(sourceDocuments))
                }
                if (artifacts.length) {
                    sseStreamer.streamArtifactsEvent(chatId, flatten(artifacts))
                }
            }

            // Stream supervisor results as used tools
            if (supervisorResults.length > 0) {
                usedTools = [...usedTools, ...supervisorResults]
                if (shouldStreamResponse && sseStreamer) {
                    sseStreamer.streamUsedToolsEvent(chatId, supervisorResults)
                }

                // Save violations to database for Supervisor Monitor
                try {
                    const appDataSource = options.appDataSource
                    const chatflowid = options.chatflowid
                    if (appDataSource && chatflowid) {
                        const violationEntries = supervisorResults.filter((s: IUsedTool) => s.error)
                        for (const entry of violationEntries) {
                            const parsed = JSON.parse(entry.toolOutput as string)
                            const logData = {
                                chatflowid,
                                chatId: options.chatId || '',
                                sessionId: this.sessionId || '',
                                userInput: input.substring(0, 2000),
                                originalOutput: (entry.toolInput as any)?.output_reviewed || '',
                                correctedOutput: lastResult?.approved ? output : '',
                                violations: JSON.stringify(parsed.violations || []),
                                feedback: parsed.feedback || '',
                                attempt: parsed.attempt || 1,
                                approved: lastResult?.approved || false,
                                confidence: parsed.confidence || 0
                            }
                            // Use direct repository access to save the log
                            const repo = appDataSource.getRepository('SupervisorLog')
                            const newLog = repo.create(logData)
                            await repo.save(newLog)
                        }
                    }
                } catch (dbError) {
                    console.error('Failed to save supervisor log:', dbError)
                }
            }
        }

        await memory.addChatMessages(
            [
                {
                    text: input,
                    type: 'userMessage'
                },
                {
                    text: output,
                    type: 'apiMessage'
                }
            ],
            this.sessionId
        )

        let finalRes = output

        if (sourceDocuments.length || usedTools.length || artifacts.length) {
            const finalRes: ICommonObject = { text: output }
            if (sourceDocuments.length) {
                finalRes.sourceDocuments = flatten(sourceDocuments)
            }
            if (usedTools.length) {
                finalRes.usedTools = usedTools
            }
            if (artifacts.length) {
                finalRes.artifacts = artifacts
            }
            return finalRes
        }

        return finalRes
    }
}

const prepareAgent = async (
    nodeData: INodeData,
    options: ICommonObject,
    flowObj: { sessionId?: string; chatId?: string; input?: string }
) => {
    const model = nodeData.inputs?.model as BaseChatModel
    const maxIterations = nodeData.inputs?.maxIterations as string
    const memory = nodeData.inputs?.memory as FlowiseMemory
    let systemMessage = nodeData.inputs?.systemMessage as string
    let tools = nodeData.inputs?.tools
    tools = flatten(tools)
    const memoryKey = memory.memoryKey ? memory.memoryKey : 'chat_history'
    const inputKey = memory.inputKey ? memory.inputKey : 'input'
    const prependMessages = options?.prependMessages

    systemMessage = transformBracesWithColon(systemMessage)

    let prompt = ChatPromptTemplate.fromMessages([
        ['system', systemMessage],
        new MessagesPlaceholder(memoryKey),
        ['human', `{${inputKey}}`],
        new MessagesPlaceholder('agent_scratchpad')
    ])

    let promptVariables = {}
    const chatPromptTemplate = nodeData.inputs?.chatPromptTemplate as ChatPromptTemplate
    if (chatPromptTemplate && chatPromptTemplate.promptMessages.length) {
        const humanPrompt = chatPromptTemplate.promptMessages[chatPromptTemplate.promptMessages.length - 1]
        const messages = [
            ...chatPromptTemplate.promptMessages.slice(0, -1),
            new MessagesPlaceholder(memoryKey),
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
        const messageContent = await addImagesToMessages(nodeData, options, model.multiModalOption)

        if (messageContent?.length) {
            // Pop the `agent_scratchpad` MessagePlaceHolder
            let messagePlaceholder = prompt.promptMessages.pop() as MessagesPlaceholder
            if (prompt.promptMessages[prompt.promptMessages.length - 1] instanceof HumanMessagePromptTemplate) {
                const lastMessage = prompt.promptMessages.pop() as HumanMessagePromptTemplate
                const template = (lastMessage.prompt as PromptTemplate).template as string
                const msg = HumanMessagePromptTemplate.fromTemplate([
                    ...messageContent,
                    {
                        text: template
                    }
                ])
                msg.inputVariables = lastMessage.inputVariables
                prompt.promptMessages.push(msg)
            }

            // Add the `agent_scratchpad` MessagePlaceHolder back
            prompt.promptMessages.push(messagePlaceholder)
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
            [memoryKey]: async (_: { input: string; steps: ToolsAgentStep[] }) => {
                const messages = (await memory.getChatMessages(flowObj?.sessionId, true, prependMessages)) as BaseMessage[]
                return messages ?? []
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

    return executor
}

module.exports = { nodeClass: ToolAgent_Agents }
