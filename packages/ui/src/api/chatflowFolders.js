import client from './client'

const getAllFolders = () => client.get('/chatflow-folders')

const getFolderById = (id) => client.get(`/chatflow-folders/${id}`)

const createFolder = (body) => client.post('/chatflow-folders', body)

const updateFolder = (id, body) => client.put(`/chatflow-folders/${id}`, body)

const deleteFolder = (id) => client.delete(`/chatflow-folders/${id}`)

const moveChatflowToFolder = (chatflowId, folderId) => client.put(`/chatflow-folders/move/${chatflowId}`, { folderId })

export default {
    getAllFolders,
    getFolderById,
    createFolder,
    updateFolder,
    deleteFolder,
    moveChatflowToFolder
}
