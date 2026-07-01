import { z } from 'zod'
import fetch from 'node-fetch'
import { DynamicStructuredTool } from '../OpenAPIToolkit/core'
import { TOOL_ARGS_PREFIX, formatToolError } from '../../../src/agents'

const BASE_URL = 'https://dk.whatsdeveloper.com/api/v1'

export interface OctobotWappConfig {
    deviceUuid: string
    apiToken: string
    defaultRecipients?: string
}

// ─── Base Tool ───────────────────────────────────────────────────────────────

class BaseOctobotWappTool extends DynamicStructuredTool {
    protected deviceUuid: string = ''
    protected apiToken: string = ''
    protected defaultRecipients: string = ''

    constructor(args: any) {
        super(args)
        this.deviceUuid = args.deviceUuid ?? ''
        this.apiToken = args.apiToken ?? ''
        this.defaultRecipients = args.defaultRecipients ?? ''
    }

    async makeRequest({
        endpoint,
        method = 'GET',
        body,
        params
    }: {
        endpoint: string
        method?: string
        body?: any
        params?: any
    }): Promise<string> {
        const url = `${BASE_URL}/${endpoint}`

        const headers: Record<string, string> = {
            'X-Device-UUID': this.deviceUuid,
            'X-API-Token': this.apiToken,
            'Content-Type': 'application/json',
            Accept: 'application/json'
        }

        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        })

        const data = await response.text()

        if (!response.ok) {
            throw new Error(`OctobotWapp API Error ${response.status}: ${response.statusText} - ${data}`)
        }

        return data + TOOL_ARGS_PREFIX + JSON.stringify(params)
    }

    /**
     * Resolve the recipient: use defaultRecipients override if set, otherwise use the AI-provided value
     */
    resolveRecipient(aiProvidedTo: string): string {
        if (this.defaultRecipients && this.defaultRecipients.trim().length > 0) {
            return this.defaultRecipients.trim()
        }
        return aiProvidedTo
    }

    /**
     * Normalize phone numbers — group IDs pass through unchanged, phone numbers get "2" prefix
     */
    normalizeRecipient(input: string): string {
        return input
            .split(',')
            .map((s) => {
                const trimmed = s.trim()
                // Group IDs — pass through unchanged
                if (trimmed.includes('@g.us')) return trimmed
                // Already has 2 prefix — keep as-is
                if (trimmed.startsWith('2')) return trimmed
                // Starts with 0 — replace with 2
                if (trimmed.startsWith('0')) return '2' + trimmed.slice(1)
                // Prepend 2
                return '2' + trimmed
            })
            .join(',')
    }
}

// ─── Messaging Schemas ───────────────────────────────────────────────────────

const SendTextSchema = z.object({
    to: z.string().describe('Phone number(s) — MUST start with "2" prefix (e.g., "201234567890", NOT "01234567890"). Group IDs must be used EXACTLY as-is (e.g., "120363407543489715@g.us"). Comma-separated for bulk sending.'),
    message: z.string().describe('Message content. Supports spintax like {Hello|Hi|Hey}.')
})

const SendImageSchema = z.object({
    to: z.string().describe('Phone number — MUST start with "2" prefix (e.g., "201234567890"). Group IDs use exactly as-is (e.g., "120363407543489715@g.us").'),
    imageUrl: z.string().describe('URL of the image to send'),
    caption: z.string().optional().describe('Image caption')
})

const SendDocumentSchema = z.object({
    to: z.string().describe('Phone number — MUST start with "2" prefix. Group IDs use exactly as-is.'),
    documentUrl: z.string().describe('URL of the document to send'),
    filename: z.string().optional().describe('Filename for the document'),
    caption: z.string().optional().describe('Document caption')
})

const SendAudioSchema = z.object({
    to: z.string().describe('Phone number — MUST start with "2" prefix. Group IDs use exactly as-is.'),
    audioUrl: z.string().describe('URL of the audio to send'),
    ptt: z.boolean().optional().default(false).describe('Send as voice note (Push-To-Talk)')
})

const SendVideoSchema = z.object({
    to: z.string().describe('Phone number — MUST start with "2" prefix. Group IDs use exactly as-is.'),
    videoUrl: z.string().describe('URL of the video to send'),
    caption: z.string().optional().describe('Video caption')
})

const SendLocationSchema = z.object({
    to: z.string().describe('Phone number — MUST start with "2" prefix. Group IDs use exactly as-is.'),
    latitude: z.number().describe('Latitude coordinate'),
    longitude: z.number().describe('Longitude coordinate'),
    description: z.string().optional().describe('Location description')
})

const SendContactSchema = z.object({
    to: z.string().describe('Phone number — MUST start with "2" prefix. Group IDs use exactly as-is.'),
    contactName: z.string().describe('Contact name to share'),
    contactNumber: z.string().describe('Contact phone number to share')
})

const CheckNumberSchema = z.object({
    phoneNumber: z.string().describe('Phone number to check if registered on WhatsApp')
})

// ─── Label Schemas ───────────────────────────────────────────────────────────

const EmptySchema = z.object({})

