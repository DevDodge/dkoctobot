import client from './client'

const exportData = (body) => client.post('/export-import/export', body)
const importData = (body) => client.post('/export-import/import', body)

// Count messages before export (for progress bar)
const countChatflowMessages = (body) => client.post('/export-import/chatflow-messages/count', body)

// Fetch one batch of processed messages (client calls this repeatedly)
const exportChatflowMessagesBatch = (body) => client.post('/export-import/chatflow-messages/batch', body)

export default {
    exportData,
    importData,
    countChatflowMessages,
    exportChatflowMessagesBatch
}
