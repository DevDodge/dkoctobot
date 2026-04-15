import { removeFilesFromStorage } from 'flowise-components'
import { StatusCodes } from 'http-status-codes'
import { DeleteResult, FindOptionsWhere, In } from 'typeorm'
import { ChatMessage } from '../../database/entities/ChatMessage'
import { ChatMessageFeedback } from '../../database/entities/ChatMessageFeedback'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { ChatMessageRatingType, ChatType, IChatMessage, MODE } from '../../Interface'
import { UsageCacheManager } from '../../UsageCacheManager'
import { utilAddChatMessage } from '../../utils/addChatMesage'
import { utilGetChatMessage } from '../../utils/getChatMessage'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { updateStorageUsage } from '../../utils/quotaUsage'

// Add chatmessages for chatflowid
const createChatMessage = async (chatMessage: Partial<IChatMessage>) => {
    try {
        const dbResponse = await utilAddChatMessage(chatMessage)
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatMessagesService.createChatMessage - ${getErrorMessage(error)}`
        )
    }
}

// Get all chatmessages from chatflowid
const getAllChatMessages = async (
    chatflowId: string,
    chatTypes: ChatType[] | undefined,
    sortOrder: string = 'ASC',
    chatId?: string,
    memoryType?: string,
    sessionId?: string,
    startDate?: string,
    endDate?: string,
    messageId?: string,
    feedback?: boolean,
    feedbackTypes?: ChatMessageRatingType[],
    activeWorkspaceId?: string,
    page?: number,
    pageSize?: number
): Promise<ChatMessage[]> => {
    try {
        const dbResponse = await utilGetChatMessage({
            chatflowid: chatflowId,
            chatTypes,
            sortOrder,
            chatId,
            memoryType,
            sessionId,
            startDate,
            endDate,
            messageId,
            feedback,
            feedbackTypes,
            activeWorkspaceId,
            page,
            pageSize
        })
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatMessagesService.getAllChatMessages - ${getErrorMessage(error)}`
        )
    }
}

// Get internal chatmessages from chatflowid
const getAllInternalChatMessages = async (
    chatflowId: string,
    chatTypes: ChatType[] | undefined,
    sortOrder: string = 'ASC',
    chatId?: string,
    memoryType?: string,
    sessionId?: string,
    startDate?: string,
    endDate?: string,
    messageId?: string,
    feedback?: boolean,
    feedbackTypes?: ChatMessageRatingType[],
    activeWorkspaceId?: string
): Promise<ChatMessage[]> => {
    try {
        const dbResponse = await utilGetChatMessage({
            chatflowid: chatflowId,
            chatTypes,
            sortOrder,
            chatId,
            memoryType,
            sessionId,
            startDate,
            endDate,
            messageId,
            feedback,
            feedbackTypes,
            activeWorkspaceId
        })
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatMessagesService.getAllInternalChatMessages - ${getErrorMessage(error)}`
        )
    }
}

const removeAllChatMessages = async (
    chatId: string,
    chatflowid: string,
    deleteOptions: FindOptionsWhere<ChatMessage>,
    orgId: string,
    workspaceId: string,
    usageCacheManager: UsageCacheManager
): Promise<DeleteResult> => {
    try {
        const appServer = getRunningExpressApp()

        // Remove all related feedback records
        const feedbackDeleteOptions: FindOptionsWhere<ChatMessageFeedback> = { chatId }
        await appServer.AppDataSource.getRepository(ChatMessageFeedback).delete(feedbackDeleteOptions)

        // Delete all uploads corresponding to this chatflow/chatId
        if (chatId) {
            try {
                const { totalSize } = await removeFilesFromStorage(orgId, chatflowid, chatId)
                await updateStorageUsage(orgId, workspaceId, totalSize, usageCacheManager)
            } catch (e) {
                // Don't throw error if file deletion fails because file might not exist
            }
        }
        const dbResponse = await appServer.AppDataSource.getRepository(ChatMessage).delete(deleteOptions)
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatMessagesService.removeAllChatMessages - ${getErrorMessage(error)}`
        )
    }
}