const LabelIdSchema = z.object({
    labelId: z.string().describe('The label ID')
})

const PhoneNumberSchema = z.object({
    phoneNumber: z.string().describe('Phone number of the chat')
})

const AssignRemoveLabelsSchema = z.object({
    labelIds: z.string().describe('Comma-separated label IDs (e.g., "1,2,3")'),
    chatIds: z.string().describe('Comma-separated phone numbers or chat IDs (e.g., "201234567890,201098765432")')
})

const SetChatLabelsSchema = z.object({
    phoneNumber: z.string().describe('Phone number of the chat'),
    labelIds: z.string().describe('Comma-separated label IDs to set (replaces all current labels). Empty string removes all labels.')
})

// ─── Messaging Tools ─────────────────────────────────────────────────────────

class SendTextTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_send_text',
            description: 'Send a text message via WhatsApp to one or multiple recipients. Supports spintax for message variation.',
            schema: SendTextSchema,
            baseUrl: '',
            method: 'POST',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            const rawTo = this.resolveRecipient(arg.to)
            const to = this.normalizeRecipient(rawTo)
            return await this.makeRequest({
                endpoint: 'messages/send-text',
                method: 'POST',
                body: { to, message: arg.message },
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error sending text message: ${error}`, arg)
        }
    }
}

class SendImageTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_send_image',
            description: 'Send an image message via WhatsApp with an optional caption.',
            schema: SendImageSchema,
            baseUrl: '',
            method: 'POST',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            const rawTo = this.resolveRecipient(arg.to)
            const to = this.normalizeRecipient(rawTo)
            const body: any = { to, imageUrl: arg.imageUrl }
            if (arg.caption) body.caption = arg.caption
            return await this.makeRequest({
                endpoint: 'messages/send-image',
                method: 'POST',
                body,
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error sending image: ${error}`, arg)
        }
    }
}

class SendDocumentTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_send_document',
            description: 'Send a document/file attachment via WhatsApp.',
            schema: SendDocumentSchema,
            baseUrl: '',
            method: 'POST',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            const rawTo = this.resolveRecipient(arg.to)
            const to = this.normalizeRecipient(rawTo)
            const body: any = { to, documentUrl: arg.documentUrl }
            if (arg.filename) body.filename = arg.filename
            if (arg.caption) body.caption = arg.caption
            return await this.makeRequest({
                endpoint: 'messages/send-document',
                method: 'POST',
                body,
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error sending document: ${error}`, arg)
        }
    }
}

class SendAudioTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_send_audio',
            description: 'Send an audio message via WhatsApp. Can be sent as a voice note.',
            schema: SendAudioSchema,
            baseUrl: '',
            method: 'POST',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            const rawTo = this.resolveRecipient(arg.to)
            const to = this.normalizeRecipient(rawTo)
            const body: any = { to, audioUrl: arg.audioUrl }
            if (arg.ptt !== undefined) body.ptt = arg.ptt
            return await this.makeRequest({
                endpoint: 'messages/send-audio',
                method: 'POST',
                body,
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error sending audio: ${error}`, arg)
        }
    }
}

class SendVideoTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_send_video',
            description: 'Send a video message via WhatsApp with an optional caption.',
            schema: SendVideoSchema,
            baseUrl: '',
            method: 'POST',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            const rawTo = this.resolveRecipient(arg.to)
            const to = this.normalizeRecipient(rawTo)
            const body: any = { to, videoUrl: arg.videoUrl }
            if (arg.caption) body.caption = arg.caption
            return await this.makeRequest({
                endpoint: 'messages/send-video',
                method: 'POST',
                body,
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error sending video: ${error}`, arg)
        }
    }
}

class SendLocationTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_send_location',
            description: 'Send a location pin via WhatsApp with coordinates.',
            schema: SendLocationSchema,
            baseUrl: '',
            method: 'POST',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            const rawTo = this.resolveRecipient(arg.to)
            const to = this.normalizeRecipient(rawTo)
            const body: any = { to, latitude: arg.latitude, longitude: arg.longitude }
            if (arg.description) body.description = arg.description
            return await this.makeRequest({
                endpoint: 'messages/send-location',
                method: 'POST',
                body,
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error sending location: ${error}`, arg)
        }
    }
}

class SendContactTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_send_contact',
            description: 'Send a contact card via WhatsApp.',
            schema: SendContactSchema,
            baseUrl: '',
            method: 'POST',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            const rawTo = this.resolveRecipient(arg.to)
            const to = this.normalizeRecipient(rawTo)
            return await this.makeRequest({
                endpoint: 'messages/send-contact',
                method: 'POST',
                body: { to, contactName: arg.contactName, contactNumber: arg.contactNumber },
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error sending contact: ${error}`, arg)
        }
    }
}

class CheckNumberTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_check_number',
            description: 'Check if a phone number is registered on WhatsApp.',
            schema: CheckNumberSchema,
            baseUrl: '',
            method: 'GET',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            return await this.makeRequest({
                endpoint: `check-number/${arg.phoneNumber}`,
                method: 'GET',
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error checking number: ${error}`, arg)
        }
    }
}

