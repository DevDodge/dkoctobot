import { convertMultiOptionsToStringArray } from '../../../src/utils'
import { createEventsManagerTools } from './core'
import type { INode, INodeData, INodeParams } from '../../../src/Interface'

class EventsManager_Tools implements INode {
    label: string
    name: string
    version: number
    type: string
    icon: string
    category: string
    description: string
    baseClasses: string[]
    inputs: INodeParams[]

    constructor() {
        this.label = 'Events Manager'
        this.name = 'eventsManager'
        this.version = 1.0
        this.type = 'EventsManager'
        this.icon = 'events-manager.svg'
        this.category = 'Tools'
        this.description = 'Manage orders via Events Manager API – fetch menus, place orders, and view my orders'
        this.baseClasses = ['Tool']
        this.inputs = [
            {
                label: 'Tool Name',
                name: 'toolName',
                type: 'string',
                description: 'A name prefix used to identify this tool in the prompt (e.g. "CafeOrders")',
                placeholder: 'e.g. CafeOrders',
                optional: true
            },
            {
                label: 'Tool Description',
                name: 'toolDesc',
                type: 'string',
                rows: 4,
                description: 'Description of what this tool does – shown to the LLM',
                default:
                    'Use this tool to interact with the ordering system. You can fetch the available menu or place an order for the customer.',
                optional: true
            },
            // ── Variables dropdown ──
            {
                label: 'Variables',
                name: 'variables',
                type: 'multiOptions',
                description: 'Select flow variables to use in the tool. Selected variables are automatically resolved at runtime.',
                options: [
                    {
                        label: 'Chat ID',
                        name: 'chatId',
                        description: 'Uses $flow.chatId – the chat identifier from the current workflow session'
                    }
                ]
            },
            // ── Type dropdown ──
            {
                label: 'Type',
                name: 'ordersType',
                type: 'options',
                description: 'Category of Events Manager operations',
                options: [
                    {
                        label: 'Orders',
                        name: 'orders'
                    }
                ],
                default: 'orders'
            },
            // ── Orders Actions (shown when Type = Orders) ──
            {
                label: 'Orders Actions',
                name: 'ordersActions',
                type: 'multiOptions',
                description: 'Select which ordering actions to enable',
                options: [
                    {
                        label: 'Get Menu',
                        name: 'getMenu',
                        description: 'Fetch the available menu items for the chat'
                    },
                    {
                        label: 'Place Order',
                        name: 'placeOrder',
                        description: 'Place a new order with items and optional notes'
                    },
                    {
                        label: 'Get My Orders',
                        name: 'getMyOrders',
                        description: 'Retrieve all orders placed by the current chat session'
                    },
                    {
                        label: 'Submit Complaint',
                        name: 'submitComplaint',
                        description: 'Submit a complaint or feedback about an order or experience'
                    }
                ],
                show: {
                    ordersType: ['orders']
                }
            }
        ]
    }

    async init(nodeData: INodeData): Promise<any> {
        const toolNamePrefix = (nodeData.inputs?.toolName as string) || ''

        // Determine which variables are selected
        const selectedVars: string[] = convertMultiOptionsToStringArray(nodeData.inputs?.variables)
        const useFlowChatId = selectedVars.includes('chatId')

        if (!useFlowChatId) {
            throw new Error('Please select "Chat ID" from the Variables dropdown. It is required for the ordering APIs.')
        }

        // Get selected actions
        const actions: string[] = convertMultiOptionsToStringArray(nodeData.inputs?.ordersActions)

        if (!actions.length) {
            throw new Error('Please select at least one Orders Action')
        }

        const tools = createEventsManagerTools({
            actions,
            useFlowChatId,
            toolNamePrefix: toolNamePrefix || undefined
        })

        return tools
    }
}

module.exports = { nodeClass: EventsManager_Tools }
