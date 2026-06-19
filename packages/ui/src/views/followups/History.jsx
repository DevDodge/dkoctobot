import { useEffect, useState } from "react";

// material-ui
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Chip,
  Button,
  IconButton,
  Stack,
  Collapse,
  Tooltip,
  Skeleton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  useTheme,
} from "@mui/material";

// icons
import {
  IconRefresh,
  IconEye,
  IconRotate,
  IconCopy,
  IconX,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";

// API
import followupApi from "@/api/followup";

// ==============================|| DETAIL MODAL ||============================== //

const DetailModal = ({ open, log, onClose }) => {
  if (!log) return null;

  let parsedPayload = "";
  try {
    parsedPayload = log.payload
      ? JSON.stringify(JSON.parse(log.payload), null, 2)
      : "—";
  } catch {
    parsedPayload = log.payload || "—";
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Typography variant="h4">Webhook Detail</Typography>
          <IconButton onClick={onClose}>
            <IconX size={18} />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Status
            </Typography>
            <Chip
              label={log.status}
              color={
                log.status === "sent"
                  ? "success"
                  : log.status === "failed"
                  ? "error"
                  : "default"
              }
            />
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Session ID
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
              {log.chatId}
            </Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Step
            </Typography>
            <Typography variant="body2">
              {log.stepName} (#{log.stepOrder})
            </Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Webhook URL
            </Typography>
            <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
              {log.webhookUrl}
            </Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Response ({log.responseStatus || "No response"})
            </Typography>
            <Paper
              variant="outlined"
              sx={{ p: 1.5, maxHeight: 200, overflow: "auto" }}
            >
              <Typography
                variant="body2"
                component="pre"
                sx={{ fontSize: 12, whiteSpace: "pre-wrap" }}
              >
                {log.responseBody || "No response body"}
              </Typography>
            </Paper>
          </Box>
          {log.errorMessage && (
            <Box>
              <Typography variant="subtitle2" gutterBottom color="error">
                Error
              </Typography>
              <Typography variant="body2" color="error">
                {log.errorMessage}
              </Typography>
            </Box>
          )}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Payload
            </Typography>
            <Paper
              variant="outlined"
              sx={{ p: 1.5, maxHeight: 300, overflow: "auto" }}
            >
              <Typography
                variant="body2"
                component="pre"
                sx={{ fontSize: 11, whiteSpace: "pre-wrap" }}
              >
                {parsedPayload}
              </Typography>
            </Paper>
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Timeline
            </Typography>
            <Typography variant="body2">
              Fired:{" "}
              {log.firedAt ? new Date(log.firedAt).toLocaleString() : "—"}
            </Typography>
            <Typography variant="body2">
              Created:{" "}
              {log.createdDate
                ? new Date(log.createdDate).toLocaleString()
                : "—"}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => navigator.clipboard.writeText(log.payload || "")}
          startIcon={<IconCopy size={16} />}
        >
          Copy Payload
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

// ==============================|| LEVEL 3: SESSION ROW (expandable to webhooks) ||============================== //

const SessionRow = ({ chatflowId, session, onRetry }) => {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailLog, setDetailLog] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const handleExpand = async () => {
    if (!open && logs.length === 0) {
      setLoading(true);
      try {
        const res = await followupApi.getLogsBySession(
          chatflowId,
          session.chatId
        );
        setLogs(res.data || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    setOpen(!open);
  };

  const statusColor = (status) => {
    switch (status) {
      case "sent":
        return "success";
      case "failed":
        return "error";
      case "cancelled":
        return "default";
      default:
        return "warning";
    }
  };

  return (
    <>
      <TableRow
        hover
        sx={{ cursor: "pointer", bgcolor: "action.hover" }}
        onClick={handleExpand}
      >
        <TableCell sx={{ pl: 4 }}>
          <IconButton size="small">
            {open ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
          </IconButton>
        </TableCell>
        <TableCell>
          <Typography
            variant="body2"
            sx={{ fontFamily: "monospace", fontSize: 12 }}
          >
            {session.chatId}
          </Typography>
        </TableCell>
        <TableCell align="center">
          <Chip
            label={session.sent}
            size="small"
            color="success"
            sx={{ minWidth: 28 }}
          />
        </TableCell>
        <TableCell align="center">
          <Chip
            label={session.failed}
            size="small"
            color={session.failed > 0 ? "error" : "default"}
            sx={{ minWidth: 28 }}
          />
        </TableCell>
        <TableCell align="center">{session.total}</TableCell>
        <TableCell>
          {session.lastFiredAt
            ? new Date(session.lastFiredAt).toLocaleString()
            : "—"}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={6} sx={{ p: 0, pl: 6 }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ py: 1, px: 2 }}>
                {loading ? (
                  <Skeleton height={40} />
                ) : logs.length === 0 ? (
                  <Typography variant="body2" color="textSecondary">
                    No logs
                  </Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Status</TableCell>
                        <TableCell>Step</TableCell>
                        <TableCell>Response</TableCell>
                        <TableCell>Fired At</TableCell>
                        <TableCell align="center">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell>
                            <Chip
                              label={log.status}
                              size="small"
                              color={statusColor(log.status)}
                            />
                          </TableCell>
                          <TableCell>
                            {log.stepName || `Step ${log.stepOrder}`}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={log.responseStatus || "—"}
                              size="small"
                              color={
                                log.responseStatus >= 200 &&
                                log.responseStatus < 300
                                  ? "success"
                                  : log.responseStatus
                                  ? "error"
                                  : "default"
                              }
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            {log.firedAt
                              ? new Date(log.firedAt).toLocaleString()
                              : "—"}
                          </TableCell>
                          <TableCell align="center">
                            <Stack
                              direction="row"
                              spacing={0.5}
                              justifyContent="center"
                            >
                              <Tooltip title="View Details">
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDetailLog(log);
                                    setDetailOpen(true);
                                  }}
                                >
                                  <IconEye size={16} />
                                </IconButton>
                              </Tooltip>
                              {log.status === "failed" && (
                                <Tooltip title="Retry">
                                  <IconButton
                                    size="small"
                                    color="warning"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRetry(log.id);
                                    }}
                                  >
                                    <IconRotate size={16} />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
      <DetailModal
        open={detailOpen}
        log={detailLog}
        onClose={() => setDetailOpen(false)}
      />
    </>
  );
};

// ==============================|| LEVEL 1: CHATFLOW ROW (expands to sessions) ||============================== //

const ChatflowRow = ({ row, onRetry, sessionFilter }) => {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");

  const handleExpand = async () => {
    if (!open && sessions.length === 0) {
      setLoading(true);
      try {
        const res = await followupApi.getLogsByChatflowSessions(row.chatflowId);
        setSessions(res.data || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    setOpen(!open);
  };

  // Auto-expand if session filter matches
  useEffect(() => {
    if (sessionFilter && !open) {
      handleExpand();
    }
  }, [sessionFilter]);

  const filteredSessions = sessions.filter((s) =>
    !sessionSearch && !sessionFilter
      ? true
      : (s.chatId || "")
          .toLowerCase()
          .includes((sessionSearch || sessionFilter || "").toLowerCase())
  );

  return (
    <>
      <TableRow
        hover
        sx={{
          cursor: "pointer",
          "& > *": { borderBottom: open ? "unset" : undefined },
        }}
        onClick={handleExpand}
      >
        <TableCell padding="checkbox">
          <IconButton size="small">
            {open ? (
              <IconChevronDown size={16} />
            ) : (
              <IconChevronRight size={16} />
            )}
          </IconButton>
        </TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={500}>
            {row.chatflowName}
          </Typography>
        </TableCell>
        <TableCell align="center">
          <Chip label={row.uniqueSessions} size="small" variant="outlined" />
        </TableCell>
        <TableCell align="center">
          <Chip
            label={row.sent}
            size="small"
            color="success"
            sx={{ minWidth: 32 }}
          />
        </TableCell>
        <TableCell align="center">
          <Chip
            label={row.failed}
            size="small"
            color={row.failed > 0 ? "error" : "default"}
            sx={{ minWidth: 32 }}
          />
        </TableCell>
        <TableCell align="center">{row.total}</TableCell>
        <TableCell>
          {row.lastFiredAt ? new Date(row.lastFiredAt).toLocaleString() : "—"}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={7}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ my: 1 }}>
              {loading ? (
                <Stack spacing={1} sx={{ p: 2 }}>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} height={36} />
                  ))}
                </Stack>
              ) : sessions.length === 0 ? (
                <Typography variant="body2" color="textSecondary" sx={{ p: 2 }}>
                  No sessions
                </Typography>
              ) : (
                <>
                  <Box sx={{ px: 2, pt: 1, pb: 1 }}>
                    <TextField
                      size="small"
                      placeholder="Search session ID..."
                      value={sessionSearch}
                      onChange={(e) => setSessionSearch(e.target.value)}
                      sx={{ minWidth: 250 }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Box>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell width={40} />
                        <TableCell>Session ID</TableCell>
                        <TableCell align="center">Sent</TableCell>
                        <TableCell align="center">Failed</TableCell>
                        <TableCell align="center">Total</TableCell>
                        <TableCell>Last Fired</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredSessions.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} align="center">
                            <Typography variant="body2" color="textSecondary">
                              No sessions match
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredSessions.map((s) => (
                          <SessionRow
                            key={s.chatId}
                            chatflowId={row.chatflowId}
                            session={s}
                            onRetry={onRetry}
                          />
                        ))
                      )}
                    </TableBody>
                  </Table>
                </>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
};

// ==============================|| HISTORY ||============================== //

const History = () => {
  const [grouped, setGrouped] = useState([]);
  const [isLoading, setLoading] = useState(true);
  const [chatflowSearch, setChatflowSearch] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await followupApi.getLogsGrouped();
      setGrouped(res.data || []);
    } catch (error) {
      console.error("Failed to fetch grouped logs:", error);
      setGrouped([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRetry = async (logId) => {
    try {
      await followupApi.retryWebhook(logId);
      fetchData();
    } catch (error) {
      console.error("Failed to retry:", error);
    }
  };

  // Filter chatflows
  const filteredGrouped = grouped.filter((row) => {
    const matchName =
      !chatflowSearch ||
      row.chatflowName?.toLowerCase().includes(chatflowSearch.toLowerCase());
    const matchStatus =
      statusFilter === "all" ||
      (statusFilter === "sent" && row.sent > 0) ||
      (statusFilter === "failed" && row.failed > 0) ||
      (statusFilter === "cancelled" && row.cancelled > 0);
    return matchName && matchStatus;
  });

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Typography variant="h4">Webhook History</Typography>
        <Button
          startIcon={<IconRefresh size={16} />}
          size="small"
          onClick={fetchData}
        >
          Refresh
        </Button>
      </Stack>

      {/* Advanced Filters */}
      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }} flexWrap="wrap">
        <TextField
          size="small"
          placeholder="Search chatflow name..."
          value={chatflowSearch}
          onChange={(e) => setChatflowSearch(e.target.value)}
          sx={{ minWidth: 200 }}
        />
        <TextField
          size="small"
          placeholder="Search session ID..."
          value={sessionSearch}
          onChange={(e) => setSessionSearch(e.target.value)}
          sx={{ minWidth: 200 }}
        />
        <TextField
          size="small"
          select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 140 }}
          label="Status"
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="sent">Sent</MenuItem>
          <MenuItem value="failed">Failed</MenuItem>
          <MenuItem value="cancelled">Cancelled</MenuItem>
        </TextField>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>Chatflow</TableCell>
              <TableCell align="center">Sessions</TableCell>
              <TableCell align="center">Sent</TableCell>
              <TableCell align="center">Failed</TableCell>
              <TableCell align="center">Total</TableCell>
              <TableCell>Last Fired</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredGrouped.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    sx={{ py: 3 }}
                  >
                    {chatflowSearch || statusFilter !== "all"
                      ? "No results match your filters"
                      : "No webhook history yet"}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredGrouped.map((row) => (
                <ChatflowRow
                  key={row.chatflowId}
                  row={row}
                  onRetry={handleRetry}
                  sessionFilter={sessionSearch}
                />
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default History;