// ─── Label Tools ─────────────────────────────────────────────────────────────

class GetLabelsTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_get_labels',
            description: 'Get all WhatsApp Business labels.',
            schema: EmptySchema,
            baseUrl: '',
            method: 'GET',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            return await this.makeRequest({ endpoint: 'labels', method: 'GET', params: arg })
        } catch (error) {
            return formatToolError(`Error getting labels: ${error}`, arg)
        }
    }
}

class GetLabelByIdTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_get_label_by_id',
            description: 'Get a WhatsApp Business label by its ID.',
            schema: LabelIdSchema,
            baseUrl: '',
            method: 'GET',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            return await this.makeRequest({ endpoint: `labels/${arg.labelId}`, method: 'GET', params: arg })
        } catch (error) {
            return formatToolError(`Error getting label: ${error}`, arg)
        }
    }
}

class GetChatsByLabelTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_get_chats_by_label',
            description: 'Get all chats assigned to a specific WhatsApp Business label.',
            schema: LabelIdSchema,
            baseUrl: '',
            method: 'GET',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            return await this.makeRequest({ endpoint: `labels/${arg.labelId}/chats`, method: 'GET', params: arg })
        } catch (error) {
            return formatToolError(`Error getting chats by label: ${error}`, arg)
        }
    }
}

class GetChatLabelsTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_get_chat_labels',
            description: 'Get all labels assigned to a specific chat by phone number.',
            schema: PhoneNumberSchema,
            baseUrl: '',
            method: 'GET',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            return await this.makeRequest({ endpoint: `chat/${arg.phoneNumber}/labels`, method: 'GET', params: arg })
        } catch (error) {
            return formatToolError(`Error getting chat labels: ${error}`, arg)
        }
    }
}

class AssignLabelsTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_assign_labels',
            description: 'Assign WhatsApp Business labels to one or more chats.',
            schema: AssignRemoveLabelsSchema,
            baseUrl: '',
            method: 'POST',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            const labelIds = arg.labelIds.split(',').map((id: string) => id.trim())
            const chatIds = arg.chatIds.split(',').map((id: string) => id.trim())
            return await this.makeRequest({
                endpoint: 'labels/assign',
                method: 'POST',
                body: { labelIds, chatIds },
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error assigning labels: ${error}`, arg)
        }
    }
}

class RemoveLabelsTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_remove_labels',
            description: 'Remove WhatsApp Business labels from one or more chats.',
            schema: AssignRemoveLabelsSchema,
            baseUrl: '',
            method: 'POST',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            const labelIds = arg.labelIds.split(',').map((id: string) => id.trim())
            const chatIds = arg.chatIds.split(',').map((id: string) => id.trim())
            return await this.makeRequest({
                endpoint: 'labels/remove',
                method: 'POST',
                body: { labelIds, chatIds },
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error removing labels: ${error}`, arg)
        }
    }
}

class SetChatLabelsTool extends BaseOctobotWappTool {
    constructor(args: any) {
        super({
            name: 'octobot_set_chat_labels',
            description: 'Replace all labels on a chat with the specified labels. Send empty labelIds to remove all labels.',
            schema: SetChatLabelsSchema,
            baseUrl: '',
            method: 'PUT',
            headers: {},
            ...args
        })
    }

    async _call(arg: any): Promise<string> {
        try {
            const labelIds = arg.labelIds
                ? arg.labelIds
                      .split(',')
                      .map((id: string) => id.trim())
                      .filter(Boolean)
                : []
            return await this.makeRequest({
                endpoint: `chat/${arg.phoneNumber}/labels`,
                method: 'PUT',
                body: { labelIds },
                params: arg
            })
        } catch (error) {
            return formatToolError(`Error setting chat labels: ${error}`, arg)
        }
    }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export const createOctobotWappTools = (args: {
    actions: string[]
    deviceUuid: string
    apiToken: string
    defaultRecipients?: string
}): DynamicStructuredTool[] => {
    const { actions = [], deviceUuid, apiToken, defaultRecipients } = args
    const tools: DynamicStructuredTool[] = []
    const commonArgs = { deviceUuid, apiToken, defaultRecipients }

    const toolClasses: Record<string, any> = {
        // Messaging
        sendText: SendTextTool,
        sendImage: SendImageTool,
        sendDocument: SendDocumentTool,
        sendAudio: SendAudioTool,
        sendVideo: SendVideoTool,
        sendLocation: SendLocationTool,
        sendContact: SendContactTool,
        checkNumber: CheckNumberTool,
        // Labels
        getLabels: GetLabelsTool,
        getLabelById: GetLabelByIdTool,
        getChatsByLabel: GetChatsByLabelTool,
        getChatLabels: GetChatLabelsTool,
        assignLabels: AssignLabelsTool,
        removeLabels: RemoveLabelsTool,
        setChatLabels: SetChatLabelsTool
    }

    actions.forEach((action) => {
        const ToolClass = toolClasses[action]
        if (ToolClass) {
            tools.push(new ToolClass(commonArgs))
        }
    })

    return tools
}
