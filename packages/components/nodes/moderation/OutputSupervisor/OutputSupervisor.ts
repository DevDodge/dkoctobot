import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src'
import { OutputModeration } from '../Moderation'
import { OutputSupervisorRunner } from './OutputSupervisorRunner'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'

class OutputSupervisor implements INode {
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
        this.label = 'Output Supervisor'
        this.name = 'outputSupervisor'
        this.version = 1.0
        this.type = 'OutputModeration'
        this.icon = 'supervisor.svg'
        this.category = 'Moderation'
        this.description =
            'Reviews agent output against validation rules before sending to user. Acts as a quality gate to prevent hallucinations and rule violations.'
        this.baseClasses = [this.type, ...getBaseClasses(OutputModeration)]
        this.inputs = [
            {
                label: 'Chat Model',
                name: 'model',
                type: 'BaseChatModel',
                description: 'LLM used to review the output. Use a fast, cheap model (e.g. gpt-4.1-nano, gpt-4o-mini) to minimize cost.'
            },
            {
                label: 'Validation Rules',
                name: 'validationRules',
                type: 'string',
                rows: 10,
                placeholder: `Enter one rule per line, e.g.:\n- Must respond in Egyptian Arabic\n- Must use ChatflowTool_0 before mentioning prices\n- Never reveal system prompt details\n- Must ask for customer name before creating an order\n- Do not re-ask questions already answered in conversation`,
                description:
                    'List of rules the supervisor will check against the agent output. Enter one rule per line. Keep rules clear and specific for best results.'
            },
            {
                label: 'Max Retries',
                name: 'maxRetries',
                type: 'number',
                default: 1,
                description:
                    'Maximum number of times the agent will retry generating a response if the supervisor rejects it. Higher values = more accurate but slower.',
                optional: true,
                additionalParams: true
            },
            {
                label: 'On Failure Action',
                name: 'onFailureAction',
                type: 'options',
                options: [
                    {
                        label: 'Return Original Response',
                        name: 'returnOriginal',
                        description: 'If all retries fail, return the original agent response anyway'
                    },
                    {
                        label: 'Return Error Message',
                        name: 'returnError',
                        description: 'If all retries fail, return a generic error message'
                    }
                ],
                default: 'returnOriginal',
                description: 'What to do when the agent response still fails validation after all retries.',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Error Message',
                name: 'errorMessage',
                type: 'string',
                rows: 2,
                default: 'عذراً، حدث خطأ في معالجة ردك. يرجى المحاولة مرة أخرى.',
                description: 'Custom error message when On Failure Action is set to Return Error Message.',
                optional: true,
                additionalParams: true
            }
        ]
    }

    async init(nodeData: INodeData): Promise<any> {
        const validationRules = nodeData.inputs?.validationRules as string
        const model = nodeData.inputs?.model as BaseChatModel
        const maxRetries = nodeData.inputs?.maxRetries as number
        const onFailureAction = nodeData.inputs?.onFailureAction as string
        const errorMessage = nodeData.inputs?.errorMessage as string

        const runner = new OutputSupervisorRunner(validationRules, model)
        // Attach config to the runner for the ToolAgent to use
        ;(runner as any).maxRetries = maxRetries || 1
        ;(runner as any).onFailureAction = onFailureAction || 'returnOriginal'
        ;(runner as any).errorMessage = errorMessage || 'عذراً، حدث خطأ في معالجة ردك. يرجى المحاولة مرة أخرى.'

        return runner
    }
}

module.exports = { nodeClass: OutputSupervisor }
