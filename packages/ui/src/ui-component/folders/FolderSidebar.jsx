import { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import PropTypes from 'prop-types'
import { useTheme } from '@mui/material/styles'
import {
    Box,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    IconButton,
    Menu,
    MenuItem,
    Typography,
    Divider,
    Tooltip,
    Chip
} from '@mui/material'
import { IconFolder, IconFolderPlus, IconFolders, IconInbox, IconDotsVertical, IconTrash, IconPencil } from '@tabler/icons-react'

import chatflowFoldersApi from '@/api/chatflowFolders'
import chatflowsApi from '@/api/chatflows'
import useApi from '@/hooks/useApi'
import FolderDialog from '@/ui-component/dialog/FolderDialog'
import ConfirmDialog from '@/ui-component/dialog/ConfirmDialog'
import useConfirm from '@/hooks/useConfirm'

const FolderSidebar = ({ selectedFolder, onFolderSelect, onFoldersChange, onChatflowMoved, refreshSignal }) => {
    const theme = useTheme()
    const customization = useSelector((state) => state.customization)
    const { confirm } = useConfirm()

    const [folders, setFolders] = useState([])
    const [folderCounts, setFolderCounts] = useState({})
    const [contextMenu, setContextMenu] = useState(null)
    const [selectedContextFolder, setSelectedContextFolder] = useState(null)
    const [dragOverFolder, setDragOverFolder] = useState(null)

    // Dialog states
    const [showFolderDialog, setShowFolderDialog] = useState(false)
    const [folderDialogProps, setFolderDialogProps] = useState({})
    const [editingFolder, setEditingFolder] = useState(null)

    const getAllFoldersApi = useApi(chatflowFoldersApi.getAllFolders)

    // Load folders on mount
    useEffect(() => {
        getAllFoldersApi.request()
        loadFolderCounts()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Update folders when API returns data
    useEffect(() => {
        if (getAllFoldersApi.data) {
            setFolders(getAllFoldersApi.data)
            if (onFoldersChange) onFoldersChange(getAllFoldersApi.data)
        }
    }, [getAllFoldersApi.data, onFoldersChange])

    useEffect(() => {
        loadFolderCounts()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshSignal])

    // Load count of chatflows in each folder
    const loadFolderCounts = async () => {
        try {
            // Get all chatflows and count by folder
            const response = await chatflowsApi.getAllChatflows()
            const chatflows = response.data?.data || response.data || []

            const counts = { all: chatflows.length, uncategorized: 0 }
            chatflows.forEach((cf) => {
                if (!cf.folderId) {
                    counts.uncategorized++
                } else {
                    counts[cf.folderId] = (counts[cf.folderId] || 0) + 1
                }
            })
            setFolderCounts(counts)
        } catch (error) {
            console.error('Error loading folder counts:', error)
        }
    }

    // Refresh counts when chatflow is moved
    useEffect(() => {
        if (onChatflowMoved) {
            // Create a wrapped callback that also refreshes counts
            loadFolderCounts()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFolder])

    // Handle context menu
    const handleContextMenu = (event, folder) => {
        event.preventDefault()
        event.stopPropagation()
        setContextMenu({ mouseX: event.clientX, mouseY: event.clientY })
        setSelectedContextFolder(folder)
    }

    const handleCloseContextMenu = () => {
        setContextMenu(null)
        setSelectedContextFolder(null)
    }

    // Create folder
    const handleCreateFolder = () => {
        setEditingFolder(null)
        setFolderDialogProps({
            title: 'Create Folder',
            confirmButtonName: 'Create',
            cancelButtonName: 'Cancel'
        })
        setShowFolderDialog(true)
    }

    // Rename folder
    const handleRenameFolder = () => {
        if (selectedContextFolder) {
            setEditingFolder(selectedContextFolder)
            setFolderDialogProps({
                title: 'Rename Folder',
                confirmButtonName: 'Save',
                cancelButtonName: 'Cancel',
                folderName: selectedContextFolder.name
            })
            setShowFolderDialog(true)
        }
        handleCloseContextMenu()
    }

    // Delete folder
    const handleDeleteFolder = async () => {
        if (selectedContextFolder) {
            const confirmPayload = {
                title: 'Delete Folder',
                description: `Are you sure you want to delete "${selectedContextFolder.name}"? Chatflows in this folder will be moved to Uncategorized.`,
                confirmButtonName: 'Delete',
                cancelButtonName: 'Cancel'
            }
            const isConfirmed = await confirm(confirmPayload)
            if (isConfirmed) {
                try {
                    await chatflowFoldersApi.deleteFolder(selectedContextFolder.id)
                    getAllFoldersApi.request()
                    loadFolderCounts()
                    if (selectedFolder === selectedContextFolder.id) {
                        onFolderSelect(null) // Reset to "All"
                    }
                } catch (error) {
                    console.error('Error deleting folder:', error)
                }
            }
        }
        handleCloseContextMenu()
    }

    // Handle folder dialog confirm
    const handleFolderDialogConfirm = async (name) => {
        try {
            if (editingFolder) {
                // Update existing folder
                await chatflowFoldersApi.updateFolder(editingFolder.id, { name })
            } else {
                // Create new folder
                await chatflowFoldersApi.createFolder({ name })
            }
            getAllFoldersApi.request()
            setShowFolderDialog(false)
        } catch (error) {
            console.error('Error saving folder:', error)
        }
    }

    const handleFolderDialogCancel = () => {
        setShowFolderDialog(false)
        setEditingFolder(null)
    }

    // Drag and drop handlers
    const handleDragOver = (e, folderId) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDragOverFolder(folderId)
    }

    const handleDragLeave = () => {
        setDragOverFolder(null)
    }

    const handleDrop = async (e, folderId) => {
        e.preventDefault()
        setDragOverFolder(null)

        const chatflowId = e.dataTransfer.getData('application/chatflow-id')
        if (!chatflowId) return

        try {
            await chatflowFoldersApi.moveChatflowToFolder(chatflowId, folderId)
            loadFolderCounts()
            if (onChatflowMoved) onChatflowMoved()
        } catch (error) {
            console.error('Error moving chatflow to folder:', error)
        }
    }

    const getDropStyles = (folderId) => ({
        py: 0.75,
        px: 1.5,
        borderRadius: 1,
        mx: 0.5,
        ...(dragOverFolder === folderId && {
            backgroundColor: theme.palette.primary.light + '40',
            border: `2px dashed ${theme.palette.primary.main}`
        })
    })

    return (
        <Box
            sx={{
                width: 200,
                minWidth: 200,
                maxWidth: 200,
                borderRight: `1px solid ${theme.palette.divider}`,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden'
            }}
        >
            <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant='subtitle2' sx={{ fontWeight: 600, color: theme.palette.text.secondary }}>
                    Folders
                </Typography>
                <Tooltip title='Create Folder'>
                    <IconButton size='small' onClick={handleCreateFolder}>
                        <IconFolderPlus size={18} color={customization.isDarkMode ? 'white' : 'black'} />
                    </IconButton>
                </Tooltip>
            </Box>
            <Divider />
            <List sx={{ flex: 1, overflow: 'auto', py: 1 }}>
                {/* All Chatflows */}
                <ListItemButton
                    selected={selectedFolder === null}
                    onClick={() => onFolderSelect(null)}
                    sx={{ py: 0.75, px: 1.5, borderRadius: 1, mx: 0.5 }}
                >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                        <IconFolders size={18} />
                    </ListItemIcon>
                    <ListItemText primary='All' primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                    {folderCounts.all > 0 && <Chip label={folderCounts.all} size='small' sx={{ height: 20, fontSize: '0.7rem' }} />}
                </ListItemButton>

                {/* Uncategorized - droppable */}
                <ListItemButton
                    selected={selectedFolder === 'uncategorized'}
                    onClick={() => onFolderSelect('uncategorized')}
                    onDragOver={(e) => handleDragOver(e, 'uncategorized')}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, null)}
                    sx={getDropStyles('uncategorized')}
                >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                        <IconInbox size={18} />
                    </ListItemIcon>
                    <ListItemText primary='Uncategorized' primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                    {folderCounts.uncategorized > 0 && (
                        <Chip label={folderCounts.uncategorized} size='small' sx={{ height: 20, fontSize: '0.7rem' }} />
                    )}
                </ListItemButton>

                {folders.length > 0 && <Divider sx={{ my: 1 }} />}

                {/* User folders - droppable */}
                {folders.map((folder) => (
                    <ListItemButton
                        key={folder.id}
                        selected={selectedFolder === folder.id}
                        onClick={() => onFolderSelect(folder.id)}
                        onContextMenu={(e) => handleContextMenu(e, folder)}
                        onDragOver={(e) => handleDragOver(e, folder.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, folder.id)}
                        sx={getDropStyles(folder.id)}
                    >
                        <ListItemIcon sx={{ minWidth: 28 }}>
                            <IconFolder size={18} />
                        </ListItemIcon>
                        <ListItemText
                            primary={folder.name}
                            primaryTypographyProps={{
                                variant: 'body2',
                                style: {
                                    whiteSpace: 'normal',
                                    wordBreak: 'break-word',
                                    lineHeight: 1.2
                                }
                            }}
                        />
                        {folderCounts[folder.id] > 0 && (
                            <Chip label={folderCounts[folder.id]} size='small' sx={{ height: 20, fontSize: '0.7rem', mr: 0.5 }} />
                        )}
                        <IconButton
                            size='small'
                            onClick={(e) => {
                                e.stopPropagation()
                                handleContextMenu(e, folder)
                            }}
                            sx={{ opacity: 0.5, '&:hover': { opacity: 1 }, p: 0.25 }}
                        >
                            <IconDotsVertical size={14} />
                        </IconButton>
                    </ListItemButton>
                ))}
            </List>

            {/* Context Menu */}
            <Menu
                open={contextMenu !== null}
                onClose={handleCloseContextMenu}
                anchorReference='anchorPosition'
                anchorPosition={contextMenu !== null ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
            >
                <MenuItem onClick={handleRenameFolder}>
                    <IconPencil size={16} style={{ marginRight: 8 }} />
                    Rename
                </MenuItem>
                <MenuItem onClick={handleDeleteFolder} sx={{ color: theme.palette.error.main }}>
                    <IconTrash size={16} style={{ marginRight: 8 }} />
                    Delete
                </MenuItem>
            </Menu>

            {/* Folder Dialog */}
            <FolderDialog
                show={showFolderDialog}
                dialogProps={folderDialogProps}
                onCancel={handleFolderDialogCancel}
                onConfirm={handleFolderDialogConfirm}
            />

            {/* Confirm Dialog */}
            <ConfirmDialog />
        </Box>
    )
}

FolderSidebar.propTypes = {
    selectedFolder: PropTypes.string,
    onFolderSelect: PropTypes.func.isRequired,
    onFoldersChange: PropTypes.func,
    onChatflowMoved: PropTypes.func,
    refreshSignal: PropTypes.number
}

export default FolderSidebar
