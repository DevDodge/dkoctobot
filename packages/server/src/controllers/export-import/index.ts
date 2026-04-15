import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import exportImportService from '../../services/export-import'

const exportData = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: exportImportController.exportData - workspace ${workspaceId} not found!`
            )
        }
        const apiResponse = await exportImportService.exportData(exportImportService.convertExportInput(req.body), workspaceId)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const importData = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const orgId = req.user?.activeOrganizationId
        if (!orgId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: exportImportController.importData - organization ${orgId} not found!`
            )
        }
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: exportImportController.importData - workspace ${workspaceId} not found!`
            )
        }
        const subscriptionId = req.user?.activeOrganizationSubscriptionId || ''

        const importData = req.body
        if (!importData) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Error: exportImportController.importData - importData is required!')
        }

        await exportImportService.importData(importData, orgId, workspaceId, subscriptionId)
        return res.status(StatusCodes.OK).json({ message: 'success' })
    } catch (error) {
        next(error)
    }
}

// Count chatflow messages (for progress tracking in UI)
const countChatflowMessages = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: exportImportController.countChatflowMessages - workspace ${workspaceId} not found!`
            )
        }

        const { chatflowId, chatType, feedbackType, startDate, endDate } = req.body
        if (!chatflowId) {
            throw new InternalFlowiseError(
                StatusCodes.BAD_REQUEST,
                'Error: exportImportController.countChatflowMessages - chatflowId is required!'
            )
        }

        const count = await exportImportService.countChatflowMessages(chatflowId, chatType, feedbackType, startDate, endDate, workspaceId)

        return res.json({ count })
    } catch (error) {
        next(error)
    }
}

// Batch export: returns one page of processed messages
const exportChatflowMessagesBatch = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: exportImportController.exportChatflowMessagesBatch - workspace ${workspaceId} not found!`
            )
        }

        const { chatflowId, chatType, feedbackType, startDate, endDate, page = 1, batchSize = 1000 } = req.body
        if (!chatflowId) {
            throw new InternalFlowiseError(
                StatusCodes.BAD_REQUEST,
                'Error: exportImportController.exportChatflowMessagesBatch - chatflowId is required!'
            )
        }

        const apiResponse = await exportImportService.exportChatflowMessagesBatch(
            chatflowId,
            page,
            batchSize,
            chatType,
            feedbackType,
            startDate,
            endDate,
            workspaceId
        )

        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

// Streaming export of chatflow messages (handles large datasets without OOM)
const exportChatflowMessages = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: exportImportController.exportChatflowMessages - workspace ${workspaceId} not found!`
            )
        }

        const { chatflowId, chatType, feedbackType, startDate, endDate } = req.body
        if (!chatflowId) {
            throw new InternalFlowiseError(
                StatusCodes.BAD_REQUEST,
                'Error: exportImportController.exportChatflowMessages - chatflowId is required!'
            )
        }

        // Use streaming export to handle large datasets
        await exportImportService.exportChatflowMessagesStream(res, chatflowId, chatType, feedbackType, startDate, endDate, workspaceId)
    } catch (error) {
        next(error)
    }
}

export default {
    exportData,
    importData,
    exportChatflowMessages,
    countChatflowMessages,
    exportChatflowMessagesBatch
}
