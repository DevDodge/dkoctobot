import { Request, Response, NextFunction } from 'express'
import supervisorLogService from '../../services/supervisor-logs'
import { StatusCodes } from 'http-status-codes'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'

const getAllSupervisorLogs = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const chatflowid = req.query?.chatflowid as string | undefined
        const sortOrder = req.query?.order as string | undefined
        const startDate = req.query?.startDate as string | undefined
        const endDate = req.query?.endDate as string | undefined
        const limit = req.query?.limit ? parseInt(req.query.limit as string) : 100
        const offset = req.query?.offset ? parseInt(req.query.offset as string) : 0

        const apiResponse = await supervisorLogService.getAllSupervisorLogs(
            chatflowid,
            sortOrder || 'DESC',
            startDate,
            endDate,
            limit,
            offset
        )
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const getSupervisorLogsByChatflow = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.params.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                'Error: supervisorLogController.getSupervisorLogsByChatflow - chatflowid not provided!'
            )
        }
        const apiResponse = await supervisorLogService.getSupervisorLogsByChatflow(req.params.id)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const createSupervisorLog = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.body) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                'Error: supervisorLogController.createSupervisorLog - body not provided!'
            )
        }
        const apiResponse = await supervisorLogService.createSupervisorLog(req.body)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const getSupervisorStats = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const chatflowid = req.query?.chatflowid as string | undefined
        const apiResponse = await supervisorLogService.getSupervisorStats(chatflowid)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

export default {
    getAllSupervisorLogs,
    getSupervisorLogsByChatflow,
    createSupervisorLog,
    getSupervisorStats
}
