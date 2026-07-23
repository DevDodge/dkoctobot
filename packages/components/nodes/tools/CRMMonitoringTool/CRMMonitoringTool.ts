import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { INode, INodeData, INodeParams, ICommonObject } from '../../../src/Interface'
import { getBaseClasses, convertMultiOptionsToStringArray } from '../../../src/utils'
import { TOOL_ARGS_PREFIX, formatToolError } from '../../../src/agents'

// ── Retry helper ───────────────────────────────────────────────────────

async function fetchWithRetry(url: string, options: any, retries = 2, timeoutMs = 10000): Promise<Response> {
    let lastError: Error | null = null

    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), timeoutMs)
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            })
            clearTimeout(timeout)

            if (response.ok) return response
            if (response.status >= 400 && response.status < 500) return response
        } catch (e: any) {
            lastError = e
        }

        if (i < retries - 1) {
            await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
        }
    }

    throw lastError || new Error(`CRM request failed after ${retries} retries`)
}

// ── Monitoring Input Schema (data comes from the Agent's own LLM) ─────
// The Agent analyzes the conversation itself and passes structured data.
// This tool only forwards it to the CRM — no secondary LLM call inside.

const MonitoringInputSchema = z.object({
    note: z.string().describe('A concise professional note summarizing what happened in this customer message. Write in Arabic.'),
    keys: z
        .record(z.string(), z.string())
        .optional()
        .describe('Key-value pairs of dynamic business data extracted from this message (e.g. budget, product interest, location)'),
    sentiment: z
        .enum(['positive', 'neutral', 'negative', 'mixed'])
        .optional()
        .default('neutral')
        .describe("The customer's emotional tone in this message"),
    alert_level: z
        .enum(['none', 'warning', 'danger'])
        .optional()
        .default('none')
        .describe(
            "Alert level — use 'warning' for issues like customer frustration, objections, or complaints. Use 'danger' for cancellation intent or legal threats."
        ),
    alert_reason: z.string().optional().describe("If alert_level is 'warning' or 'danger', explain briefly why in Arabic")
})

class CRMMonitoringTool_Tools implements INode {
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
        this.label = 'CRM Monitoring Tool'
        this.name = 'crmMonitoringTool'
        this.version = 3.0
        this.type = 'CRMMonitoringTool'
        this.icon = 'crm-monitoring.svg'
        this.category = 'AppCity'
        this.description =
            'Forwards conversation analysis data to the CRM dashboard. The main Agent handles the analysis — this tool only sends the results to CRM.'
        this.baseClasses = [this.type, 'StructuredTool', 'Tool', ...getBaseClasses(StructuredTool)]
        this.inputs = [
            {
                label: 'CRM Base URL',
                name: 'crmBaseUrl',
                type: 'string',
                default: 'https://crm.octobot.it.com',
                description: 'The secure host address for your CRM backend'
            },
            {
                label: 'API Key',
                name: 'apiKey',
                type: 'password',
                description: 'The secure API integration key associated with this brand.'
            },
            {
                label: 'Variables',
                name: 'variables',
                type: 'multiOptions',
                options: [
                    {
                        label: 'Session ID',
                        name: 'sessionId',
                        description: 'Uses $flow.sessionId – vital for keeping analytics tied to chats.'
                    }
                ],
                optional: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, _options: ICommonObject): Promise<any> {
        const crmBaseUrl = ((nodeData.inputs?.crmBaseUrl as string) || 'https://crm.octobot.it.com').replace(/\/+$/, '')
        const apiKey = nodeData.inputs?.apiKey as string

        const selectedVars = convertMultiOptionsToStringArray(nodeData.inputs?.variables)
        const useFlowSessionId = selectedVars.includes('sessionId')
        const resolvedSessionId = useFlowSessionId ? (_options.sessionId as string) || (_options.chatId as string) || '' : ''

        if (!apiKey) {
            throw new Error('API Key is required. Generate one from the CRM Integration Keys page.')
        }

        return new CRMMonitoringToolImpl({
            crmBaseUrl,
            apiKey,
            resolvedSessionId
        })
    }
}

interface ToolConfig {
    crmBaseUrl: string
    apiKey: string
    resolvedSessionId: string
}

class CRMMonitoringToolImpl extends StructuredTool {
    name = 'crm_monitoring_note'
    description =
        'Send conversation insights to the CRM dashboard. Use after every user message to record: what happened (note), extracted business data (keys), customer sentiment, and any alerts. ⚠️ Call ONCE per turn only — do NOT call again for the same message. After calling this tool, write your customer response and stop.'

