import { createPortal } from 'react-dom'
import { useDispatch, useSelector } from 'react-redux'
import { useState, useEffect, forwardRef } from 'react'
import PropTypes from 'prop-types'
import moment from 'moment'
import axios from 'axios'
import { cloneDeep } from 'lodash'

// material-ui
import {
    Button,
    Tooltip,
    ListItemButton,
    Box,
    Stack,
    Dialog,
    DialogContent,
    DialogTitle,
    ListItem,
    ListItemText,
    Chip,
    Card,
    CardMedia,
    CardContent,
    FormControlLabel,
    Checkbox,
    DialogActions,
    Pagination,
    Typography,
    Menu,
    MenuItem,
    IconButton,
    LinearProgress
} from '@mui/material'
import { useTheme, styled, alpha } from '@mui/material/styles'
import DatePicker from 'react-datepicker'

import robotPNG from '@/assets/images/robot.png'
import userPNG from '@/assets/images/account.png'
import msgEmptySVG from '@/assets/images/message_empty.svg'
import multiagent_supervisorPNG from '@/assets/images/multiagent_supervisor.png'
import multiagent_workerPNG from '@/assets/images/multiagent_worker.png'
import { IconTool, IconDeviceSdCard, IconFileExport, IconEraser, IconX, IconDownload, IconPaperclip, IconBulb } from '@tabler/icons-react'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'

// Project import
import { MemoizedReactMarkdown } from '@/ui-component/markdown/MemoizedReactMarkdown'
import { SafeHTML } from '@/ui-component/safe/SafeHTML'
import SourceDocDialog from '@/ui-component/dialog/SourceDocDialog'
import { MultiDropdown } from '@/ui-component/dropdown/MultiDropdown'
import { StyledButton } from '@/ui-component/button/StyledButton'
import StatsCard from '@/ui-component/cards/StatsCard'
import Feedback from '@/ui-component/extended/Feedback'

// store
import { HIDE_CANVAS_DIALOG, SHOW_CANVAS_DIALOG } from '@/store/actions'

// API
import chatmessageApi from '@/api/chatmessage'
import feedbackApi from '@/api/feedback'
import exportImportApi from '@/api/exportimport'
import useApi from '@/hooks/useApi'
import useConfirm from '@/hooks/useConfirm'

// Utils
import { isValidURL, removeDuplicateURL } from '@/utils/genericHelper'
import useNotifier from '@/utils/useNotifier'
import { baseURL } from '@/store/constant'

import { enqueueSnackbar as enqueueSnackbarAction, closeSnackbar as closeSnackbarAction } from '@/store/actions'

import '@/views/chatmessage/ChatMessage.css'
import 'react-datepicker/dist/react-datepicker.css'

const StyledMenu = styled((props) => (
    <Menu
        elevation={0}
        anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'right'
        }}
        transformOrigin={{
            vertical: 'top',
            horizontal: 'right'
        }}
        {...props}
    />
))(({ theme }) => ({
    '& .MuiPaper-root': {
        borderRadius: 6,
        marginTop: theme.spacing(1),
        minWidth: 180,
        boxShadow:
            'rgb(255, 255, 255) 0px 0px 0px 0px, rgba(0, 0, 0, 0.05) 0px 0px 0px 1px, rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgba(0, 0, 0, 0.05) 0px 4px 6px -2px',
        '& .MuiMenu-list': {
            padding: '4px 0'
        },
        '& .MuiMenuItem-root': {
            '& .MuiSvgIcon-root': {
                fontSize: 18,
                color: theme.palette.text.secondary,
                marginRight: theme.spacing(1.5)
            },
            '&:active': {
                backgroundColor: alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity)
            }
        }
    }
}))

const DatePickerCustomInput = forwardRef(function DatePickerCustomInput({ value, onClick }, ref) {
    return (
        <ListItemButton style={{ borderRadius: 15, border: '1px solid #e0e0e0' }} onClick={onClick} ref={ref}>
            {value}
        </ListItemButton>
    )
})

DatePickerCustomInput.propTypes = {
    value: PropTypes.string,
    onClick: PropTypes.func
}

const messageImageStyle = {
    width: '128px',
    height: '128px',
    objectFit: 'cover'
}

