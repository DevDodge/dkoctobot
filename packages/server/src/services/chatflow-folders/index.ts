import { StatusCodes } from 'http-status-codes'
import { ChatflowFolder } from '../../database/entities/ChatflowFolder'
import { ChatFlow } from '../../database/entities/ChatFlow'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'

// Get all folders
const getAllFolders = async (workspaceId: string): Promise<ChatflowFolder[]> => {
    try {
        const appServer = getRunningExpressApp()
        const dbResponse = await appServer.AppDataSource.getRepository(ChatflowFolder).find({
            where: { workspaceId },
            order: { name: 'ASC' }
        })
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowFoldersService.getAllFolders - ${getErrorMessage(error)}`
        )
    }
}

// Get folder by ID
const getFolderById = async (folderId: string, workspaceId: string): Promise<ChatflowFolder> => {
    try {
        const appServer = getRunningExpressApp()
        const dbResponse = await appServer.AppDataSource.getRepository(ChatflowFolder).findOne({
            where: { id: folderId, workspaceId }
        })
        if (!dbResponse) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Folder ${folderId} not found`)
        }
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowFoldersService.getFolderById - ${getErrorMessage(error)}`
        )
    }
}

// Create a new folder
const createFolder = async (name: string, workspaceId: string): Promise<ChatflowFolder> => {
    try {
        const appServer = getRunningExpressApp()

        // Check if folder with same name already exists
        const existingFolder = await appServer.AppDataSource.getRepository(ChatflowFolder).findOne({
            where: { name, workspaceId }
        })
        if (existingFolder) {
            throw new InternalFlowiseError(StatusCodes.CONFLICT, `Folder with name "${name}" already exists`)
        }

        const newFolder = new ChatflowFolder()
        newFolder.name = name
        newFolder.workspaceId = workspaceId

        const folder = appServer.AppDataSource.getRepository(ChatflowFolder).create(newFolder)
        const dbResponse = await appServer.AppDataSource.getRepository(ChatflowFolder).save(folder)
        return dbResponse
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowFoldersService.createFolder - ${getErrorMessage(error)}`
        )
    }
}

// Update folder name
const updateFolder = async (folderId: string, name: string, workspaceId: string): Promise<ChatflowFolder> => {
    try {
        const appServer = getRunningExpressApp()

        // Check if folder exists
        const folder = await appServer.AppDataSource.getRepository(ChatflowFolder).findOne({
            where: { id: folderId, workspaceId }
        })
        if (!folder) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Folder ${folderId} not found`)
        }

        // Check if another folder with same name already exists
        const existingFolder = await appServer.AppDataSource.getRepository(ChatflowFolder).findOne({
            where: { name, workspaceId }
        })
        if (existingFolder && existingFolder.id !== folderId) {
            throw new InternalFlowiseError(StatusCodes.CONFLICT, `Folder with name "${name}" already exists`)
        }

        folder.name = name
        const dbResponse = await appServer.AppDataSource.getRepository(ChatflowFolder).save(folder)
        return dbResponse
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowFoldersService.updateFolder - ${getErrorMessage(error)}`
        )
    }
}

// Delete folder - moves chatflows to uncategorized (null folderId)
const deleteFolder = async (folderId: string, workspaceId: string): Promise<any> => {
    try {
        const appServer = getRunningExpressApp()

        // Check if folder exists
        const folder = await appServer.AppDataSource.getRepository(ChatflowFolder).findOne({
            where: { id: folderId, workspaceId }
        })
        if (!folder) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Folder ${folderId} not found`)
        }

        // Move all chatflows in this folder to uncategorized (null folderId)
        await appServer.AppDataSource.getRepository(ChatFlow)
            .createQueryBuilder()
            .update(ChatFlow)
            .set({ folderId: undefined })
            .where('folderId = :folderId', { folderId })
            .andWhere('workspaceId = :workspaceId', { workspaceId })
            .execute()

        // Delete the folder
        const dbResponse = await appServer.AppDataSource.getRepository(ChatflowFolder).delete({ id: folderId })
        return dbResponse
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowFoldersService.deleteFolder - ${getErrorMessage(error)}`
        )
    }
}

// Move chatflow to folder
const moveChatflowToFolder = async (chatflowId: string, folderId: string | null, workspaceId: string): Promise<ChatFlow> => {
    try {
        const appServer = getRunningExpressApp()

        // Check if chatflow exists
        const chatflow = await appServer.AppDataSource.getRepository(ChatFlow).findOne({
            where: { id: chatflowId, workspaceId }
        })
        if (!chatflow) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Chatflow ${chatflowId} not found`)
        }

        // If folderId is provided, check if folder exists
        if (folderId) {
            const folder = await appServer.AppDataSource.getRepository(ChatflowFolder).findOne({
                where: { id: folderId, workspaceId }
            })
            if (!folder) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Folder ${folderId} not found`)
            }
        }

        chatflow.folderId = folderId || undefined
        const dbResponse = await appServer.AppDataSource.getRepository(ChatFlow).save(chatflow)
        return dbResponse
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: chatflowFoldersService.moveChatflowToFolder - ${getErrorMessage(error)}`
        )
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
