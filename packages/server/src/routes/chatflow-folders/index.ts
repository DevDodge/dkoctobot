import express from 'express'
import chatflowFoldersController from '../../controllers/chatflow-folders'
import { checkAnyPermission } from '../../enterprise/rbac/PermissionCheck'

const router = express.Router()

// READ
router.get('/', checkAnyPermission('chatflows:view,chatflows:update'), chatflowFoldersController.getAllFolders)
router.get('/:id', checkAnyPermission('chatflows:view,chatflows:update'), chatflowFoldersController.getFolderById)

// CREATE
router.post('/', checkAnyPermission('chatflows:create,chatflows:update'), chatflowFoldersController.createFolder)

// UPDATE
router.put('/:id', checkAnyPermission('chatflows:update'), chatflowFoldersController.updateFolder)

// DELETE
router.delete('/:id', checkAnyPermission('chatflows:delete'), chatflowFoldersController.deleteFolder)

// MOVE CHATFLOW TO FOLDER
router.put('/move/:chatflowId', checkAnyPermission('chatflows:update'), chatflowFoldersController.moveChatflowToFolder)

export default router