const removeChatMessagesByMessageIds = async (
    chatflowid: string,
    chatIdMap: Map<string, ChatMessage[]>,
    messageIds: string[],
    orgId: string,
    workspaceId: string,
    usageCacheManager: UsageCacheManager
): Promise<DeleteResult> => {
    try {
        const appServer = getRunningExpressApp()

        // Get messages before deletion to check for executionId
        const messages = await appServer.AppDataSource.getRepository(ChatMessage).findByIds(messageIds)
        const executionIds = messages.map((msg) => msg.executionId).filter(Boolean)

        for (const [composite_key] of chatIdMap) {
            const [chatId] = composite_key.split('_')

            // Remove all related feedback records
            const feedbackDeleteOptions: FindOptionsWhere<ChatMessageFeedback> = { chatId }
            await appServer.AppDataSource.getRepository(ChatMessageFeedback).delete(feedbackDeleteOptions)

            // Delete all uploads corresponding to this chatflow/chatId
            try {
                const { totalSize } = await removeFilesFromStorage(orgId, chatflowid, chatId)
                await updateStorageUsage(orgId, workspaceId, totalSize, usageCacheManager)
            } catch (e) {
                // Don't throw error if file deletion fails because file might not exist
            }
        }

        // Delete executions if they exist
        if (executionIds.length > 0) {
            await appServer.AppDataSource.getRepository('Execution').delete(executionIds)
        }

        const dbResponse = await appServer.AppDataSource.getRepository(ChatMessage).delete(messageIds)
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatMessagesService.removeChatMessagesByMessageIds - ${getErrorMessage(error)}`
        )
    }
}

const abortChatMessage = async (chatId: string, chatflowid: string) => {
    try {
        const appServer = getRunningExpressApp()
        const id = `${chatflowid}_${chatId}`

        if (process.env.MODE === MODE.QUEUE) {
            await appServer.queueManager.getPredictionQueueEventsProducer().publishEvent({
                eventName: 'abort',
                id
            })
        } else {
            appServer.abortControllerPool.abort(id)
        }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatMessagesService.abortChatMessage - ${getErrorMessage(error)}`
        )
    }
}

async function getMessagesByChatflowIds(chatflowIds: string[]): Promise<ChatMessage[]> {
    const appServer = getRunningExpressApp()
    return await appServer.AppDataSource.getRepository(ChatMessage).find({ where: { chatflowid: In(chatflowIds) } })
}

async function getMessagesFeedbackByChatflowIds(chatflowIds: string[]): Promise<ChatMessageFeedback[]> {
    const appServer = getRunningExpressApp()
    return await appServer.AppDataSource.getRepository(ChatMessageFeedback).find({ where: { chatflowid: In(chatflowIds) } })
}

// Batch delete: fetches N message IDs, deletes them + feedback + files, returns count + hasMore
const removeMessagesBatch = async (
    chatflowid: string,
    batchSize: number,
    deleteOptions: FindOptionsWhere<ChatMessage>,
    orgId: string,
    workspaceId: string,
    usageCacheManager: UsageCacheManager
): Promise<{ deleted: number; hasMore: boolean }> => {
    try {
        const appServer = getRunningExpressApp()
        const repo = appServer.AppDataSource.getRepository(ChatMessage)

        // Fetch a batch of message IDs matching the criteria
        const messages = await repo.find({
            where: deleteOptions,
            select: ['id', 'chatId'],
            take: batchSize,
            order: { createdDate: 'ASC' }
        })

        if (messages.length === 0) {
            return { deleted: 0, hasMore: false }
        }

        const messageIds = messages.map((m) => m.id)

        // Get unique chatIds for feedback + file cleanup
        const uniqueChatIds = [...new Set(messages.map((m) => m.chatId))]

        // Delete feedback for these chatIds
        for (const chatId of uniqueChatIds) {
            try {
                await appServer.AppDataSource.getRepository(ChatMessageFeedback).delete({ chatId })
            } catch (e) {
                // Don't fail if feedback delete fails
            }
        }

        // Delete uploaded files for these chatIds
        for (const chatId of uniqueChatIds) {
            try {
                const { totalSize } = await removeFilesFromStorage(orgId, chatflowid, chatId)
                await updateStorageUsage(orgId, workspaceId, totalSize, usageCacheManager)
            } catch (e) {
                // Don't fail if file cleanup fails
            }
        }

        // Delete the messages
        await repo.delete(messageIds)

        // Check if more messages remain
        const remainingCount = await repo.count({ where: deleteOptions })

        return {
            deleted: messages.length,
            hasMore: remainingCount > 0
        }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatMessagesService.removeMessagesBatch - ${getErrorMessage(error)}`
        )
    }
}

export default {
    createChatMessage,
    getAllChatMessages,
    getAllInternalChatMessages,
    removeAllChatMessages,
    removeChatMessagesByMessageIds,
    abortChatMessage,
    getMessagesByChatflowIds,
    getMessagesFeedbackByChatflowIds,
    removeMessagesBatch
}
