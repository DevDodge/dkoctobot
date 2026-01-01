import { useState } from 'react'
import PropTypes from 'prop-types'
import { useSelector, useDispatch } from 'react-redux'
import moment from 'moment'
import { styled, alpha } from '@mui/material/styles'
import {
    Box,
    Chip,
    Paper,
    Skeleton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TableSortLabel,
    Tooltip,
    Typography,
    useTheme,
    Button
} from '@mui/material'
import { tableCellClasses } from '@mui/material/TableCell'
import FlowListMenu from '../button/FlowListMenu'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

import MoreItemsTooltip from '../tooltip/MoreItemsTooltip'
import chatflowFoldersApi from '@/api/chatflowFolders'
import { enqueueSnackbar as enqueueSnackbarAction, closeSnackbar as closeSnackbarAction } from '@/store/actions'
import { IconX } from '@tabler/icons-react'

const StyledTableCell = styled(TableCell)(({ theme }) => ({
    borderColor: theme.palette.grey[900] + 25,

    [`&.${tableCellClasses.head}`]: {
        color: theme.palette.grey[900]
    },
    [`&.${tableCellClasses.body}`]: {
        fontSize: 14,
        height: 64
    }
}))

const StyledTableRow = styled(TableRow)(() => ({
    // hide last border
    '&:last-child td, &:last-child th': {
        border: 0
    }
}))

const getLocalStorageKeyName = (name, isAgentCanvas) => {
    return (isAgentCanvas ? 'agentcanvas' : 'chatflowcanvas') + '_' + name
}

const getFolderStyle = (folderId, theme) => {
    // Generate simple hash from folderId
    let hash = 0
    if (folderId) {
        for (let i = 0; i < folderId.length; i++) {
            hash = folderId.charCodeAt(i) + ((hash << 5) - hash)
        }
    }

    // Define palette colors (using theme palette)
    const colors = [
        theme.palette.primary.main,
        theme.palette.secondary.main,
        theme.palette.error.main,
        theme.palette.warning.main,
        theme.palette.info.main,
        theme.palette.success.main,
        '#9c27b0', // purple
        '#ff9800', // orange
        '#009688', // teal
        '#673ab7', // deep purple
        '#e91e63', // pink
        '#3f51b5' // indigo
    ]

    const color = colors[Math.abs(hash) % colors.length]

    return {
        backgroundColor: alpha(color, theme.palette.mode === 'dark' ? 0.2 : 0.1),
        color: color,
        border: `1px solid ${alpha(color, 0.3)}`,
        '& .MuiChip-deleteIcon': {
            color: color,
            opacity: 0.7,
            '&:hover': {
                opacity: 1
            }
        }
    }
}

