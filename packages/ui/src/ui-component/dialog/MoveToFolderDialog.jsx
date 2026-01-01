import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import PropTypes from 'prop-types'

import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    CircularProgress,
    Box
} from '@mui/material'
import { IconFolder, IconInbox } from '@tabler/icons-react'
import { StyledButton } from '@/ui-component/button/StyledButton'
import chatflowFoldersApi from '@/api/chatflowFolders'
import useApi from '@/hooks/useApi'

const MoveToFolderDialog = ({ show, chatflowName, onCancel, onConfirm }) => {
    const portalElement = document.getElementById('portal')

    const [selectedFolder, setSelectedFolder] = useState(null)
    const getAllFoldersApi = useApi(chatflowFoldersApi.getAllFolders)

    useEffect(() => {
        if (show) {
            getAllFoldersApi.request()
            setSelectedFolder(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [show])

    const handleConfirm = () => {
        onConfirm(selectedFolder)
    }

    const component = show ? (
        <Dialog
            open={show}
            fullWidth
            maxWidth='xs'
            onClose={onCancel}
            aria-labelledby='move-folder-dialog-title'
            aria-describedby='move-folder-dialog-description'
            disableRestoreFocus
        >
            <DialogTitle sx={{ fontSize: '1rem' }} id='move-folder-dialog-title'>
                Move "{chatflowName}" to Folder
            </DialogTitle>
            <DialogContent>
                {getAllFoldersApi.loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                        <CircularProgress />
                    </Box>
                ) : (
                    <List sx={{ pt: 0 }}>
                        {/* Uncategorized option */}
                        <ListItemButton
                            selected={selectedFolder === 'uncategorized'}
                            onClick={() => setSelectedFolder('uncategorized')}
                            sx={{ borderRadius: 1 }}
                        >
                            <ListItemIcon sx={{ minWidth: 40 }}>
                                <IconInbox size={20} />
                            </ListItemIcon>
                            <ListItemText primary='Uncategorized' />
                        </ListItemButton>

                        {/* User folders */}
                        {getAllFoldersApi.data?.map((folder) => (
                            <ListItemButton
                                key={folder.id}
                                selected={selectedFolder === folder.id}
                                onClick={() => setSelectedFolder(folder.id)}
                                sx={{ borderRadius: 1 }}
                            >
                                <ListItemIcon sx={{ minWidth: 40 }}>
                                    <IconFolder size={20} />
                                </ListItemIcon>
                                <ListItemText primary={folder.name} />
                            </ListItemButton>
                        ))}

                        {(!getAllFoldersApi.data || getAllFoldersApi.data.length === 0) && (
                            <Box sx={{ py: 2, textAlign: 'center', color: 'text.secondary' }}>
                                No folders created yet
                            </Box>
                        )}
                    </List>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel}>Cancel</Button>
                <StyledButton
                    disabled={selectedFolder === null}
                    variant='contained'
                    onClick={handleConfirm}
                >
                    Move
                </StyledButton>
            </DialogActions>
        </Dialog>
    ) : null

    return createPortal(component, portalElement)
}

MoveToFolderDialog.propTypes = {
    show: PropTypes.bool,
    chatflowName: PropTypes.string,
    onCancel: PropTypes.func,
    onConfirm: PropTypes.func
}

export default MoveToFolderDialog
