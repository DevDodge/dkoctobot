import { StatusCodes } from 'http-status-codes'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { SupervisorLog } from '../../database/entities/SupervisorLog'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'

// Get all supervisor logs with optional filters
const getAllSupervisorLogs = async (
    chatflowid?: string,
    sortOrder: string = 'DESC',
    startDate?: string,
    endDate?: string,
    limit: number = 100,
    offset: number = 0
) => {
    try {
        const appServer = getRunningExpressApp()
        const queryBuilder = appServer.AppDataSource.getRepository(SupervisorLog).createQueryBuilder('log')

        if (chatflowid) {
            queryBuilder.where('log.chatflowid = :chatflowid', { chatflowid })
        }

        if (startDate) {
            queryBuilder.andWhere('log.createdDate >= :startDate', { startDate: new Date(startDate) })
        }

        if (endDate) {
            queryBuilder.andWhere('log.createdDate <= :endDate', { endDate: new Date(endDate) })
        }

        queryBuilder.orderBy('log.createdDate', sortOrder === 'ASC' ? 'ASC' : 'DESC')
        queryBuilder.skip(offset)
        queryBuilder.take(limit)

        const [logs, total] = await queryBuilder.getManyAndCount()
        return { logs, total }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: supervisorLogService.getAllSupervisorLogs - ${getErrorMessage(error)}`
        )
    }
}

// Get supervisor logs by chatflow id
const getSupervisorLogsByChatflow = async (chatflowid: string) => {
    try {
        const appServer = getRunningExpressApp()
        const logs = await appServer.AppDataSource.getRepository(SupervisorLog).find({
            where: { chatflowid },
            order: { createdDate: 'DESC' }
        })
        return logs
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: supervisorLogService.getSupervisorLogsByChatflow - ${getErrorMessage(error)}`
        )
    }
}

// Create a new supervisor log
const createSupervisorLog = async (body: Partial<SupervisorLog>) => {
    try {
        const appServer = getRunningExpressApp()
        const newLog = appServer.AppDataSource.getRepository(SupervisorLog).create(body)
        const savedLog = await appServer.AppDataSource.getRepository(SupervisorLog).save(newLog)
        return savedLog
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: supervisorLogService.createSupervisorLog - ${getErrorMessage(error)}`
        )
    }
}

// Get stats (violation counts, most common violations, etc.)
const getSupervisorStats = async (chatflowid?: string) => {
    try {
        const appServer = getRunningExpressApp()
        const queryBuilder = appServer.AppDataSource.getRepository(SupervisorLog).createQueryBuilder('log')

        if (chatflowid) {
            queryBuilder.where('log.chatflowid = :chatflowid', { chatflowid })
        }

        const totalViolations = await queryBuilder.getCount()

        const approvedQuery = appServer.AppDataSource.getRepository(SupervisorLog)
            .createQueryBuilder('log')
            .where('log.approved = :approved', { approved: true })
        if (chatflowid) {
            approvedQuery.andWhere('log.chatflowid = :chatflowid', { chatflowid })
        }
        const totalCorrected = await approvedQuery.getCount()

        const failedQuery = appServer.AppDataSource.getRepository(SupervisorLog)
            .createQueryBuilder('log')
            .where('log.approved = :approved', { approved: false })
        if (chatflowid) {
            failedQuery.andWhere('log.chatflowid = :chatflowid', { chatflowid })
        }
        const totalFailed = await failedQuery.getCount()

        return {
            totalViolations,
            totalCorrected,
            totalFailed,
            correctionRate: totalViolations > 0 ? Math.round((totalCorrected / totalViolations) * 100) : 0
        }
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: supervisorLogService.getSupervisorStats - ${getErrorMessage(error)}`
        )
    }
}

export default {
    getAllSupervisorLogs,
    getSupervisorLogsByChatflow,
    createSupervisorLog,
    getSupervisorStats
}
