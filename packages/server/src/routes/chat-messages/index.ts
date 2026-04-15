import express from 'express'
import chatMessageController from '../../controllers/chat-messages'
const router = express.Router()

// CREATE
// NOTE: Unused route
// router.post(['/', '/:id'], chatMessageController.createChatMessage)

// READ
router.get(['/', '/:id'], chatMessageController.getAllChatMessages)

// UPDATE
router.put(['/abort/', '/abort/:chatflowid/:chatid'], chatMessageController.abortChatMessage)

// DELETE
router.delete(['/', '/:id'], chatMessageController.removeAllChatMessages)

// DELETE BATCH (for large datasets - deletes N messages at a time)
router.delete('/:id/batch', chatMessageController.removeMessagesBatch)

export default router