export const FlowListTable = ({
    data,
    images = {},
    icons = {},
    isLoading,
    filterFunction,
    updateFlowsApi,
    setError,
    isAgentCanvas,
    isAgentflowV2,
    currentPage,
    pageLimit,
    folders = [],
    onFlowUpdate
}) => {
    const { hasPermission } = useAuth()
    const isActionsAvailable = isAgentCanvas
        ? hasPermission('agentflows:update,agentflows:delete,agentflows:config,agentflows:domains,templates:flowexport,agentflows:export')
        : hasPermission('chatflows:update,chatflows:delete,chatflows:config,chatflows:domains,templates:flowexport,chatflows:export')
    const theme = useTheme()
    const customization = useSelector((state) => state.customization)
    const dispatch = useDispatch()
    const enqueueSnackbar = (...args) => dispatch(enqueueSnackbarAction(...args))
    const closeSnackbar = (...args) => dispatch(closeSnackbarAction(...args))

    const localStorageKeyOrder = getLocalStorageKeyName('order', isAgentCanvas)
    const localStorageKeyOrderBy = getLocalStorageKeyName('orderBy', isAgentCanvas)

    const [order, setOrder] = useState(localStorage.getItem(localStorageKeyOrder) || 'desc')
    const [orderBy, setOrderBy] = useState(localStorage.getItem(localStorageKeyOrderBy) || 'updatedDate')

    const handleRequestSort = (property) => {
        const isAsc = orderBy === property && order === 'asc'
        const newOrder = isAsc ? 'desc' : 'asc'
        setOrder(newOrder)
        setOrderBy(property)
        localStorage.setItem(localStorageKeyOrder, newOrder)
        localStorage.setItem(localStorageKeyOrderBy, property)
    }

    const onFlowClick = (row) => {
        if (!isAgentCanvas) {
            return `/canvas/${row.id}`
        } else {
            return isAgentflowV2 ? `/v2/agentcanvas/${row.id}` : `/agentcanvas/${row.id}`
        }
    }

    const handleRemoveFromFolder = async (chatflow) => {
        try {
            await chatflowFoldersApi.moveChatflowToFolder(chatflow.id, null)

            // Refresh flow list
            const params = {
                page: currentPage,
                limit: pageLimit
            }
            if (isAgentCanvas && isAgentflowV2) {
                await updateFlowsApi.request('AGENTFLOW', params)
            } else if (isAgentCanvas) {
                await updateFlowsApi.request('MULTIAGENT', params)
            } else {
                await updateFlowsApi.request(params)
            }
            if (onFlowUpdate) onFlowUpdate()

            enqueueSnackbar({
                message: 'Chatflow removed from folder',
                options: {
                    key: new Date().getTime() + Math.random(),
                    variant: 'success',
                    autoHideDuration: 2000
                }
            })
        } catch (error) {
            enqueueSnackbar({
                message:
                    typeof error.response?.data === 'object'
                        ? error.response.data.message
                        : error.response?.data || 'Error removing chatflow from folder',
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

    const sortedData = data
        ? [...data].sort((a, b) => {
              if (orderBy === 'name') {
                  return order === 'asc' ? (a.name || '').localeCompare(b.name || '') : (b.name || '').localeCompare(a.name || '')
              } else if (orderBy === 'updatedDate') {
                  return order === 'asc'
                      ? new Date(a.updatedDate) - new Date(b.updatedDate)
                      : new Date(b.updatedDate) - new Date(a.updatedDate)
              }
              return 0
          })
        : []

    return (
        <>
            <TableContainer sx={{ border: 1, borderColor: theme.palette.grey[900] + 25, borderRadius: 2 }} component={Paper}>
                <Table sx={{ minWidth: 650 }} size='small' aria-label='a dense table'>
                    <TableHead
                        sx={{
                            backgroundColor: customization.isDarkMode ? theme.palette.common.black : theme.palette.grey[100],
                            height: 56
                        }}
                    >
                        <TableRow>
                            <StyledTableCell component='th' scope='row' style={{ width: '20%' }} key='0'>
                                <TableSortLabel active={orderBy === 'name'} direction={order} onClick={() => handleRequestSort('name')}>
                                    Name
                                </TableSortLabel>
                            </StyledTableCell>
                            <StyledTableCell style={{ width: '25%' }} key='1'>
                                Category
                            </StyledTableCell>
                            <StyledTableCell style={{ width: '15%' }} key='folder'>
                                Folder
                            </StyledTableCell>
                            <StyledTableCell style={{ width: '25%' }} key='2'>
                                Nodes
                            </StyledTableCell>
                            <StyledTableCell style={{ width: '15%' }} key='3'>
                                <TableSortLabel
                                    active={orderBy === 'updatedDate'}
                                    direction={order}
                                    onClick={() => handleRequestSort('updatedDate')}
                                >
                                    Last Modified Date
                                </TableSortLabel>
                            </StyledTableCell>
                            {isActionsAvailable && (
                                <StyledTableCell style={{ width: '10%' }} key='4'>
                                    Actions
                                </StyledTableCell>
                            )}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isLoading ? (
                            <>
                                <StyledTableRow>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    {isActionsAvailable && (
                                        <StyledTableCell>
                                            <Skeleton variant='text' />
                                        </StyledTableCell>
                                    )}
                                </StyledTableRow>
                                <StyledTableRow>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    <StyledTableCell>
                                        <Skeleton variant='text' />
                                    </StyledTableCell>
                                    {isActionsAvailable && (
                                        <StyledTableCell>
                                            <Skeleton variant='text' />
                                        </StyledTableCell>
                                    )}
                                </StyledTableRow>
                            </>
                        ) : (
                            <>
                                {sortedData.filter(filterFunction).map((row, index) => (
                                    <StyledTableRow key={index}>
                                        <StyledTableCell key='0'>
                                            <Tooltip title={row.templateName || row.name}>
                                                <Typography
                                                    sx={{
                                                        display: '-webkit-box',
                                                        fontSize: 14,
                                                        fontWeight: 500,
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: 'vertical',
                                                        textOverflow: 'ellipsis',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    <Link to={onFlowClick(row)} style={{ color: '#e91e63', textDecoration: 'none' }}>
                                                        {row.templateName || row.name}
                                                    </Link>
                                                </Typography>
                                            </Tooltip>
                                        </StyledTableCell>
                                        <StyledTableCell key='1'>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'row',
                                                    flexWrap: 'wrap',
                                                    marginTop: 5
                                                }}
                                            >
                                                &nbsp;
                                                {row.category &&
                                                    row.category
                                                        .split(';')
                                                        .map((tag, index) => (
                                                            <Chip key={index} label={tag} style={{ marginRight: 5, marginBottom: 5 }} />
                                                        ))}
                                            </div>
                                        </StyledTableCell>
                                        <StyledTableCell key='folder'>
                                            {row.folderId && folders.find((f) => f.id === row.folderId) && (
                                                <Chip
                                                    label={folders.find((f) => f.id === row.folderId).name}
                                                    size='small'
                                                    onDelete={() => handleRemoveFromFolder(row)}
                                                    sx={getFolderStyle(row.folderId, theme)}
                                                />
                                            )}
                                        </StyledTableCell>
                                        <StyledTableCell key='2'>
                                            {(images[row.id] || icons[row.id]) && (
                                                <Box
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'start',
                                                        gap: 1
                                                    }}
                                                >
                                                    {[
                                                        ...(images[row.id] || []).map((img) => ({
                                                            type: 'image',
                                                            src: img.imageSrc,
                                                            label: img.label
                                                        })),
                                                        ...(icons[row.id] || []).map((ic) => ({
                                                            type: 'icon',
                                                            icon: ic.icon,
                                                            color: ic.color,
                                                            title: ic.name
                                                        }))
                                                    ]
                                                        .slice(0, 5)
                                                        .map((item, index) => (
                                                            <Tooltip key={item.imageSrc || index} title={item.label} placement='top'>
                                                                {item.type === 'image' ? (
                                                                    <Box
                                                                        sx={{
                                                                            width: 30,
                                                                            height: 30,
                                                                            borderRadius: '50%',
                                                                            backgroundColor: customization.isDarkMode
                                                                                ? theme.palette.common.white
                                                                                : theme.palette.grey[300] + 75
                                                                        }}
                                                                    >
                                                                        <img
                                                                            style={{
                                                                                width: '100%',
                                                                                height: '100%',
                                                                                padding: 5,
                                                                                objectFit: 'contain'
                                                                            }}
                                                                            alt=''
                                                                            src={item.src}
                                                                        />
                                                                    </Box>
                                                                ) : (
                                                                    <div
                                                                        style={{
                                                                            width: 30,
                                                                            height: 30,
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            justifyContent: 'center'
                                                                        }}
                                                                    >
                                                                        <item.icon size={25} color={item.color} />
                                                                    </div>
                                                                )}
                                                            </Tooltip>
                                                        ))}

                                                    {(images[row.id]?.length || 0) + (icons[row.id]?.length || 0) > 5 && (
                                                        <MoreItemsTooltip
                                                            images={[
                                                                ...(images[row.id]?.slice(5) || []),
                                                                ...(
                                                                    icons[row.id]?.slice(Math.max(0, 5 - (images[row.id]?.length || 0))) ||
                                                                    []
                                                                ).map((ic) => ({ label: ic.name }))
                                                            ]}
                                                        >
                                                            <Typography
                                                                sx={{
                                                                    alignItems: 'center',
                                                                    display: 'flex',
                                                                    fontSize: '.9rem',
                                                                    fontWeight: 200
                                                                }}
                                                            >
                                                                + {(images[row.id]?.length || 0) + (icons[row.id]?.length || 0) - 5} More
                                                            </Typography>
                                                        </MoreItemsTooltip>
                                                    )}
                                                </Box>
                                            )}
                                        </StyledTableCell>
                                        <StyledTableCell key='3'>
                                            {moment(row.updatedDate).format('MMMM Do, YYYY HH:mm:ss')}
                                        </StyledTableCell>
                                        {isActionsAvailable && (
                                            <StyledTableCell key='4'>
                                                <Stack
                                                    direction={{ xs: 'column', sm: 'row' }}
                                                    spacing={1}
                                                    justifyContent='center'
                                                    alignItems='center'
                                                >
                                                    <FlowListMenu
                                                        isAgentCanvas={isAgentCanvas}
                                                        isAgentflowV2={isAgentflowV2}
                                                        chatflow={row}
                                                        setError={setError}
                                                        updateFlowsApi={updateFlowsApi}
                                                        currentPage={currentPage}
                                                        pageLimit={pageLimit}
                                                        onFlowUpdate={onFlowUpdate}
                                                    />
                                                </Stack>
                                            </StyledTableCell>
                                        )}
                                    </StyledTableRow>
                                ))}
                            </>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </>
    )
}

FlowListTable.propTypes = {
    data: PropTypes.array,
    images: PropTypes.object,
    icons: PropTypes.object,
    isLoading: PropTypes.bool,
    filterFunction: PropTypes.func,
    updateFlowsApi: PropTypes.object,
    setError: PropTypes.func,
    isAgentCanvas: PropTypes.bool,
    isAgentflowV2: PropTypes.bool,
    currentPage: PropTypes.number,
    pageLimit: PropTypes.number,
    folders: PropTypes.array,
    onFlowUpdate: PropTypes.func
}
