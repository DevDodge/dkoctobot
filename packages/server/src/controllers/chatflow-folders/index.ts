import { NextFunction, Request, Response } from 'express'
import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import chatflowFoldersService from '../../services/chatflow-folders'

// Get all folders
const getAllFolders = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: chatflowFoldersController.getAllFolders - workspace not found!`
            )
        }
        const apiResponse = await chatflowFoldersService.getAllFolders(workspaceId)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

// Get folder by ID
const getFolderById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (typeof req.params === 'undefined' || !req.params.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: chatflowFoldersController.getFolderById - id not provided!`
            )
        }
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: chatflowFoldersController.getFolderById - workspace not found!`
            )
        }
        const apiResponse = await chatflowFoldersService.getFolderById(req.params.id, workspaceId)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

// Create folder
const createFolder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.body || !req.body.name) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: chatflowFoldersController.createFolder - name not provided!`
            )
        }
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: chatflowFoldersController.createFolder - workspace not found!`
            )
        }
        const apiResponse = await chatflowFoldersService.createFolder(req.body.name, workspaceId)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

// Update folder
const updateFolder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (typeof req.params === 'undefined' || !req.params.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: chatflowFoldersController.updateFolder - id not provided!`
            )
        }
        if (!req.body || !req.body.name) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: chatflowFoldersController.updateFolder - name not provided!`
            )
        }
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: chatflowFoldersController.updateFolder - workspace not found!`
            )
        }
        const apiResponse = await chatflowFoldersService.updateFolder(req.params.id, req.body.name, workspaceId)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

// Delete folder
const deleteFolder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (typeof req.params === 'undefined' || !req.params.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: chatflowFoldersController.deleteFolder - id not provided!`
            )
        }
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: chatflowFoldersController.deleteFolder - workspace not found!`
            )
        }
        const apiResponse = await chatflowFoldersService.deleteFolder(req.params.id, workspaceId)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

// Move chatflow to folder
const moveChatflowToFolder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (typeof req.params === 'undefined' || !req.params.chatflowId) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: chatflowFoldersController.moveChatflowToFolder - chatflowId not provided!`
            )
        }
        const workspaceId = req.user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: chatflowFoldersController.moveChatflowToFolder - workspace not found!`
            )
        }
        // folderId can be null to move to uncategorized
        const folderId = req.body?.folderId || null
        const apiResponse = await chatflowFoldersService.moveChatflowToFolder(req.params.chatflowId, folderId, workspaceId)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

export default {
    getAllFolders,
    getFolderById,
    createFolder,
    updateFolder,
    deleteFolder,
    moveChatflowToFolder
}
