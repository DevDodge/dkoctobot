import client from './client'

const getAllSupervisorLogs = (params = {}) => client.get('/supervisor-logs', { params })
const getSupervisorLogsByChatflow = (chatflowid) => client.get(`/supervisor-logs/${chatflowid}`)
const getSupervisorStats = (params = {}) => client.get('/supervisor-logs/stats', { params })

export default {
    getAllSupervisorLogs,
    getSupervisorLogsByChatflow,
    getSupervisorStats
}
