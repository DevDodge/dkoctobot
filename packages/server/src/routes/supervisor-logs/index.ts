import express from 'express'
import supervisorLogController from '../../controllers/supervisor-logs'
const router = express.Router()

// GET all logs (with query params for filtering)
router.get('/', supervisorLogController.getAllSupervisorLogs)

// GET stats
router.get('/stats', supervisorLogController.getSupervisorStats)

// GET logs by chatflow id
router.get('/:id', supervisorLogController.getSupervisorLogsByChatflow)

// CREATE a new log
router.post('/', supervisorLogController.createSupervisorLog)

export default router
