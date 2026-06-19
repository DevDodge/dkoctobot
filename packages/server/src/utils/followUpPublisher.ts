import Redis from 'ioredis'
import logger from './logger'

/**
 * Publishes lightweight message events to the dedicated follow-up service's
 * Redis Stream. The follow-up microservice consumes these and owns all timer
 * scheduling, webhook sending, and logging — so the main app never touches
 * Postgres or BullMQ for follow-ups.
 *
 * Connection targets the follow-up Redis (FOLLOWUP_REDIS_*), falling back to
 * the main Redis env if not separately configured.
 */

const STREAM = process.env.FOLLOWUP_EVENTS_STREAM || 'followup:events'
const STREAM_MAXLEN = parseInt(process.env.FOLLOWUP_EVENTS_MAXLEN || '1000000', 10)

let client: Redis | null = null
let disabled = false

function getClient(): Redis | null {
    if (disabled) return null
    if (client) return client
    try {
        const url = process.env.FOLLOWUP_REDIS_URL || process.env.REDIS_URL
        if (url) {
            client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false })
        } else {
            client = new Redis({
                host: process.env.FOLLOWUP_REDIS_HOST || process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.FOLLOWUP_REDIS_PORT || process.env.REDIS_PORT || '6379', 10),
                username: process.env.FOLLOWUP_REDIS_USERNAME || process.env.REDIS_USERNAME || undefined,
                password: process.env.FOLLOWUP_REDIS_PASSWORD || process.env.REDIS_PASSWORD || undefined,
                maxRetriesPerRequest: null
            })
        }
        client.on('error', (err) => logger.debug(`[FollowUpPublisher] Redis error: ${err.message}`))
    } catch (e) {
        logger.warn(`[FollowUpPublisher] Could not create Redis client: ${e}`)
        disabled = true
        return null
    }
    return client
}

export interface FollowUpMessageEvent {
    chatflowId: string
    chatId: string
    sessionId?: string
    role: string // 'userMessage' | 'apiMessage'
    content: string
}

/** Fire-and-forget publish. Never throws into the request path. */
export async function publishFollowUpEvent(ev: FollowUpMessageEvent): Promise<void> {
    const c = getClient()
    if (!c) return
    try {
        await c.xadd(
            STREAM,
            'MAXLEN',
            '~',
            STREAM_MAXLEN.toString(),
            '*',
            'chatflowId',
            ev.chatflowId,
            'chatId',
            ev.chatId || '',
            'sessionId',
            ev.sessionId || '',
            'role',
            ev.role || 'userMessage',
            'content',
            ev.content || '',
            'ts',
            Date.now().toString()
        )
    } catch (e) {
        logger.debug(`[FollowUpPublisher] publish failed: ${e}`)
    }
}
