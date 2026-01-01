import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import PropTypes from 'prop-types'

import { Button, Dialog, DialogActions, DialogContent, OutlinedInput, DialogTitle } from '@mui/material'
import { StyledButton } from '@/ui-component/button/StyledButton'

const FolderDialog = ({ show, dialogProps, onCancel, onConfirm }) => {
    const portalElement = document.getElementById('portal')

    const [folderName, setFolderName] = useState('')
    const [isReadyToSave, setIsReadyToSave] = useState(false)

    useEffect(() => {
        if (show && dialogProps?.folderName) {
            setFolderName(dialogProps.folderName)
        } else if (show) {
            setFolderName('')
        }
    }, [show, dialogProps])

    useEffect(() => {
        if (folderName && folderName.trim()) setIsReadyToSave(true)
        else setIsReadyToSave(false)
    }, [folderName])

    const handleConfirm = () => {
        const trimmedName = folderName.trim()
        if (trimmedName) {
            onConfirm(trimmedName)
            setFolderName('')
        }
    }

    const handleCancel = () => {
        setFolderName('')
        onCancel()
    }

    const component = show ? (
        <Dialog
            open={show}
            fullWidth
            maxWidth='xs'
            onClose={handleCancel}
            aria-labelledby='folder-dialog-title'
            aria-describedby='folder-dialog-description'
            disableRestoreFocus
        >
            <DialogTitle sx={{ fontSize: '1rem' }} id='folder-dialog-title'>
                {dialogProps?.title || 'Create Folder'}
            </DialogTitle>
            <DialogContent>
                <OutlinedInput
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    sx={{ mt: 1 }}
                    id='folder-name'
                    type='text'
                    fullWidth
                    placeholder='Enter folder name'
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                    onKeyDown={(e) => {
                        if (isReadyToSave && e.key === 'Enter') handleConfirm()
                    }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={handleCancel}>{dialogProps?.cancelButtonName || 'Cancel'}</Button>
                <StyledButton disabled={!isReadyToSave} variant='contained' onClick={handleConfirm}>
                    {dialogProps?.confirmButtonName || 'Save'}
                </StyledButton>
            </DialogActions>
        </Dialog>
    ) : null

    return createPortal(component, portalElement)
}

FolderDialog.propTypes = {
    show: PropTypes.bool,
    dialogProps: PropTypes.object,
    onCancel: PropTypes.func,
    onConfirm: PropTypes.func
}

export default FolderDialog