const ConfirmDeleteMessageDialog = ({ show, dialogProps, onCancel, onConfirm }) => {
    const portalElement = document.getElementById('portal')
    const [hardDelete, setHardDelete] = useState(false)

    const onSubmit = () => {
        onConfirm(hardDelete)
    }

    const component = show ? (
        <Dialog
            fullWidth
            maxWidth='xs'
            open={show}
            onClose={onCancel}
            aria-labelledby='alert-dialog-title'
            aria-describedby='alert-dialog-description'
        >
            <DialogTitle sx={{ fontSize: '1rem' }} id='alert-dialog-title'>
                {dialogProps.title}
            </DialogTitle>
            <DialogContent>
                <span style={{ marginTop: '20px', marginBottom: '20px' }}>{dialogProps.description}</span>
                {dialogProps.isChatflow && (
                    <FormControlLabel
                        control={<Checkbox checked={hardDelete} onChange={(event) => setHardDelete(event.target.checked)} />}
                        label='Remove messages from 3rd party Memory Node'
                    />
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel}>{dialogProps.cancelButtonName}</Button>
                <StyledButton variant='contained' onClick={onSubmit}>
                    {dialogProps.confirmButtonName}
                </StyledButton>
            </DialogActions>
        </Dialog>
    ) : null

    return createPortal(component, portalElement)
}

ConfirmDeleteMessageDialog.propTypes = {
    show: PropTypes.bool,
    dialogProps: PropTypes.object,
    onCancel: PropTypes.func,
    onConfirm: PropTypes.func
}

const ViewMessagesDialog = ({ show, dialogProps, onCancel }) => {
    const portalElement = document.getElementById('portal')
    const dispatch = useDispatch()
    const theme = useTheme()
    const customization = useSelector((state) => state.customization)
    const { confirm } = useConfirm()

    useNotifier()
    const enqueueSnackbar = (...args) => dispatch(enqueueSnackbarAction(...args))
    const closeSnackbar = (...args) => dispatch(closeSnackbarAction(...args))

    const [chatlogs, setChatLogs] = useState([])
    const [chatMessages, setChatMessages] = useState([])
    const [stats, setStats] = useState({})
    const [selectedMessageIndex, setSelectedMessageIndex] = useState(0)
    const [selectedChatId, setSelectedChatId] = useState('')
    const [sourceDialogOpen, setSourceDialogOpen] = useState(false)
    const [sourceDialogProps, setSourceDialogProps] = useState({})
    const [hardDeleteDialogOpen, setHardDeleteDialogOpen] = useState(false)
    const [hardDeleteDialogProps, setHardDeleteDialogProps] = useState({})
    const [chatTypeFilter, setChatTypeFilter] = useState(['INTERNAL', 'EXTERNAL'])
    const [feedbackTypeFilter, setFeedbackTypeFilter] = useState([])
    const [startDate, setStartDate] = useState(new Date(new Date().setMonth(new Date().getMonth() - 1)))
    const [endDate, setEndDate] = useState(new Date())
    const [leadEmail, setLeadEmail] = useState('')
    const [anchorEl, setAnchorEl] = useState(null)
    const open = Boolean(anchorEl)

    // Export progress modal state
    const [exportModalOpen, setExportModalOpen] = useState(false)
    const [exportProgress, setExportProgress] = useState({
        phase: 'idle', // idle | counting | fetching | assembling | done | error
        percent: 0,
        totalMessages: 0,
        fetchedMessages: 0,
        currentBatch: 0,
        totalBatches: 0,
        statusText: '',
        errorText: ''
    })

    // Delete progress modal state
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [deleteProgress, setDeleteProgress] = useState({
        phase: 'idle', // idle | counting | deleting | done | error
        percent: 0,
        totalMessages: 0,
        deletedMessages: 0,
        currentBatch: 0,
        statusText: '',
        errorText: ''
    })

    const getChatmessageApi = useApi(chatmessageApi.getAllChatmessageFromChatflow)
    const getChatmessageFromPKApi = useApi(chatmessageApi.getChatmessageFromPK)
    const getStatsApi = useApi(feedbackApi.getStatsFromChatflow)

    /* Table Pagination */
    const [currentPage, setCurrentPage] = useState(1)
    const [pageLimit, setPageLimit] = useState(10)
    const [total, setTotal] = useState(0)
    const onChange = (event, page) => {
        setCurrentPage(page)
        refresh(page, pageLimit, startDate, endDate, chatTypeFilter, feedbackTypeFilter)
    }

    const refresh = (page, limit, startDate, endDate, chatTypes, feedbackTypes) => {
        getChatmessageApi.request(dialogProps.chatflow.id, {
            chatType: chatTypes.length ? chatTypes : undefined,
            feedbackType: feedbackTypes.length ? feedbackTypes : undefined,
            startDate: startDate,
            endDate: endDate,
            order: 'DESC',
            page: page,
            limit: limit
        })
        getStatsApi.request(dialogProps.chatflow.id, {
            chatType: chatTypes.length ? chatTypes : undefined,
            feedbackType: feedbackTypes.length ? feedbackTypes : undefined,
            startDate: startDate,
            endDate: endDate
        })
        setCurrentPage(page)
    }

    const onStartDateSelected = (date) => {
        const updatedDate = new Date(date)
        updatedDate.setHours(0, 0, 0, 0)
        setStartDate(updatedDate)
        refresh(1, pageLimit, updatedDate, endDate, chatTypeFilter, feedbackTypeFilter)
    }

    const onEndDateSelected = (date) => {
        const updatedDate = new Date(date)
        updatedDate.setHours(23, 59, 59, 999)
        setEndDate(updatedDate)
        refresh(1, pageLimit, startDate, updatedDate, chatTypeFilter, feedbackTypeFilter)
    }

    const onChatTypeSelected = (chatTypes) => {
        // Parse the JSON string from MultiDropdown back to an array
        let parsedChatTypes = []
        if (chatTypes && typeof chatTypes === 'string' && chatTypes.startsWith('[') && chatTypes.endsWith(']')) {
            parsedChatTypes = JSON.parse(chatTypes)
        } else if (Array.isArray(chatTypes)) {
            parsedChatTypes = chatTypes
        }
        setChatTypeFilter(parsedChatTypes)
        refresh(1, pageLimit, startDate, endDate, parsedChatTypes, feedbackTypeFilter)
    }

    const onFeedbackTypeSelected = (feedbackTypes) => {
        // Parse the JSON string from MultiDropdown back to an array
        let parsedFeedbackTypes = []
        if (feedbackTypes && typeof feedbackTypes === 'string' && feedbackTypes.startsWith('[') && feedbackTypes.endsWith(']')) {
            parsedFeedbackTypes = JSON.parse(feedbackTypes)
        } else if (Array.isArray(feedbackTypes)) {
            parsedFeedbackTypes = feedbackTypes
        }
        setFeedbackTypeFilter(parsedFeedbackTypes)
        refresh(1, pageLimit, startDate, endDate, chatTypeFilter, parsedFeedbackTypes)
    }

    const onDeleteMessages = () => {
        setHardDeleteDialogProps({
            title: 'Delete Messages',
            description: 'Are you sure you want to delete messages? This action cannot be undone.',
            confirmButtonName: 'Delete',
            cancelButtonName: 'Cancel',
            isChatflow: dialogProps.isChatflow
        })
        setHardDeleteDialogOpen(true)
    }

    const DELETE_BATCH_SIZE = 1000

    const deleteMessages = async (hardDelete) => {
        setHardDeleteDialogOpen(false)
        const chatflowid = dialogProps.chatflow.id

        // Open delete progress modal
        setDeleteModalOpen(true)
        setDeleteProgress({
            phase: 'counting',
            percent: 0,
            totalMessages: 0,
            deletedMessages: 0,
            currentBatch: 0,
            statusText: 'Counting messages...',
            errorText: ''
        })

        try {
            // Step 1: Count messages to delete
            const countResponse = await exportImportApi.countChatflowMessages({
                chatflowId: chatflowid,
                chatType: chatTypeFilter.length ? chatTypeFilter : undefined,
                feedbackType: feedbackTypeFilter.length ? feedbackTypeFilter : undefined,
                startDate: startDate,
                endDate: endDate
            })
            const totalMessages = countResponse.data?.count || 0

            if (totalMessages === 0) {
                setDeleteProgress((prev) => ({
                    ...prev,
                    phase: 'done',
                    percent: 100,
                    statusText: 'No messages to delete.'
                }))
                setTimeout(() => {
                    setDeleteModalOpen(false)
                    setDeleteProgress((prev) => ({ ...prev, phase: 'idle' }))
                }, 2000)
                return
            }

            setDeleteProgress((prev) => ({
                ...prev,
                phase: 'deleting',
                totalMessages,
                statusText: `Deleting messages... 0 / ${totalMessages.toLocaleString()}`,
                percent: 0
            }))

            // Step 2: Delete in batches
            // Build query params for the batch delete endpoint
            const params = { batchSize: DELETE_BATCH_SIZE }

            let _chatTypeFilter = chatTypeFilter
            if (typeof chatTypeFilter === 'string' && chatTypeFilter.startsWith('[') && chatTypeFilter.endsWith(']')) {
                _chatTypeFilter = JSON.parse(chatTypeFilter)
            }
            if (_chatTypeFilter.length === 1) {
                params.chatType = _chatTypeFilter[0]
            } else if (_chatTypeFilter.length > 1) {
                params.chatType = JSON.stringify(_chatTypeFilter)
            }

            if (startDate) params.startDate = startDate
            if (endDate) params.endDate = endDate
            if (hardDelete) params.hardDelete = true

            let deletedMessages = 0
            let batchNum = 0
            let hasMore = true

            while (hasMore) {
                batchNum++
                const response = await chatmessageApi.deleteMessagesBatch(chatflowid, params)
                const batchResult = response.data

                deletedMessages += batchResult.deleted || 0
                hasMore = batchResult.hasMore

                const percent = Math.min(Math.round((deletedMessages / totalMessages) * 100), hasMore ? 99 : 100)

                setDeleteProgress((prev) => ({
                    ...prev,
                    phase: 'deleting',
                    deletedMessages,
                    currentBatch: batchNum,
                    percent,
                    statusText: hasMore
                        ? `Deleting messages... ${deletedMessages.toLocaleString()} / ${totalMessages.toLocaleString()}`
                        : `Finalizing...`
                }))
            }

            setDeleteProgress((prev) => ({
                ...prev,
                phase: 'done',
                percent: 100,
                deletedMessages,
                statusText: `Successfully deleted ${deletedMessages.toLocaleString()} messages!`
            }))

            // Auto-close after 2 seconds and refresh
            setTimeout(() => {
                setDeleteModalOpen(false)
                setDeleteProgress((prev) => ({ ...prev, phase: 'idle' }))
                refresh(1, pageLimit, startDate, endDate, chatTypeFilter, feedbackTypeFilter)
            }, 2000)
        } catch (error) {
            console.error('Error deleting messages:', error)
            setDeleteProgress((prev) => ({
                ...prev,
                phase: 'error',
                statusText: 'Delete failed',
                errorText: error?.response?.data?.message || error?.message || 'An unexpected error occurred during deletion.'
            }))
        }
    }

    const getChatType = (chatType) => {
        if (chatType === 'INTERNAL') {
            return 'UI'
        } else if (chatType === 'EVALUATION') {
            return 'Evaluation'
        }
        return 'API/Embed'
    }

    const BATCH_SIZE = 1000

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
    }

    const exportMessages = async () => {
        // Open modal and start
        setExportModalOpen(true)
        setExportProgress({
            phase: 'counting',
            percent: 0,
            totalMessages: 0,
            fetchedMessages: 0,
            currentBatch: 0,
            totalBatches: 0,
            statusText: 'Counting messages...',
            errorText: ''
        })

        try {
            // Step 1: Count messages
            const countResponse = await exportImportApi.countChatflowMessages({
                chatflowId: dialogProps.chatflow.id,
                chatType: chatTypeFilter.length ? chatTypeFilter : undefined,
                feedbackType: feedbackTypeFilter.length ? feedbackTypeFilter : undefined,
                startDate: startDate,
                endDate: endDate
            })
            const totalMessages = countResponse.data?.count || 0
            const totalBatches = Math.ceil(totalMessages / BATCH_SIZE)

            if (totalMessages === 0) {
                setExportProgress((prev) => ({
                    ...prev,
                    phase: 'done',
                    percent: 100,
                    statusText: 'No messages to export.'
                }))
                return
            }

            setExportProgress((prev) => ({
                ...prev,
                phase: 'fetching',
                totalMessages,
                totalBatches,
                statusText: `Fetching batch 1/${totalBatches}...`,
                percent: 0
            }))

            // Step 2: Fetch batches one by one
            // We accumulate all conversations, merging across batches
            const allConversations = {} // keyed by conversation id
            let currentPage = 1
            let hasMore = true
            let fetchedMessages = 0

            while (hasMore) {
                const batchResponse = await exportImportApi.exportChatflowMessagesBatch({
                    chatflowId: dialogProps.chatflow.id,
                    chatType: chatTypeFilter.length ? chatTypeFilter : undefined,
                    feedbackType: feedbackTypeFilter.length ? feedbackTypeFilter : undefined,
                    startDate: startDate,
                    endDate: endDate,
                    page: currentPage,
                    batchSize: BATCH_SIZE
                })

                const batchData = batchResponse.data

                // Merge conversations from this batch
                if (batchData.conversations && batchData.conversations.length > 0) {
                    batchData.conversations.forEach((conv) => {
                        const key = `${conv.id}_${conv.sessionId || ''}_${conv.memoryType || ''}`
                        if (allConversations[key]) {
                            // Merge messages into existing conversation
                            allConversations[key].messages = [...allConversations[key].messages, ...conv.messages]
                        } else {
                            allConversations[key] = { ...conv }
                        }
                    })
                }

                fetchedMessages += batchData.fetched || 0
                hasMore = batchData.hasMore
                currentPage++

                const percent = Math.min(Math.round((fetchedMessages / totalMessages) * 100), 99)

                setExportProgress((prev) => ({
                    ...prev,
                    phase: 'fetching',
                    currentBatch: currentPage - 1,
                    fetchedMessages,
                    percent,
                    statusText: hasMore ? `Fetching batch ${currentPage}/${totalBatches}...` : `All batches fetched! Preparing file...`
                }))
            }

            // Step 3: Assemble final file
            setExportProgress((prev) => ({
                ...prev,
                phase: 'assembling',
                percent: 99,
                fetchedMessages,
                statusText: 'Assembling export file...'
            }))

            const exportArray = Object.values(allConversations)
            const dataStr = JSON.stringify(exportArray, null, 2)
            const blob = new Blob([dataStr], { type: 'application/json' })
            const dataUri = URL.createObjectURL(blob)

            // Build filename: WorkflowName_YYYY-MM-DD_HH-mm-ss.json
            const workflowName = (dialogProps.chatflow.name || 'Export')
                .replace(/[^a-zA-Z0-9\u0600-\u06FF\s_-]/g, '')
                .trim()
                .replace(/\s+/g, '_')
            const now = new Date()
            const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(
                2,
                '0'
            )}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(
                2,
                '0'
            )}`
            const exportFileName = `${workflowName}_${timestamp}.json`

            const linkElement = document.createElement('a')
            linkElement.setAttribute('href', dataUri)
            linkElement.setAttribute('download', exportFileName)
            linkElement.click()
            URL.revokeObjectURL(dataUri)

            setExportProgress((prev) => ({
                ...prev,
                phase: 'done',
                percent: 100,
                statusText: `Export complete! ${fetchedMessages.toLocaleString()} messages in ${exportArray.length.toLocaleString()} conversations (${formatBytes(
                    blob.size
                )})`
            }))

            // Auto-close after 3 seconds
            setTimeout(() => {
                setExportModalOpen(false)
                setExportProgress((prev) => ({ ...prev, phase: 'idle' }))
            }, 3000)
        } catch (error) {
            console.error('Error exporting messages:', error)
            setExportProgress((prev) => ({
                ...prev,
                phase: 'error',
                statusText: 'Export failed',
                errorText: error?.response?.data?.message || error?.message || 'An unexpected error occurred during export.'
            }))
        }
    }

    const clearChat = async (chatmsg) => {
        const description =
            chatmsg.sessionId && chatmsg.memoryType
                ? `Are you sure you want to clear session id: ${chatmsg.sessionId} from ${chatmsg.memoryType}?`
                : `Are you sure you want to clear messages?`
        const confirmPayload = {
            title: `Clear Session`,
            description,
            confirmButtonName: 'Clear',
            cancelButtonName: 'Cancel'
        }
        const isConfirmed = await confirm(confirmPayload)

        const chatflowid = dialogProps.chatflow.id
        if (isConfirmed) {
            try {
                const obj = { chatflowid, isClearFromViewMessageDialog: true }
                if (chatmsg.chatId) obj.chatId = chatmsg.chatId
                if (chatmsg.chatType) obj.chatType = chatmsg.chatType
                if (chatmsg.memoryType) obj.memoryType = chatmsg.memoryType
                if (chatmsg.sessionId) obj.sessionId = chatmsg.sessionId

                await chatmessageApi.deleteChatmessage(chatflowid, obj)
                const description =
                    chatmsg.sessionId && chatmsg.memoryType
                        ? `Succesfully cleared session id: ${chatmsg.sessionId} from ${chatmsg.memoryType}`
                        : `Succesfully cleared messages`
                enqueueSnackbar({
                    message: description,
                    options: {
                        key: new Date().getTime() + Math.random(),
                        variant: 'success',
                        action: (key) => (
                            <Button style={{ color: 'white' }} onClick={() => closeSnackbar(key)}>
                                <IconX />
                            </Button>
                        )
                    }
                })
                getChatmessageApi.request(chatflowid, {
                    startDate: startDate,
                    endDate: endDate,
                    chatType: chatTypeFilter.length ? chatTypeFilter : undefined,
                    feedbackType: feedbackTypeFilter.length ? feedbackTypeFilter : undefined
                })
                getStatsApi.request(chatflowid, {
                    startDate: startDate,
                    endDate: endDate,
                    chatType: chatTypeFilter.length ? chatTypeFilter : undefined,
                    feedbackType: feedbackTypeFilter.length ? feedbackTypeFilter : undefined
                })
            } catch (error) {
                enqueueSnackbar({
                    message: typeof error.response.data === 'object' ? error.response.data.message : error.response.data,
                    options: {
                        key: new Date().getTime() + Math.random(),
                        variant: 'error',
                        persist: true,
                        action: (key) => (
                            <Button style={{ color: 'white' }} onClick={() => closeSnackbar(key)}>
                                <IconX />
                            </Button>
                        )
                    }
                })
            }
        }
    }

    const getChatMessages = (chatmessages) => {
        let prevDate = ''
        const loadedMessages = []
        for (let i = 0; i < chatmessages.length; i += 1) {
            const chatmsg = chatmessages[i]
            setSelectedChatId(chatmsg.chatId)
            if (!prevDate) {
                prevDate = chatmsg.createdDate.split('T')[0]
                loadedMessages.push({
                    message: chatmsg.createdDate,
                    type: 'timeMessage'
                })
            } else {
                const currentDate = chatmsg.createdDate.split('T')[0]
                if (currentDate !== prevDate) {
                    prevDate = currentDate
                    loadedMessages.push({
                        message: chatmsg.createdDate,
                        type: 'timeMessage'
                    })
                }
            }
            if (chatmsg.fileUploads && Array.isArray(chatmsg.fileUploads)) {
                chatmsg.fileUploads.forEach((file) => {
                    if (file.type === 'stored-file') {
                        file.data = `${baseURL}/api/v1/get-upload-file?chatflowId=${chatmsg.chatflowid}&chatId=${chatmsg.chatId}&fileName=${file.name}`
                    }
                })
            }
            const obj = {
                ...chatmsg,
                message: chatmsg.content,
                type: chatmsg.role
            }
            if (chatmsg.sourceDocuments) obj.sourceDocuments = chatmsg.sourceDocuments
            if (chatmsg.usedTools) obj.usedTools = chatmsg.usedTools
            if (chatmsg.fileAnnotations) obj.fileAnnotations = chatmsg.fileAnnotations
            if (chatmsg.agentReasoning) obj.agentReasoning = chatmsg.agentReasoning
            if (chatmsg.artifacts) {
                obj.artifacts = chatmsg.artifacts
                obj.artifacts.forEach((artifact) => {
                    if (artifact.type === 'png' || artifact.type === 'jpeg') {
                        artifact.data = `${baseURL}/api/v1/get-upload-file?chatflowId=${chatmsg.chatflowid}&chatId=${
                            chatmsg.chatId
                        }&fileName=${artifact.data.replace('FILE-STORAGE::', '')}`
                    }
                })
            }
            loadedMessages.push(obj)
        }
        setChatMessages(loadedMessages)
    }

    const getChatPK = (chatmsg) => {
        const chatId = chatmsg.chatId
        const memoryType = chatmsg.memoryType ?? 'null'
        const sessionId = chatmsg.sessionId ?? 'null'
        return `${chatId}_${memoryType}_${sessionId}`
    }

    const transformChatPKToParams = (chatPK) => {
        let [c1, c2, ...rest] = chatPK.split('_')
        const chatId = c1
        const memoryType = c2
        const sessionId = rest.join('_')

        const params = { chatId }
        if (memoryType !== 'null') params.memoryType = memoryType
        if (sessionId !== 'null') params.sessionId = sessionId

        return params
    }

    const processChatLogs = (allChatMessages) => {
        const seen = {}
        const filteredChatLogs = []
        for (let i = 0; i < allChatMessages.length; i += 1) {
            const PK = getChatPK(allChatMessages[i])

            const item = allChatMessages[i]
            if (!Object.prototype.hasOwnProperty.call(seen, PK)) {
                seen[PK] = {
                    counter: 1,
                    item: allChatMessages[i]
                }
            } else if (Object.prototype.hasOwnProperty.call(seen, PK) && seen[PK].counter === 1) {
                // Properly identify user and API messages regardless of order
                const firstMessage = seen[PK].item
                const secondMessage = item

                let userContent = ''
                let apiContent = ''

                // Check both messages and assign based on role, not order
                if (firstMessage.role === 'userMessage') {
                    userContent = `User: ${firstMessage.content}`
                } else if (firstMessage.role === 'apiMessage') {
                    apiContent = `Bot: ${firstMessage.content}`
                }

                if (secondMessage.role === 'userMessage') {
                    userContent = `User: ${secondMessage.content}`
                } else if (secondMessage.role === 'apiMessage') {
                    apiContent = `Bot: ${secondMessage.content}`
                }

                seen[PK] = {
                    counter: 2,
                    item: {
                        ...seen[PK].item,
                        apiContent,
                        userContent
                    }
                }
                filteredChatLogs.push(seen[PK].item)
            }
        }

        // Sort by date to maintain chronological order
        const sortedChatLogs = filteredChatLogs.sort((a, b) => new Date(b.createdDate) - new Date(a.createdDate))
        setChatLogs(sortedChatLogs)
        if (sortedChatLogs.length) return getChatPK(sortedChatLogs[0])
        return undefined
    }

    const handleItemClick = (idx, chatmsg) => {
        setSelectedMessageIndex(idx)
        if (feedbackTypeFilter.length > 0) {
            getChatmessageFromPKApi.request(dialogProps.chatflow.id, {
                ...transformChatPKToParams(getChatPK(chatmsg)),
                feedbackType: feedbackTypeFilter
            })
        } else {
            getChatmessageFromPKApi.request(dialogProps.chatflow.id, transformChatPKToParams(getChatPK(chatmsg)))
        }
    }

    const onURLClick = (data) => {
        window.open(data, '_blank')
    }

    const downloadFile = async (fileAnnotation) => {
        try {
            const response = await axios.post(
                `${baseURL}/api/v1/openai-assistants-file/download`,
                { fileName: fileAnnotation.fileName, chatflowId: dialogProps.chatflow.id, chatId: selectedChatId },
                { responseType: 'blob' }
            )
            const blob = new Blob([response.data], { type: response.headers['content-type'] })
            const downloadUrl = window.URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = downloadUrl
            link.download = fileAnnotation.fileName
            document.body.appendChild(link)
            link.click()
            link.remove()
        } catch (error) {
            console.error('Download failed:', error)
        }
    }

    const onSourceDialogClick = (data, title) => {
        setSourceDialogProps({ data, title })
        setSourceDialogOpen(true)
    }

    const handleClick = (event) => {
        setAnchorEl(event.currentTarget)
    }

    const handleClose = () => {
        setAnchorEl(null)
    }

    const renderFileUploads = (item, index) => {
        if (item?.mime?.startsWith('image/')) {
            return (
                <Card
                    key={index}
                    sx={{
                        p: 0,
                        m: 0,
                        maxWidth: 128,
                        marginRight: '10px',
                        flex: '0 0 auto'
                    }}
                >
                    <CardMedia component='img' image={item.data} sx={{ height: 64 }} alt={'preview'} style={messageImageStyle} />
                </Card>
            )
        } else if (item?.mime?.startsWith('audio/')) {
            return (
                /* eslint-disable jsx-a11y/media-has-caption */
                <audio controls='controls'>
                    Your browser does not support the &lt;audio&gt; tag.
                    <source src={item.data} type={item.mime} />
                </audio>
            )
        } else {
            return (
                <Card
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        height: '48px',
                        width: 'max-content',
                        p: 2,
                        mr: 1,
                        flex: '0 0 auto',
                        backgroundColor: customization.isDarkMode ? 'rgba(0, 0, 0, 0.3)' : 'transparent'
                    }}
                    variant='outlined'
                >
                    <IconPaperclip size={20} />
                    <span
                        style={{
                            marginLeft: '5px',
                            color: customization.isDarkMode ? 'white' : 'inherit'
                        }}
                    >
                        {item.name}
                    </span>
                </Card>
            )
        }
    }

    useEffect(() => {
        const leadEmailFromChatMessages = chatMessages.filter((message) => message.type === 'userMessage' && message.leadEmail)
        if (leadEmailFromChatMessages.length) {
            setLeadEmail(leadEmailFromChatMessages[0].leadEmail)
        }
    }, [chatMessages, selectedMessageIndex])

    useEffect(() => {
        if (getChatmessageFromPKApi.data) {
            getChatMessages(getChatmessageFromPKApi.data)
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getChatmessageFromPKApi.data])

    useEffect(() => {
        if (getChatmessageApi.data) {
            const chatPK = processChatLogs(getChatmessageApi.data)
            setSelectedMessageIndex(0)
            if (chatPK) {
                if (feedbackTypeFilter.length > 0) {
                    getChatmessageFromPKApi.request(dialogProps.chatflow.id, {
                        ...transformChatPKToParams(chatPK),
                        feedbackType: feedbackTypeFilter
                    })
                } else {
                    getChatmessageFromPKApi.request(dialogProps.chatflow.id, transformChatPKToParams(chatPK))
                }
            }
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [getChatmessageApi.data])

    useEffect(() => {
        if (getStatsApi.data) {
            setStats(getStatsApi.data)
            setTotal(getStatsApi.data?.totalSessions ?? 0)
        }
    }, [getStatsApi.data])

    useEffect(() => {
        if (dialogProps.chatflow) {
            refresh(currentPage, pageLimit, startDate, endDate, chatTypeFilter, feedbackTypeFilter)
            getStatsApi.request(dialogProps.chatflow.id, {
                startDate: startDate,
                endDate: endDate
            })
        }

        return () => {
            setChatLogs([])
            setChatMessages([])
            setChatTypeFilter(['INTERNAL', 'EXTERNAL'])
            setFeedbackTypeFilter([])
            setSelectedMessageIndex(0)
            setSelectedChatId('')
            setStartDate(new Date(new Date().setMonth(new Date().getMonth() - 1)))
            setEndDate(new Date())
            setStats([])
            setLeadEmail('')
            setTotal(0)
            setCurrentPage(1)
            setPageLimit(10)
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dialogProps])

    useEffect(() => {
        if (show) dispatch({ type: SHOW_CANVAS_DIALOG })
        else dispatch({ type: HIDE_CANVAS_DIALOG })
        return () => dispatch({ type: HIDE_CANVAS_DIALOG })
    }, [show, dispatch])

    useEffect(() => {
        if (dialogProps.chatflow) {
            // when the filter is cleared fetch all messages
            if (feedbackTypeFilter.length === 0) {
                refresh(currentPage, pageLimit, startDate, endDate, chatTypeFilter, feedbackTypeFilter)
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [feedbackTypeFilter])

    const agentReasoningArtifacts = (artifacts) => {
        const newArtifacts = cloneDeep(artifacts)
        for (let i = 0; i < newArtifacts.length; i++) {
            const artifact = newArtifacts[i]
            if (artifact && (artifact.type === 'png' || artifact.type === 'jpeg')) {
                const data = artifact.data
                newArtifacts[i].data = `${baseURL}/api/v1/get-upload-file?chatflowId=${
                    dialogProps.chatflow.id
                }&chatId=${selectedChatId}&fileName=${data.replace('FILE-STORAGE::', '')}`
            }
        }
        return newArtifacts
    }

    const renderArtifacts = (item, index, isAgentReasoning) => {
        if (item.type === 'png' || item.type === 'jpeg') {
            return (
                <Card
                    key={index}
                    sx={{
                        p: 0,
                        m: 0,
                        mt: 2,
                        mb: 2,
                        flex: '0 0 auto'
                    }}
                >
                    <CardMedia
                        component='img'
                        image={item.data}
                        sx={{ height: 'auto' }}
                        alt={'artifact'}
                        style={{
                            width: isAgentReasoning ? '200px' : '100%',
                            height: isAgentReasoning ? '200px' : 'auto',
                            objectFit: 'cover'
                        }}
                    />
                </Card>
            )
        } else if (item.type === 'html') {
            return (
                <div style={{ marginTop: '20px' }}>
                    <SafeHTML html={item.data} />
                </div>
            )
        } else {
            return <MemoizedReactMarkdown chatflowid={dialogProps.chatflow.id}>{item.data}</MemoizedReactMarkdown>
        }
    }

    const component = show ? (
        <Dialog
            onClose={onCancel}
            open={show}
            fullWidth
            maxWidth={'xl'}
            aria-labelledby='alert-dialog-title'
            aria-describedby='alert-dialog-description'
        >
            <DialogContent>
                <>
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            marginBottom: 16,
                            marginLeft: 8,
                            marginRight: 8
                        }}
                    >
                        <div style={{ marginRight: 10 }}>
                            <b style={{ marginRight: 10 }}>From Date</b>
                            <DatePicker
                                selected={startDate}
                                onChange={(date) => onStartDateSelected(date)}
                                selectsStart
                                startDate={startDate}
                                endDate={endDate}
                                customInput={<DatePickerCustomInput />}
                            />
                        </div>
                        <div style={{ marginRight: 10 }}>
                            <b style={{ marginRight: 10 }}>To Date</b>
                            <DatePicker
                                selected={endDate}
                                onChange={(date) => onEndDateSelected(date)}
                                selectsEnd
                                startDate={startDate}
                                endDate={endDate}
                                minDate={startDate}
                                maxDate={new Date()}
                                customInput={<DatePickerCustomInput />}
                            />
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'row',
                                alignItems: 'center',
                                minWidth: '200px',
                                marginRight: 10
                            }}
                        >
                            <b style={{ marginRight: 10 }}>Source</b>
                            <MultiDropdown
                                key={JSON.stringify(chatTypeFilter)}
                                name='chatType'
                                options={[
                                    {
                                        label: 'UI',
                                        name: 'INTERNAL'
                                    },
                                    {
                                        label: 'API/Embed',
                                        name: 'EXTERNAL'
                                    },
                                    {
                                        label: 'Evaluations',
                                        name: 'EVALUATION'
                                    }
                                ]}
                                onSelect={(newValue) => onChatTypeSelected(newValue)}
                                value={chatTypeFilter}
                                formControlSx={{ mt: 0 }}
                            />
                        </div>
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'row',
                                alignItems: 'center',
                                minWidth: '200px',
                                marginRight: 10
                            }}
                        >
                            <b style={{ marginRight: 10 }}>Feedback</b>
                            <MultiDropdown
                                key={JSON.stringify(feedbackTypeFilter)}
                                name='feedbackType'
                                options={[
                                    {
                                        label: 'Positive',
                                        name: 'THUMBS_UP'
                                    },
                                    {
                                        label: 'Negative',
                                        name: 'THUMBS_DOWN'
                                    }
                                ]}
                                onSelect={(newValue) => onFeedbackTypeSelected(newValue)}
                                value={feedbackTypeFilter}
                                formControlSx={{ mt: 0 }}
                            />
                        </div>
                        <div style={{ flex: 1 }}></div>
                        <Button
                            id='messages-dialog-action-button'
                            aria-controls={open ? 'messages-dialog-action-menu' : undefined}
                            aria-haspopup='true'
                            aria-expanded={open ? 'true' : undefined}
                            variant={customization.isDarkMode ? 'contained' : 'outlined'}
                            disableElevation
                            color='secondary'
                            onClick={handleClick}
                            sx={{
                                minWidth: 150,
                                '&:hover': {
                                    backgroundColor: customization.isDarkMode ? alpha(theme.palette.secondary.main, 0.8) : undefined
                                }
                            }}
                            endIcon={
                                <KeyboardArrowDownIcon style={{ backgroundColor: customization.isDarkMode ? 'transparent' : 'inherit' }} />
                            }
                        >
                            More Actions
                        </Button>
                        <StyledMenu
                            id='messages-dialog-action-menu'
                            MenuListProps={{
                                'aria-labelledby': 'messages-dialog-action-button'
                            }}
                            anchorEl={anchorEl}
                            open={open}
                            onClose={handleClose}
                        >
                            <MenuItem
                                onClick={() => {
                                    handleClose()
                                    exportMessages()
                                }}
                                disableRipple
                            >
                                <IconFileExport style={{ marginRight: 8 }} />
                                Export to JSON
                            </MenuItem>
                            {(stats.totalMessages ?? 0) > 0 && (
                                <MenuItem
                                    onClick={() => {
                                        handleClose()
                                        onDeleteMessages()
                                    }}
                                    disableRipple
                                >
                                    <IconEraser style={{ marginRight: 8 }} />
                                    Delete All
                                </MenuItem>
                            )}
                        </StyledMenu>
                    </div>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                            gap: 10,
                            marginBottom: 25,
                            marginLeft: 8,
                            marginRight: 8,
                            marginTop: 20
                        }}
                    >
                        <StatsCard title='Total Sessions' stat={`${stats.totalSessions ?? 0}`} />
                        <StatsCard title='Total Messages' stat={`${stats.totalMessages ?? 0}`} />
                        <StatsCard title='Total Feedback Received' stat={`${stats.totalFeedback ?? 0}`} />
                        <StatsCard
                            title='Positive Feedback'
                            stat={`${(((stats.positiveFeedback ?? 0) / (stats.totalFeedback ?? 1)) * 100 || 0).toFixed(2)}%`}
                        />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', overflow: 'hidden', minWidth: 0 }}>
                        {chatlogs && chatlogs.length === 0 && (
                            <Stack sx={{ alignItems: 'center', justifyContent: 'center', width: '100%' }} flexDirection='column'>
                                <Box sx={{ p: 5, height: 'auto' }}>
                                    <img
                                        style={{ objectFit: 'cover', height: '20vh', width: 'auto' }}
                                        src={msgEmptySVG}
                                        alt='msgEmptySVG'
                                    />
                                </Box>
                                <div>No Messages</div>
                            </Stack>
                        )}
                        {chatlogs && chatlogs.length > 0 && (
                            <div style={{ flexBasis: '40%', minWidth: 0, overflow: 'hidden' }}>
                                <Box
                                    sx={{
                                        overflowY: 'auto',
                                        display: 'flex',
                                        flexGrow: 1,
                                        flexDirection: 'column',
                                        maxHeight: 'calc(100vh - 260px)'
                                    }}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            marginLeft: '15px',
                                            flexDirection: 'row',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: 10
                                        }}
                                    >
                                        <Typography variant='h5'>
                                            Sessions {pageLimit * (currentPage - 1) + 1} - {Math.min(pageLimit * currentPage, total)} of{' '}
                                            {total}
                                        </Typography>
                                        <Pagination
                                            style={{ justifyItems: 'right', justifyContent: 'center' }}
                                            count={Math.ceil(total / pageLimit)}
                                            onChange={onChange}
                                            page={currentPage}
                                            color='primary'
                                        />
                                    </div>
                                    {chatlogs.map((chatmsg, index) => (
                                        <ListItemButton
                                            key={index}
                                            sx={{
                                                p: 0,
                                                borderRadius: `${customization.borderRadius}px`,
                                                boxShadow: '0 2px 14px 0 rgb(32 40 45 / 8%)',
                                                mt: 1,
                                                ml: 1,
                                                mr: 1,
                                                mb: index === chatlogs.length - 1 ? 1 : 0
                                            }}
                                            selected={selectedMessageIndex === index}
                                            onClick={() => handleItemClick(index, chatmsg)}
                                        >
                                            <ListItem alignItems='center'>
                                                <ListItemText
                                                    primary={
                                                        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 10 }}>
                                                            <span>{chatmsg?.userContent}</span>
                                                            <div
                                                                style={{
                                                                    maxHeight: '100px',
                                                                    maxWidth: '400px',
                                                                    whiteSpace: 'nowrap',
                                                                    overflow: 'hidden',
                                                                    textOverflow: 'ellipsis'
                                                                }}
                                                            >
                                                                {chatmsg?.apiContent}
                                                            </div>
                                                        </div>
                                                    }
                                                    secondary={moment(chatmsg.createdDate).format('MMMM Do YYYY, h:mm:ss a')}
                                                />
                                            </ListItem>
                                        </ListItemButton>
                                    ))}
                                </Box>
                            </div>
                        )}
                        {chatlogs && chatlogs.length > 0 && (
                            <div style={{ flexBasis: '60%', paddingRight: '30px', minWidth: 0, overflow: 'hidden' }}>
                                {chatMessages && chatMessages.length > 1 && (
                                    <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                                        <div style={{ flex: 1, marginLeft: '20px', marginBottom: '15px', marginTop: '10px' }}>
                                            {chatMessages[1].sessionId && (
                                                <div>
                                                    Session Id:&nbsp;<b>{chatMessages[1].sessionId}</b>
                                                </div>
                                            )}
                                            {chatMessages[1].chatType && (
                                                <div>
                                                    Source:&nbsp;<b>{getChatType(chatMessages[1].chatType)}</b>
                                                </div>
                                            )}
                                            {chatMessages[1].memoryType && (
                                                <div>
                                                    Memory:&nbsp;<b>{chatMessages[1].memoryType}</b>
                                                </div>
                                            )}
                                            {leadEmail && (
                                                <div>
                                                    Email:&nbsp;<b>{leadEmail}</b>
                                                </div>
                                            )}
                                        </div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                flexDirection: 'row',
                                                alignContent: 'center',
                                                alignItems: 'end'
                                            }}
                                        >
                                            <Tooltip title='Clear Message'>
                                                <IconButton color='error' onClick={() => clearChat(chatMessages[1])}>
                                                    <IconEraser />
                                                </IconButton>
                                            </Tooltip>
                                            {chatMessages[1].sessionId && (
                                                <Tooltip
                                                    title={
                                                        'On the left 👈, you’ll see the Memory node used in this conversation. To delete the session conversations stored on that Memory node, you must have a matching Memory node with identical parameters in the canvas.'
                                                    }
                                                    placement='bottom'
                                                >
                                                    <IconButton color='primary'>
                                                        <IconBulb />
                                                    </IconButton>
                                                </Tooltip>
                                            )}
                                        </div>
                                    </div>
                                )}
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        marginLeft: '20px',
                                        marginBottom: '5px',
                                        border: customization.isDarkMode ? 'none' : '1px solid #e0e0e0',
                                        boxShadow: customization.isDarkMode ? '0 0 5px 0 rgba(255, 255, 255, 0.5)' : 'none',
                                        borderRadius: `10px`,
                                        overflow: 'hidden'
                                    }}
                                    className='cloud-message'
                                >
                                    <div style={{ width: '100%', height: '100%', overflowY: 'auto' }}>
                                        {chatMessages &&
                                            chatMessages.map((message, index) => {
                                                if (message.type === 'apiMessage' || message.type === 'userMessage') {
                                                    return (
                                                        <Box
                                                            sx={{
                                                                background:
                                                                    message.type === 'apiMessage' ? theme.palette.asyncSelect.main : '',
                                                                py: '1rem',
                                                                px: '1.5rem'
                                                            }}
                                                            key={index}
                                                            style={{ display: 'flex', justifyContent: 'center', alignContent: 'center' }}
                                                        >
                                                            {/* Display the correct icon depending on the message type */}
                                                            {message.type === 'apiMessage' ? (
                                                                <img
                                                                    style={{ marginLeft: '10px' }}
                                                                    src={robotPNG}
                                                                    alt='AI'
                                                                    width='25'
                                                                    height='25'
                                                                    className='boticon'
                                                                />
                                                            ) : (
                                                                <img
                                                                    style={{ marginLeft: '10px' }}
                                                                    src={userPNG}
                                                                    alt='Me'
                                                                    width='25'
                                                                    height='25'
                                                                    className='usericon'
                                                                />
                                                            )}
                                                            <div
                                                                style={{
                                                                    display: 'flex',
                                                                    flexDirection: 'column',
                                                                    width: '100%',
                                                                    minWidth: 0,
                                                                    overflow: 'hidden'
                                                                }}
                                                            >
                                                                {message.fileUploads && message.fileUploads.length > 0 && (
                                                                    <div
                                                                        style={{
                                                                            display: 'flex',
                                                                            flexWrap: 'wrap',
                                                                            flexDirection: 'column',
                                                                            width: '100%',
                                                                            gap: '8px'
                                                                        }}
                                                                    >
                                                                        {message.fileUploads.map((item, index) => {
                                                                            return <>{renderFileUploads(item, index)}</>
                                                                        })}
                                                                    </div>
                                                                )}
                                                                {message.agentReasoning && (
                                                                    <div style={{ display: 'block', flexDirection: 'row', width: '100%' }}>
                                                                        {message.agentReasoning.map((agent, index) => {
                                                                            return (
                                                                                <Card
                                                                                    key={index}
                                                                                    sx={{
                                                                                        border: '1px solid #e0e0e0',
                                                                                        borderRadius: `${customization.borderRadius}px`,
                                                                                        mb: 1
                                                                                    }}
                                                                                >
                                                                                    <CardContent>
                                                                                        <Stack
                                                                                            sx={{
                                                                                                alignItems: 'center',
                                                                                                justifyContent: 'flex-start',
                                                                                                width: '100%'
                                                                                            }}
                                                                                            flexDirection='row'
                                                                                        >
                                                                                            <Box sx={{ height: 'auto', pr: 1 }}>
                                                                                                <img
                                                                                                    style={{
                                                                                                        objectFit: 'cover',
                                                                                                        height: '25px',
                                                                                                        width: 'auto'
                                                                                                    }}
                                                                                                    src={
                                                                                                        agent.instructions
                                                                                                            ? multiagent_supervisorPNG
                                                                                                            : multiagent_workerPNG
                                                                                                    }
                                                                                                    alt='agentPNG'
                                                                                                />
                                                                                            </Box>
                                                                                            <div>{agent.agentName}</div>
                                                                                        </Stack>
                                                                                        {agent.usedTools && agent.usedTools.length > 0 && (
                                                                                            <div
                                                                                                style={{
                                                                                                    display: 'block',
                                                                                                    flexDirection: 'row',
                                                                                                    width: '100%'
                                                                                                }}
                                                                                            >
                                                                                                {agent.usedTools.map((tool, index) => {
                                                                                                    return tool !== null ? (
                                                                                                        <Chip
                                                                                                            size='small'
                                                                                                            key={index}
                                                                                                            label={tool.tool}
                                                                                                            component='a'
                                                                                                            sx={{
                                                                                                                mr: 1,
                                                                                                                mt: 1,
                                                                                                                borderColor: tool.error
                                                                                                                    ? 'error.main'
                                                                                                                    : undefined,
                                                                                                                color: tool.error
                                                                                                                    ? 'error.main'
                                                                                                                    : undefined
                                                                                                            }}
                                                                                                            variant='outlined'
                                                                                                            clickable
                                                                                                            icon={
                                                                                                                <IconTool
                                                                                                                    size={15}
                                                                                                                    color={
                                                                                                                        tool.error
                                                                                                                            ? theme.palette
                                                                                                                                  .error
                                                                                                                                  .main
                                                                                                                            : undefined
                                                                                                                    }
                                                                                                                />
                                                                                                            }
                                                                                                            onClick={() =>
                                                                                                                onSourceDialogClick(
                                                                                                                    tool,
                                                                                                                    'Used Tools'
                                                                                                                )
                                                                                                            }
                                                                                                        />
                                                                                                    ) : null
                                                                                                })}
                                                                                            </div>
                                                                                        )}
                                                                                        {agent.state &&
                                                                                            Object.keys(agent.state).length > 0 && (
                                                                                                <div
                                                                                                    style={{
                                                                                                        display: 'block',
                                                                                                        flexDirection: 'row',
                                                                                                        width: '100%'
                                                                                                    }}
                                                                                                >
                                                                                                    <Chip
                                                                                                        size='small'
                                                                                                        label={'State'}
                                                                                                        component='a'
                                                                                                        sx={{ mr: 1, mt: 1 }}
                                                                                                        variant='outlined'
                                                                                                        clickable
                                                                                                        icon={
                                                                                                            <IconDeviceSdCard size={15} />
                                                                                                        }
                                                                                                        onClick={() =>
                                                                                                            onSourceDialogClick(
                                                                                                                agent.state,
                                                                                                                'State'
                                                                                                            )
                                                                                                        }
                                                                                                    />
                                                                                                </div>
                                                                                            )}
                                                                                        {agent.artifacts && (
                                                                                            <div
                                                                                                style={{
                                                                                                    display: 'flex',
                                                                                                    flexWrap: 'wrap',
                                                                                                    flexDirection: 'row',
                                                                                                    width: '100%',
                                                                                                    gap: '8px'
                                                                                                }}
                                                                                            >
                                                                                                {agentReasoningArtifacts(
                                                                                                    agent.artifacts
                                                                                                ).map((item, index) => {
                                                                                                    return item !== null ? (
                                                                                                        <>
                                                                                                            {renderArtifacts(
                                                                                                                item,
                                                                                                                index,
                                                                                                                true
                                                                                                            )}
                                                                                                        </>
                                                                                                    ) : null
                                                                                                })}
                                                                                            </div>
                                                                                        )}
                                                                                        {agent.messages.length > 0 && (
                                                                                            <MemoizedReactMarkdown
                                                                                                chatflowid={dialogProps.chatflow.id}
                                                                                            >
                                                                                                {agent.messages.length > 1
                                                                                                    ? agent.messages.join('\\n')
                                                                                                    : agent.messages[0]}
                                                                                            </MemoizedReactMarkdown>
                                                                                        )}
                                                                                        {agent.instructions && <p>{agent.instructions}</p>}
                                                                                        {agent.messages.length === 0 &&
                                                                                            !agent.instructions && <p>Finished</p>}
                                                                                        {agent.sourceDocuments &&
                                                                                            agent.sourceDocuments.length > 0 && (
                                                                                                <div
                                                                                                    style={{
                                                                                                        display: 'block',
                                                                                                        flexDirection: 'row',
                                                                                                        width: '100%'
                                                                                                    }}
                                                                                                >
                                                                                                    {removeDuplicateURL(agent).map(
                                                                                                        (source, index) => {
                                                                                                            const URL =
                                                                                                                source &&
                                                                                                                source.metadata &&
                                                                                                                source.metadata.source
                                                                                                                    ? isValidURL(
                                                                                                                          source.metadata
                                                                                                                              .source
                                                                                                                      )
                                                                                                                    : undefined
                                                                                                            return (
                                                                                                                <Chip
                                                                                                                    size='small'
                                                                                                                    key={index}
                                                                                                                    label={
                                                                                                                        URL
                                                                                                                            ? URL.pathname.substring(
                                                                                                                                  0,
                                                                                                                                  15
                                                                                                                              ) === '/'
                                                                                                                                ? URL.host
                                                                                                                                : `${URL.pathname.substring(
                                                                                                                                      0,
                                                                                                                                      15
                                                                                                                                  )}...`
                                                                                                                            : `${source.pageContent.substring(
                                                                                                                                  0,
                                                                                                                                  15
                                                                                                                              )}...`
                                                                                                                    }
                                                                                                                    component='a'
                                                                                                                    sx={{ mr: 1, mb: 1 }}
                                                                                                                    variant='outlined'
                                                                                                                    clickable
                                                                                                                    onClick={() =>
                                                                                                                        URL
                                                                                                                            ? onURLClick(
                                                                                                                                  source
                                                                                                                                      .metadata
                                                                                                                                      .source
                                                                                                                              )
                                                                                                                            : onSourceDialogClick(
                                                                                                                                  source
                                                                                                                              )
                                                                                                                    }
                                                                                                                />
                                                                                                            )
                                                                                                        }
                                                                                                    )}
                                                                                                </div>
                                                                                            )}
                                                                                    </CardContent>
                                                                                </Card>
                                                                            )
                                                                        })}
                                                                    </div>
                                                                )}
                                                                {message.usedTools && (
                                                                    <div style={{ display: 'block', flexDirection: 'row', width: '100%' }}>
                                                                        {message.usedTools.map((tool, index) => {
                                                                            return (
                                                                                <Chip
                                                                                    size='small'
                                                                                    key={index}
                                                                                    label={tool.tool}
                                                                                    component='a'
                                                                                    sx={{
                                                                                        mr: 1,
                                                                                        mt: 1,
                                                                                        borderColor: tool.error ? 'error.main' : undefined,
                                                                                        color: tool.error ? 'error.main' : undefined
                                                                                    }}
                                                                                    variant='outlined'
                                                                                    clickable
                                                                                    icon={
                                                                                        <IconTool
                                                                                            size={15}
                                                                                            color={
                                                                                                tool.error
                                                                                                    ? theme.palette.error.main
                                                                                                    : undefined
                                                                                            }
                                                                                        />
                                                                                    }
                                                                                    onClick={() => onSourceDialogClick(tool, 'Used Tools')}
                                                                                />
                                                                            )
                                                                        })}
                                                                    </div>
                                                                )}
                                                                {message.artifacts && (
                                                                    <div
                                                                        style={{
                                                                            display: 'flex',
                                                                            flexWrap: 'wrap',
                                                                            flexDirection: 'column',
                                                                            width: '100%'
                                                                        }}
                                                                    >
                                                                        {message.artifacts.map((item, index) => {
                                                                            return item !== null ? (
                                                                                <>{renderArtifacts(item, index)}</>
                                                                            ) : null
                                                                        })}
                                                                    </div>
                                                                )}
                                                                <div
                                                                    className='markdownanswer'
                                                                    style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
                                                                >
                                                                    <MemoizedReactMarkdown chatflowid={dialogProps.chatflow.id}>
                                                                        {message.message}
                                                                    </MemoizedReactMarkdown>
                                                                </div>
                                                                {message.fileAnnotations && (
                                                                    <div style={{ display: 'block', flexDirection: 'row', width: '100%' }}>
                                                                        {message.fileAnnotations.map((fileAnnotation, index) => {
                                                                            return (
                                                                                <Button
                                                                                    sx={{
                                                                                        fontSize: '0.85rem',
                                                                                        textTransform: 'none',
                                                                                        mb: 1,
                                                                                        mr: 1
                                                                                    }}
                                                                                    key={index}
                                                                                    variant='outlined'
                                                                                    onClick={() => downloadFile(fileAnnotation)}
                                                                                    endIcon={
                                                                                        <IconDownload color={theme.palette.primary.main} />
                                                                                    }
                                                                                >
                                                                                    {fileAnnotation.fileName}
                                                                                </Button>
                                                                            )
                                                                        })}
                                                                    </div>
                                                                )}
                                                                {message.sourceDocuments && (
                                                                    <div style={{ display: 'block', flexDirection: 'row', width: '100%' }}>
                                                                        {removeDuplicateURL(message).map((source, index) => {
                                                                            const URL =
                                                                                source.metadata && source.metadata.source
                                                                                    ? isValidURL(source.metadata.source)
                                                                                    : undefined
                                                                            return (
                                                                                <Chip
                                                                                    size='small'
                                                                                    key={index}
                                                                                    label={
                                                                                        URL
                                                                                            ? URL.pathname.substring(0, 15) === '/'
                                                                                                ? URL.host
                                                                                                : `${URL.pathname.substring(0, 15)}...`
                                                                                            : `${source.pageContent.substring(0, 15)}...`
                                                                                    }
                                                                                    component='a'
                                                                                    sx={{ mr: 1, mb: 1 }}
                                                                                    variant='outlined'
                                                                                    clickable
                                                                                    onClick={() =>
                                                                                        URL
                                                                                            ? onURLClick(source.metadata.source)
                                                                                            : onSourceDialogClick(source)
                                                                                    }
                                                                                />
                                                                            )
                                                                        })}
                                                                    </div>
                                                                )}
                                                                {message.type === 'apiMessage' && message.feedback ? (
                                                                    <Feedback
                                                                        content={message.feedback?.content || ''}
                                                                        rating={message.feedback?.rating}
                                                                    />
                                                                ) : null}
                                                            </div>
                                                        </Box>
                                                    )
                                                } else {
                                                    return (
                                                        <Box
                                                            sx={{
                                                                background: customization.isDarkMode
                                                                    ? theme.palette.divider
                                                                    : theme.palette.timeMessage.main,
                                                                p: 2
                                                            }}
                                                            key={index}
                                                            style={{ display: 'flex', justifyContent: 'center', alignContent: 'center' }}
                                                        >
                                                            {moment(message.message).format('MMMM Do YYYY, h:mm:ss a')}
                                                        </Box>
                                                    )
                                                }
                                            })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <SourceDocDialog show={sourceDialogOpen} dialogProps={sourceDialogProps} onCancel={() => setSourceDialogOpen(false)} />
                    <ConfirmDeleteMessageDialog
                        show={hardDeleteDialogOpen}
                        dialogProps={hardDeleteDialogProps}
                        onCancel={() => setHardDeleteDialogOpen(false)}
                        onConfirm={(hardDelete) => deleteMessages(hardDelete)}
                    />
                    {/* Delete Progress Modal */}
                    <Dialog
                        open={deleteModalOpen}
                        maxWidth='sm'
                        fullWidth
                        PaperProps={{
                            sx: {
                                borderRadius: '16px',
                                background: customization.isDarkMode
                                    ? 'linear-gradient(135deg, rgba(30,25,45,0.98) 0%, rgba(40,30,60,0.98) 100%)'
                                    : 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(245,240,255,0.98) 100%)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid rgba(156,39,176,0.15)',
                                boxShadow: '0 8px 32px rgba(156,39,176,0.15)'
                            }
                        }}
                    >
                        <DialogTitle
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1.5,
                                pb: 1,
                                fontWeight: 600,
                                background: 'linear-gradient(90deg, #f44336, #e91e63)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent'
                            }}
                        >
                            <IconEraser
                                size={24}
                                style={{
                                    color: '#f44336',
                                    animation: deleteProgress.phase === 'deleting' ? 'pulse 1.5s ease-in-out infinite' : 'none'
                                }}
                            />
                            Deleting Messages
                        </DialogTitle>
                        <DialogContent sx={{ pt: 2 }}>
                            <Box sx={{ mb: 2 }}>
                                <Typography
                                    variant='body2'
                                    sx={{
                                        mb: 1.5,
                                        color: deleteProgress.phase === 'error' ? '#f44336' : 'text.secondary',
                                        fontWeight: deleteProgress.phase === 'done' ? 500 : 400
                                    }}
                                >
                                    {deleteProgress.statusText}
                                </Typography>

                                {deleteProgress.phase !== 'error' && deleteProgress.phase !== 'idle' && (
                                    <LinearProgress
                                        variant={deleteProgress.phase === 'counting' ? 'indeterminate' : 'determinate'}
                                        value={deleteProgress.percent}
                                        sx={{
                                            height: 8,
                                            borderRadius: 4,
                                            backgroundColor: customization.isDarkMode ? 'rgba(244,67,54,0.15)' : 'rgba(244,67,54,0.1)',
                                            '& .MuiLinearProgress-bar': {
                                                borderRadius: 4,
                                                background:
                                                    deleteProgress.phase === 'done'
                                                        ? 'linear-gradient(90deg, #4caf50, #66bb6a)'
                                                        : 'linear-gradient(90deg, #f44336, #e91e63)',
                                                transition: 'transform 0.3s ease'
                                            }
                                        }}
                                    />
                                )}

                                {deleteProgress.totalMessages > 0 && deleteProgress.phase !== 'error' && (
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            mt: 1,
                                            opacity: 0.7
                                        }}
                                    >
                                        <Typography variant='caption'>
                                            {deleteProgress.deletedMessages > 0
                                                ? `${deleteProgress.deletedMessages.toLocaleString()} / ${deleteProgress.totalMessages.toLocaleString()} messages`
                                                : `${deleteProgress.totalMessages.toLocaleString()} messages`}
                                        </Typography>
                                        {deleteProgress.currentBatch > 0 && deleteProgress.phase === 'deleting' && (
                                            <Typography variant='caption'>Batch {deleteProgress.currentBatch}</Typography>
                                        )}
                                    </Box>
                                )}

                                {deleteProgress.phase === 'error' && deleteProgress.errorText && (
                                    <Typography
                                        variant='caption'
                                        sx={{
                                            display: 'block',
                                            mt: 1,
                                            p: 1.5,
                                            borderRadius: '8px',
                                            backgroundColor: 'rgba(244,67,54,0.08)',
                                            color: '#f44336',
                                            fontFamily: 'monospace',
                                            wordBreak: 'break-word'
                                        }}
                                    >
                                        {deleteProgress.errorText}
                                    </Typography>
                                )}
                            </Box>
                        </DialogContent>
                        {(deleteProgress.phase === 'done' || deleteProgress.phase === 'error') && (
                            <DialogActions sx={{ px: 3, pb: 2 }}>
                                <Button
                                    onClick={() => {
                                        setDeleteModalOpen(false)
                                        setDeleteProgress((prev) => ({ ...prev, phase: 'idle' }))
                                        if (deleteProgress.phase === 'done') {
                                            refresh(1, pageLimit, startDate, endDate, chatTypeFilter, feedbackTypeFilter)
                                        }
                                    }}
                                    sx={{
                                        borderRadius: '20px',
                                        px: 3,
                                        textTransform: 'none',
                                        color: deleteProgress.phase === 'done' ? '#4caf50' : '#f44336'
                                    }}
                                >
                                    {deleteProgress.phase === 'done' ? 'Done' : 'Close'}
                                </Button>
                            </DialogActions>
                        )}
                    </Dialog>
                    {/* Export Progress Modal */}
                    <Dialog
                        open={exportModalOpen}
                        maxWidth='sm'
                        fullWidth
                        PaperProps={{
                            sx: {
                                borderRadius: '16px',
                                background: customization.isDarkMode
                                    ? 'linear-gradient(135deg, rgba(30,25,45,0.98) 0%, rgba(40,30,60,0.98) 100%)'
                                    : 'linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(245,240,255,0.98) 100%)',
                                backdropFilter: 'blur(20px)',
                                border: '1px solid rgba(156,39,176,0.15)',
                                boxShadow: '0 8px 32px rgba(156,39,176,0.15)'
                            }
                        }}
                    >
                        <DialogTitle
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1.5,
                                pb: 1,
                                fontWeight: 600,
                                background: 'linear-gradient(90deg, #9c27b0, #673ab7)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent'
                            }}
                        >
                            <IconDownload
                                size={24}
                                style={{
                                    color: '#9c27b0',
                                    animation: exportProgress.phase === 'fetching' ? 'pulse 1.5s ease-in-out infinite' : 'none'
                                }}
                            />
                            Export Messages
                        </DialogTitle>
                        <DialogContent sx={{ pt: 2 }}>
                            <Box sx={{ mb: 2 }}>
                                <Typography
                                    variant='body2'
                                    sx={{
                                        mb: 1.5,
                                        color: exportProgress.phase === 'error' ? '#f44336' : 'text.secondary',
                                        fontWeight: exportProgress.phase === 'done' ? 500 : 400
                                    }}
                                >
                                    {exportProgress.statusText}
                                </Typography>

                                {exportProgress.phase !== 'error' && exportProgress.phase !== 'idle' && (
                                    <LinearProgress
                                        variant={exportProgress.phase === 'counting' ? 'indeterminate' : 'determinate'}
                                        value={exportProgress.percent}
                                        sx={{
                                            height: 8,
                                            borderRadius: 4,
                                            backgroundColor: customization.isDarkMode ? 'rgba(156,39,176,0.15)' : 'rgba(156,39,176,0.1)',
                                            '& .MuiLinearProgress-bar': {
                                                borderRadius: 4,
                                                background:
                                                    exportProgress.phase === 'done'
                                                        ? 'linear-gradient(90deg, #4caf50, #66bb6a)'
                                                        : 'linear-gradient(90deg, #9c27b0, #673ab7)',
                                                transition: 'transform 0.3s ease'
                                            }
                                        }}
                                    />
                                )}

                                {exportProgress.totalMessages > 0 && exportProgress.phase !== 'error' && (
                                    <Box
                                        sx={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            mt: 1,
                                            opacity: 0.7
                                        }}
                                    >
                                        <Typography variant='caption'>
                                            {exportProgress.fetchedMessages > 0
                                                ? `${exportProgress.fetchedMessages.toLocaleString()} / ${exportProgress.totalMessages.toLocaleString()} messages`
                                                : `${exportProgress.totalMessages.toLocaleString()} messages`}
                                        </Typography>
                                        {exportProgress.totalBatches > 0 && exportProgress.phase === 'fetching' && (
                                            <Typography variant='caption'>
                                                Batch {exportProgress.currentBatch}/{exportProgress.totalBatches}
                                            </Typography>
                                        )}
                                    </Box>
                                )}

                                {exportProgress.phase === 'error' && exportProgress.errorText && (
                                    <Typography
                                        variant='caption'
                                        sx={{
                                            display: 'block',
                                            mt: 1,
                                            p: 1.5,
                                            borderRadius: '8px',
                                            backgroundColor: 'rgba(244,67,54,0.08)',
                                            color: '#f44336',
                                            fontFamily: 'monospace',
                                            wordBreak: 'break-word'
                                        }}
                                    >
                                        {exportProgress.errorText}
                                    </Typography>
                                )}
                            </Box>
                        </DialogContent>
                        {(exportProgress.phase === 'done' || exportProgress.phase === 'error') && (
                            <DialogActions sx={{ px: 3, pb: 2 }}>
                                <Button
                                    onClick={() => {
                                        setExportModalOpen(false)
                                        setExportProgress((prev) => ({ ...prev, phase: 'idle' }))
                                    }}
                                    sx={{
                                        borderRadius: '20px',
                                        px: 3,
                                        textTransform: 'none',
                                        color: exportProgress.phase === 'done' ? '#4caf50' : '#9c27b0'
                                    }}
                                >
                                    {exportProgress.phase === 'done' ? 'Done' : 'Close'}
                                </Button>
                                {exportProgress.phase === 'error' && (
                                    <StyledButton
                                        variant='contained'
                                        onClick={() => {
                                            setExportModalOpen(false)
                                            setExportProgress((prev) => ({ ...prev, phase: 'idle' }))
                                            exportMessages()
                                        }}
                                        sx={{ borderRadius: '20px', px: 3, textTransform: 'none' }}
                                    >
                                        Retry
                                    </StyledButton>
                                )}
                            </DialogActions>
                        )}
                    </Dialog>
                </>
            </DialogContent>
        </Dialog>
    ) : null

    return createPortal(component, portalElement)
}

ViewMessagesDialog.propTypes = {
    show: PropTypes.bool,
    dialogProps: PropTypes.object,
    onCancel: PropTypes.func
}

export default ViewMessagesDialog
