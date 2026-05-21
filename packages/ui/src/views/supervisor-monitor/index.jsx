import { useEffect, useState } from 'react'

// material-ui
import {
    Box,
    Stack,
    TextField,
    Button,
    Grid,
    Chip,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Typography,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Card,
    CardContent,
    Skeleton,
    useTheme
} from '@mui/material'

// project imports
import MainCard from '@/ui-component/cards/MainCard'
import ErrorBoundary from '@/ErrorBoundary'
import ViewHeader from '@/layout/MainLayout/ViewHeader'

// API
import useApi from '@/hooks/useApi'
import supervisorLogsApi from '@/api/supervisorlogs'
import chatflowsApi from '@/api/chatflows'

// icons
import { IconShieldCheck, IconAlertTriangle, IconRefresh, IconEye, IconX } from '@tabler/icons-react'

// ==============================|| SUPERVISOR MONITOR ||============================== //

const SupervisorMonitor = () => {
    const theme = useTheme()

    const getAllLogs = useApi(supervisorLogsApi.getAllSupervisorLogs)
    const getStats = useApi(supervisorLogsApi.getSupervisorStats)
    const getChatflows = useApi(chatflowsApi.getAllChatflows)

    const [logs, setLogs] = useState([])
    const [total, setTotal] = useState(0)
    const [stats, setStats] = useState({ totalViolations: 0, totalCorrected: 0, totalFailed: 0, correctionRate: 0 })
    const [chatflows, setChatflows] = useState([])
    const [isLoading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [selectedLog, setSelectedLog] = useState(null)
    const [openDialog, setOpenDialog] = useState(false)
    const [filters, setFilters] = useState({
        chatflowid: '',
        startDate: '',
        endDate: ''
    })

    const fetchData = () => {
        setLoading(true)
        const params = { limit: 200, offset: 0 }
        if (filters.chatflowid) params.chatflowid = filters.chatflowid
        if (filters.startDate) params.startDate = filters.startDate
        if (filters.endDate) params.endDate = filters.endDate
        getAllLogs.request(params)
        getStats.request(filters.chatflowid ? { chatflowid: filters.chatflowid } : {})
    }

    useEffect(() => {
        fetchData()
        getChatflows.request()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (getAllLogs.data) {
            setLogs(getAllLogs.data.logs || [])
            setTotal(getAllLogs.data.total || 0)
        }
    }, [getAllLogs.data])

    useEffect(() => {
        if (getStats.data) {
            setStats(getStats.data)
        }
    }, [getStats.data])

    useEffect(() => {
        if (getChatflows.data) {
            setChatflows(getChatflows.data)
        }
    }, [getChatflows.data])

    useEffect(() => {
        setLoading(getAllLogs.loading)
    }, [getAllLogs.loading])

    useEffect(() => {
        setError(getAllLogs.error)
    }, [getAllLogs.error])

    const getChatflowName = (chatflowid) => {
        const cf = chatflows.find((c) => c.id === chatflowid)
        return cf?.name || chatflowid?.substring(0, 8) + '...'
    }

    const formatDate = (dateStr) => {
        const d = new Date(dateStr)
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }

    const parseViolations = (violationsStr) => {
        try {
            return JSON.parse(violationsStr)
        } catch {
            return [violationsStr]
        }
    }

    return (
        <MainCard>
            {error ? (
                <ErrorBoundary error={error} />
            ) : (
                <Stack flexDirection='column' sx={{ gap: 3 }}>
                    <ViewHeader
                        title='🛡️ Supervisor Monitor'
                        description='Track and monitor all Output Supervisor violations across your chatflows'
                    />

                    {/* Stats Cards */}
                    <Grid container spacing={2}>
                        <Grid item xs={6} md={3}>
                            <Card
                                sx={{
                                    background: `linear-gradient(135deg, ${theme.palette.error.dark}22, ${theme.palette.error.main}11)`,
                                    border: `1px solid ${theme.palette.error.main}33`
                                }}
                            >
                                <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                                    <Typography variant='caption' color='text.secondary'>
                                        Total Violations
                                    </Typography>
                                    <Typography variant='h3' sx={{ color: theme.palette.error.main }}>
                                        {isLoading ? <Skeleton width={40} /> : stats.totalViolations}
                                    </Typography>
                                </CardContent>
                            </Card>
                        </Grid>
                        <Grid item xs={6} md={3}>
                            <Card
                                sx={{
                                    background: `linear-gradient(135deg, ${theme.palette.success.dark}22, ${theme.palette.success.main}11)`,
                                    border: `1px solid ${theme.palette.success.main}33`
                                }}
                            >
                                <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                                    <Typography variant='caption' color='text.secondary'>
                                        Corrected
                                    </Typography>
                                    <Typography variant='h3' sx={{ color: theme.palette.success.main }}>
                                        {isLoading ? <Skeleton width={40} /> : stats.totalCorrected}
                                    </Typography>
                                </CardContent>
                            </Card>
                        </Grid>
                        <Grid item xs={6} md={3}>
                            <Card
                                sx={{
                                    background: `linear-gradient(135deg, ${theme.palette.warning.dark}22, ${theme.palette.warning.main}11)`,
                                    border: `1px solid ${theme.palette.warning.main}33`
                                }}
                            >
                                <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                                    <Typography variant='caption' color='text.secondary'>
                                        Failed
                                    </Typography>
                                    <Typography variant='h3' sx={{ color: theme.palette.warning.main }}>
                                        {isLoading ? <Skeleton width={40} /> : stats.totalFailed}
                                    </Typography>
                                </CardContent>
                            </Card>
                        </Grid>
                        <Grid item xs={6} md={3}>
                            <Card
                                sx={{
                                    background: `linear-gradient(135deg, ${theme.palette.primary.dark}22, ${theme.palette.primary.main}11)`,
                                    border: `1px solid ${theme.palette.primary.main}33`
                                }}
                            >
                                <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
                                    <Typography variant='caption' color='text.secondary'>
                                        Correction Rate
                                    </Typography>
                                    <Typography variant='h3' sx={{ color: theme.palette.primary.main }}>
                                        {isLoading ? <Skeleton width={40} /> : `${stats.correctionRate}%`}
                                    </Typography>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>

                    {/* Filters */}
                    <Box>
                        <Grid container spacing={2} alignItems='center'>
                            <Grid item xs={12} md={3}>
                                <TextField
                                    select
                                    fullWidth
                                    label='Chatflow'
                                    value={filters.chatflowid}
                                    onChange={(e) => setFilters({ ...filters, chatflowid: e.target.value })}
                                    size='small'
                                    SelectProps={{ native: true }}
                                >
                                    <option value=''>All Chatflows</option>
                                    {chatflows.map((cf) => (
                                        <option key={cf.id} value={cf.id}>
                                            {cf.name}
                                        </option>
                                    ))}
                                </TextField>
                            </Grid>
                            <Grid item xs={12} md={2}>
                                <TextField
                                    fullWidth
                                    label='Start Date'
                                    type='date'
                                    value={filters.startDate}
                                    onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                                    size='small'
                                    InputLabelProps={{ shrink: true }}
                                />
                            </Grid>
                            <Grid item xs={12} md={2}>
                                <TextField
                                    fullWidth
                                    label='End Date'
                                    type='date'
                                    value={filters.endDate}
                                    onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                                    size='small'
                                    InputLabelProps={{ shrink: true }}
                                />
                            </Grid>
                            <Grid item xs={12} md={3}>
                                <Stack direction='row' spacing={1}>
                                    <Button variant='contained' onClick={fetchData} size='small' startIcon={<IconRefresh size={16} />}>
                                        Apply
                                    </Button>
                                    <Button
                                        variant='outlined'
                                        onClick={() => {
                                            setFilters({ chatflowid: '', startDate: '', endDate: '' })
                                            setTimeout(fetchData, 100)
                                        }}
                                        size='small'
                                    >
                                        Reset
                                    </Button>
                                </Stack>
                            </Grid>
                        </Grid>
                    </Box>

                    {/* Violations Table */}
                    {isLoading ? (
                        <Stack spacing={1}>
                            {[1, 2, 3, 4, 5].map((i) => (
                                <Skeleton key={i} variant='rectangular' height={50} />
                            ))}
                        </Stack>
                    ) : logs.length > 0 ? (
                        <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
                            <Table size='small'>
                                <TableHead>
                                    <TableRow sx={{ backgroundColor: theme.palette.grey[100] }}>
                                        <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Chatflow</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Violations</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Attempt</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                                        <TableCell sx={{ fontWeight: 600 }} align='center'>
                                            Details
                                        </TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {logs.map((log) => {
                                        const violations = parseViolations(log.violations)
                                        return (
                                            <TableRow
                                                key={log.id}
                                                hover
                                                sx={{ cursor: 'pointer', '&:hover': { backgroundColor: theme.palette.action.hover } }}
                                                onClick={() => {
                                                    setSelectedLog(log)
                                                    setOpenDialog(true)
                                                }}
                                            >
                                                <TableCell>
                                                    <Typography variant='body2'>{formatDate(log.createdDate)}</Typography>
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={log.chatflowName || getChatflowName(log.chatflowid)}
                                                        size='small'
                                                        variant='outlined'
                                                        sx={{ maxWidth: 150 }}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Stack direction='row' spacing={0.5} flexWrap='wrap' useFlexGap>
                                                        {violations.slice(0, 2).map((v, i) => (
                                                            <Chip
                                                                key={i}
                                                                label={
                                                                    typeof v === 'string'
                                                                        ? v.substring(0, 40) + (v.length > 40 ? '...' : '')
                                                                        : String(v)
                                                                }
                                                                size='small'
                                                                color='error'
                                                                variant='outlined'
                                                                sx={{ fontSize: '0.7rem' }}
                                                            />
                                                        ))}
                                                        {violations.length > 2 && (
                                                            <Chip label={`+${violations.length - 2}`} size='small' color='default' />
                                                        )}
                                                    </Stack>
                                                </TableCell>
                                                <TableCell>
                                                    <Chip label={`#${log.attempt}`} size='small' color='default' variant='outlined' />
                                                </TableCell>
                                                <TableCell>
                                                    {log.approved ? (
                                                        <Chip
                                                            icon={<IconShieldCheck size={14} />}
                                                            label='Corrected'
                                                            size='small'
                                                            color='success'
                                                            variant='filled'
                                                        />
                                                    ) : (
                                                        <Chip
                                                            icon={<IconAlertTriangle size={14} />}
                                                            label='Failed'
                                                            size='small'
                                                            color='error'
                                                            variant='filled'
                                                        />
                                                    )}
                                                </TableCell>
                                                <TableCell align='center'>
                                                    <IconButton
                                                        size='small'
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setSelectedLog(log)
                                                            setOpenDialog(true)
                                                        }}
                                                    >
                                                        <IconEye size={18} />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    ) : (
                        <Stack sx={{ alignItems: 'center', justifyContent: 'center', py: 8 }} flexDirection='column'>
                            <IconShieldCheck size={64} color={theme.palette.success.main} />
                            <Typography variant='h4' sx={{ mt: 2, color: theme.palette.text.secondary }}>
                                No Violations Found
                            </Typography>
                            <Typography variant='body2' color='text.secondary'>
                                The Output Supervisor hasn&apos;t detected any violations yet
                            </Typography>
                        </Stack>
                    )}

                    {/* Detail Dialog */}
                    <Dialog
                        open={openDialog}
                        onClose={() => setOpenDialog(false)}
                        maxWidth='md'
                        fullWidth
                        PaperProps={{ sx: { borderRadius: 3 } }}
                    >
                        {selectedLog && (
                            <>
                                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Stack direction='row' spacing={1} alignItems='center'>
                                        <IconShieldCheck size={24} />
                                        <Typography variant='h4'>Violation Details</Typography>
                                    </Stack>
                                    <IconButton onClick={() => setOpenDialog(false)} size='small'>
                                        <IconX size={18} />
                                    </IconButton>
                                </DialogTitle>
                                <DialogContent dividers>
                                    <Stack spacing={3}>
                                        {/* Meta Info */}
                                        <Grid container spacing={2}>
                                            <Grid item xs={6} md={3}>
                                                <Typography variant='caption' color='text.secondary'>
                                                    Chatflow
                                                </Typography>
                                                <Typography variant='body2' fontWeight={600}>
                                                    {selectedLog.chatflowName || getChatflowName(selectedLog.chatflowid)}
                                                </Typography>
                                            </Grid>
                                            <Grid item xs={6} md={3}>
                                                <Typography variant='caption' color='text.secondary'>
                                                    Session ID
                                                </Typography>
                                                <Typography variant='body2' fontWeight={600} sx={{ wordBreak: 'break-all' }}>
                                                    {selectedLog.sessionId || 'N/A'}
                                                </Typography>
                                            </Grid>
                                            <Grid item xs={6} md={3}>
                                                <Typography variant='caption' color='text.secondary'>
                                                    Attempt
                                                </Typography>
                                                <Typography variant='body2' fontWeight={600}>
                                                    #{selectedLog.attempt}
                                                </Typography>
                                            </Grid>
                                            <Grid item xs={6} md={3}>
                                                <Typography variant='caption' color='text.secondary'>
                                                    Status
                                                </Typography>
                                                <Box>
                                                    {selectedLog.approved ? (
                                                        <Chip
                                                            icon={<IconShieldCheck size={14} />}
                                                            label='Corrected'
                                                            size='small'
                                                            color='success'
                                                        />
                                                    ) : (
                                                        <Chip
                                                            icon={<IconAlertTriangle size={14} />}
                                                            label='Failed'
                                                            size='small'
                                                            color='error'
                                                        />
                                                    )}
                                                </Box>
                                            </Grid>
                                        </Grid>

                                        {/* User Input */}
                                        <Box>
                                            <Typography variant='subtitle2' color='text.secondary' gutterBottom>
                                                💬 User Input
                                            </Typography>
                                            <Paper sx={{ p: 2, backgroundColor: theme.palette.grey[50], borderRadius: 2 }}>
                                                <Typography variant='body2' sx={{ whiteSpace: 'pre-wrap', direction: 'rtl' }}>
                                                    {selectedLog.userInput || 'N/A'}
                                                </Typography>
                                            </Paper>
                                        </Box>

                                        {/* Original Output (Rejected) */}
                                        <Box>
                                            <Typography variant='subtitle2' color='error.main' gutterBottom>
                                                ❌ Original Response (Rejected)
                                            </Typography>
                                            <Paper
                                                sx={{
                                                    p: 2,
                                                    backgroundColor: theme.palette.error.main + '08',
                                                    border: `1px solid ${theme.palette.error.main}33`,
                                                    borderRadius: 2
                                                }}
                                            >
                                                <Typography variant='body2' sx={{ whiteSpace: 'pre-wrap', direction: 'rtl' }}>
                                                    {selectedLog.originalOutput || 'N/A'}
                                                </Typography>
                                            </Paper>
                                        </Box>

                                        {/* Violations */}
                                        <Box>
                                            <Typography variant='subtitle2' color='text.secondary' gutterBottom>
                                                ⚠️ Violations
                                            </Typography>
                                            <Stack spacing={1}>
                                                {parseViolations(selectedLog.violations).map((v, i) => (
                                                    <Chip
                                                        key={i}
                                                        label={v}
                                                        color='error'
                                                        variant='outlined'
                                                        sx={{
                                                            justifyContent: 'flex-start',
                                                            height: 'auto',
                                                            py: 0.5,
                                                            '& .MuiChip-label': { whiteSpace: 'normal' }
                                                        }}
                                                    />
                                                ))}
                                            </Stack>
                                        </Box>

                                        {/* Feedback */}
                                        <Box>
                                            <Typography variant='subtitle2' color='text.secondary' gutterBottom>
                                                📝 Supervisor Feedback
                                            </Typography>
                                            <Paper
                                                sx={{
                                                    p: 2,
                                                    backgroundColor: theme.palette.warning.main + '08',
                                                    border: `1px solid ${theme.palette.warning.main}33`,
                                                    borderRadius: 2
                                                }}
                                            >
                                                <Typography variant='body2' sx={{ whiteSpace: 'pre-wrap', direction: 'rtl' }}>
                                                    {selectedLog.feedback || 'N/A'}
                                                </Typography>
                                            </Paper>
                                        </Box>

                                        {/* Corrected Output */}
                                        {selectedLog.correctedOutput && (
                                            <Box>
                                                <Typography variant='subtitle2' color='success.main' gutterBottom>
                                                    ✅ Corrected Response
                                                </Typography>
                                                <Paper
                                                    sx={{
                                                        p: 2,
                                                        backgroundColor: theme.palette.success.main + '08',
                                                        border: `1px solid ${theme.palette.success.main}33`,
                                                        borderRadius: 2
                                                    }}
                                                >
                                                    <Typography variant='body2' sx={{ whiteSpace: 'pre-wrap', direction: 'rtl' }}>
                                                        {selectedLog.correctedOutput}
                                                    </Typography>
                                                </Paper>
                                            </Box>
                                        )}

                                        {/* Confidence */}
                                        <Box>
                                            <Typography variant='caption' color='text.secondary'>
                                                Confidence: {(selectedLog.confidence * 100).toFixed(0)}% | Date:{' '}
                                                {formatDate(selectedLog.createdDate)}
                                            </Typography>
                                        </Box>
                                    </Stack>
                                </DialogContent>
                                <DialogActions>
                                    <Button onClick={() => setOpenDialog(false)}>Close</Button>
                                </DialogActions>
                            </>
                        )}
                    </Dialog>
                </Stack>
            )}
        </MainCard>
    )
}

export default SupervisorMonitor
