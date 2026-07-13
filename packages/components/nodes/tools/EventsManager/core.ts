import { z } from 'zod/v3'
import fetch from 'node-fetch'
import { DynamicStructuredTool } from '../OpenAPIToolkit/core'
import { TOOL_ARGS_PREFIX, formatToolError } from '../../../src/agents'
import { ICommonObject } from '../../../src/Interface'

const BASE_URL = 'https://educon.octobot.it.com/api/orders/chat'

export interface EventsManagerParams {
    actions: string[]
    useFlowChatId: boolean
    toolNamePrefix?: string
}

// ─── Schemas ────────────────────────────────────────────────────────

const GetMenuSchema = z.object({})

const GetMyOrdersSchema = z.object({})

const SubmitComplaintSchema = z.object({
    text: z.string().describe('The complaint text from the customer describing the issue, e.g. "الطلب وصل بارد ومحتاج يتغير"')
})

const PlaceOrderSchema = z.object({
    items: z
        .string()
        .describe(
            'JSON array of order items, each with "name" (string) and "qty" (number). Example: [{"name":"كابتشينو","qty":2},{"name":"مياه","qty":1}]'
        ),
    notes: z.string().optional().describe('Optional notes for the order, e.g. "بدون سكر"')
})

// ─── Helper: extract chatId from flow context ──────────────────────

function getChatId(tool: DynamicStructuredTool, flowConfig?: ICommonObject): string {
    // Priority: flowConfig (from regular AgentExecutor) > flowObj (from sequential ToolNode)
    const chatId = flowConfig?.chatId || (tool as any).flowObj?.chatId

    if (!chatId) {
        throw new Error('Chat ID not available. Make sure the workflow passes a valid chatId.')
    }

    return chatId as string
}

// ─── Tool Classes ───────────────────────────────────────────────────

class GetMenuTool extends DynamicStructuredTool {
    constructor(args: { toolNamePrefix?: string }) {
        const toolInput = {
            name: args.toolNamePrefix ? `${args.toolNamePrefix}_get_menu` : 'events_manager_get_menu',
            description: `Retrieve the available menu items for the current chat session. Returns a JSON list of menu items with names, prices, and availability. No input parameters needed.`,
            schema: GetMenuSchema,
            baseUrl: '',
            method: 'GET',
            headers: {}
        }
        super(toolInput)
    }

    async _call(
        _arg: any,
        _runManager?: any,
        flowConfig?: { sessionId?: string; chatId?: string; input?: string; state?: ICommonObject }
    ): Promise<string> {
        try {
            const chatId = getChatId(this, flowConfig)
            const url = `${BASE_URL}/menu/${chatId}`
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'application/json'
                }
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`API Error ${response.status}: ${response.statusText} - ${errorText}`)
            }

            const data = await response.text()
            return data + TOOL_ARGS_PREFIX + JSON.stringify({ chatId })
        } catch (error: any) {
            return formatToolError(`Error fetching menu: ${error.message}`, {})
        }
    }
}

class PlaceOrderTool extends DynamicStructuredTool {
    constructor(args: { toolNamePrefix?: string }) {
        const toolInput = {
            name: args.toolNamePrefix ? `${args.toolNamePrefix}_place_order` : 'events_manager_place_order',
            description: `Place an order for the current chat session. Requires items (JSON array of {name, qty}) and optional notes.`,
            schema: PlaceOrderSchema,
            baseUrl: '',
            method: 'POST',
            headers: {}
        }
        super(toolInput)
    }

    async _call(
        arg: any,
        _runManager?: any,
        flowConfig?: { sessionId?: string; chatId?: string; input?: string; state?: ICommonObject }
    ): Promise<string> {
        try {
            const chatId = getChatId(this, flowConfig)

            // Parse items from JSON string
            let items: Array<{ name: string; qty: number }>
            try {
                items = JSON.parse(arg.items)
            } catch {
                throw new Error('items must be a valid JSON array, e.g. [{"name":"كابتشينو","qty":2}]')
            }

            const body: any = {
                chatId,
                items
            }

            if (arg.notes) {
                body.notes = arg.notes
            }

            const url = `${BASE_URL}/place-order`
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify(body)
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`API Error ${response.status}: ${response.statusText} - ${errorText}`)
            }

            const data = await response.text()
            return data + TOOL_ARGS_PREFIX + JSON.stringify({ chatId, items, notes: arg.notes })
        } catch (error: any) {
            return formatToolError(`Error placing order: ${error.message}`, {})
        }
    }
}

class GetMyOrdersTool extends DynamicStructuredTool {
    constructor(args: { toolNamePrefix?: string }) {
        const toolInput = {
            name: args.toolNamePrefix ? `${args.toolNamePrefix}_get_my_orders` : 'events_manager_get_my_orders',
            description: `Retrieve all orders placed by the current chat session. Returns a JSON list of the customer's orders. No input parameters needed.`,
            schema: GetMyOrdersSchema,
            baseUrl: '',
            method: 'POST',
            headers: {}
        }
        super(toolInput)
    }

    async _call(
        _arg: any,
        _runManager?: any,
        flowConfig?: { sessionId?: string; chatId?: string; input?: string; state?: ICommonObject }
    ): Promise<string> {
        try {
            const chatId = getChatId(this, flowConfig)
            const url = `${BASE_URL}/my-orders`
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify({ chatId })
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`API Error ${response.status}: ${response.statusText} - ${errorText}`)
            }

            const data = await response.text()
            return data + TOOL_ARGS_PREFIX + JSON.stringify({ chatId })
        } catch (error: any) {
            return formatToolError(`Error fetching orders: ${error.message}`, {})
        }
    }
}

class SubmitComplaintTool extends DynamicStructuredTool {
    constructor(args: { toolNamePrefix?: string }) {
        const toolInput = {
            name: args.toolNamePrefix ? `${args.toolNamePrefix}_submit_complaint` : 'events_manager_submit_complaint',
            description: `Submit a complaint or feedback from the customer about their order or experience. Requires the complaint text.`,
            schema: SubmitComplaintSchema,
            baseUrl: '',
            method: 'POST',
            headers: {}
        }
        super(toolInput)
    }

    async _call(
        arg: any,
        _runManager?: any,
        flowConfig?: { sessionId?: string; chatId?: string; input?: string; state?: ICommonObject }
    ): Promise<string> {
        try {
            const chatId = getChatId(this, flowConfig)
            const url = `${BASE_URL}/complaint`
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json'
                },
                body: JSON.stringify({ chatId, text: arg.text })
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`API Error ${response.status}: ${response.statusText} - ${errorText}`)
            }

            const data = await response.text()
            return data + TOOL_ARGS_PREFIX + JSON.stringify({ chatId, text: arg.text })
        } catch (error: any) {
            return formatToolError(`Error submitting complaint: ${error.message}`, {})
        }
    }
}

// ─── Factory ────────────────────────────────────────────────────────

export const createEventsManagerTools = (args: EventsManagerParams): DynamicStructuredTool[] => {
    const { actions = [], toolNamePrefix } = args
    const tools: DynamicStructuredTool[] = []

    const toolClasses: Record<string, new (opts: { toolNamePrefix?: string }) => DynamicStructuredTool> = {
        getMenu: GetMenuTool,
        placeOrder: PlaceOrderTool,
        getMyOrders: GetMyOrdersTool,
        submitComplaint: SubmitComplaintTool
    }

    actions.forEach((action) => {
        const ToolClass = toolClasses[action]
        if (ToolClass) {
            tools.push(new ToolClass({ toolNamePrefix }))
        }
    })

    return tools
}