    schema = MonitoringInputSchema

    private crmBaseUrl: string
    private apiKey: string
    private resolvedSessionId: string

    // ── Deduplication: block duplicate calls within 3 seconds ────────────
    private lastCallHash: string = ''
    private lastCallTime: number = 0
    private static readonly DEDUP_WINDOW_MS = 3000

    constructor(config: ToolConfig) {
        super()
        this.crmBaseUrl = config.crmBaseUrl
        this.apiKey = config.apiKey
        this.resolvedSessionId = config.resolvedSessionId
    }

    // @ts-ignore
    async _call(
        arg: z.infer<typeof MonitoringInputSchema>,
        _runManager?: any,
        _config?: any,
        flowConfig?: {
            sessionId?: string
            chatId?: string
            input?: string
            state?: any
        }
    ): Promise<string> {
        try {
            // ── Deduplication guard ────────────────────────────────────────
            const callHash = `${arg.note?.slice(0, 80) || ''}|${arg.sentiment || ''}|${arg.alert_level || ''}`
            const now = Date.now()

            if (callHash === this.lastCallHash && now - this.lastCallTime < CRMMonitoringToolImpl.DEDUP_WINDOW_MS) {
                return (
                    'Monitoring skipped — duplicate call blocked (same note+sentiment+alert within ' +
                    CRMMonitoringToolImpl.DEDUP_WINDOW_MS / 1000 +
                    's). Do NOT call crm_monitoring_note again. Write your customer response now.'
                )
            }

            this.lastCallHash = callHash
            this.lastCallTime = now

            // ── Resolve session ID ──
            const effectiveSessionId = flowConfig?.sessionId || flowConfig?.chatId || this.resolvedSessionId || ''

            // ── Auto-build keyDefinitions from the keys the LLM provided ──
            // CRM backend requires key_definitions to exist before storing values.
            // We auto-create them here so the LLM doesn't have to manage them.
            const keys = arg.keys || {}
            const keyDefinitions = Object.keys(keys)
                .filter((k) => keys[k] !== null && keys[k] !== undefined && keys[k] !== '')
                .map((k) => ({
                    key: k,
                    display: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
                    type: 'text'
                }))

            // ── Build payload from the Agent's analysis ──
            const payload = {
                sessionId: effectiveSessionId,
                note: arg.note,
                keys,
                sentiment: arg.sentiment || 'neutral',
                alertLevel: arg.alert_level || 'none',
                alertReason: arg.alert_reason || '',
                keyDefinitions // auto-generated from keys — ensures CRM stores them
            }

            // ── Send to CRM with retry ──
            const res = await fetchWithRetry(`${this.crmBaseUrl}/api/integration/monitoring/note`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.apiKey
                },
                body: JSON.stringify(payload)
            })

            const result = (await res.json()) as any

            if (!res.ok) {
                return formatToolError(`Monitoring failed (${res.status}): ${result.message || 'Unknown error'}`, payload)
            }

            return (
                `Monitoring recorded — sentiment: ${arg.sentiment || 'neutral'}, alert: ${arg.alert_level || 'none'}` +
                TOOL_ARGS_PREFIX +
                JSON.stringify(payload)
            )
        } catch (error: any) {
            return formatToolError(`Monitoring tool system error: ${error.message}`, {})
        }
    }
}

module.exports = { nodeClass: CRMMonitoringTool_Tools }
