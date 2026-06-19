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
  TextField,
  useTheme,
} from "@mui/material";

// icons
import {
  IconTrash,
  IconRefresh,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";

// API
import followupApi from "@/api/followup";
import chatflowsApi from "@/api/chatflows";

// ==============================|| TIME REMAINING HELPER ||============================== //

const getTimeRemaining = (timestamp, delay) => {
  if (!timestamp || !delay) return "—";
  const firesAt = new Date(timestamp + delay);
  const now = new Date();
  const diff = firesAt - now;
  if (diff <= 0) return "Firing...";
  if (diff < 60000) return `${Math.ceil(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.ceil(diff / 60000)} min`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
  return `${Math.round(diff / 86400000)}d`;
};

// ==============================|| LEVEL 2: SESSION ROW ||============================== //

const SessionRow = ({ chatId, jobs, onCancel }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow
        hover
        sx={{ cursor: "pointer", bgcolor: "action.hover" }}
        onClick={() => setOpen(!open)}
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
            {chatId}
          </Typography>
        </TableCell>
        <TableCell align="center">
          <Chip
            label={jobs.length}
            size="small"
            color="warning"
            variant="filled"
            sx={{ minWidth: 28 }}
          />
        </TableCell>
        <TableCell>
          <Chip
            label={getTimeRemaining(jobs[0]?.timestamp, jobs[0]?.delay)}
            size="small"
            color="warning"
            variant="outlined"
          />
        </TableCell>
        <TableCell align="center">
          <Tooltip title="Cancel all for this session">
            <IconButton
              size="small"
              color="error"
              onClick={(e) => {
                e.stopPropagation();
                onCancel(jobs[0]?.data?.chatflowId, chatId);
              }}
            >
              <IconTrash size={16} />
            </IconButton>
          </Tooltip>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={5} sx={{ p: 0, pl: 6 }}>
            <Collapse in={open} timeout="auto" unmountOnExit>
              <Box sx={{ py: 1, px: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Step</TableCell>
                      <TableCell>Timeout</TableCell>
                      <TableCell>Scheduled At</TableCell>
                      <TableCell>Time Remaining</TableCell>
                      <TableCell>Webhook URL</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {jobs.map((job, idx) => (
                      <TableRow key={job.id || idx}>
                        <TableCell>
                          <Chip
                            label={`${job.data?.stepName || "Step"} #${
                              job.data?.stepOrder || "?"
                            }`}
                            size="small"
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell>
                          {job.data?.idleTimeout} {job.data?.idleTimeoutUnit}
                        </TableCell>
                        <TableCell>
                          {job.data?.scheduledAt
                            ? new Date(job.data.scheduledAt).toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={getTimeRemaining(job.timestamp, job.delay)}
                            size="small"
                            color="warning"
                            variant="filled"
                          />
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="body2"
                            noWrap
                            sx={{ maxWidth: 250 }}
                          >
                            {job.data?.webhookUrl || "—"}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Collapse>
          </TableCell>
        </TableRow>
      )}
    </>
  );
};

// ==============================|| LEVEL 1: CHATFLOW ROW ||============================== //

const ChatflowRow = ({
  chatflowId,
  chatflowName,
  sessions,
  onCancel,
  sessionFilter,
}) => {
  const [open, setOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const totalJobs = Object.values(sessions).reduce(
    (sum, jobs) => sum + jobs.length,
    0
  );
  const sessionCount = Object.keys(sessions).length;

  const filteredEntries = Object.entries(sessions).filter(([chatId]) =>
    !sessionSearch && !sessionFilter
      ? true
      : chatId
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
        onClick={() => setOpen(!open)}
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
            {chatflowName}
          </Typography>
        </TableCell>
        <TableCell align="center">
          <Chip label={sessionCount} size="small" variant="outlined" />
        </TableCell>
        <TableCell align="center">
          <Chip
            label={totalJobs}
            size="small"
            color="warning"
            variant="filled"
            sx={{ minWidth: 32 }}
          />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={4}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ my: 1 }}>
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
                    <TableCell align="center">Pending Steps</TableCell>
                    <TableCell>Next Fire</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} align="center">
                        <Typography variant="body2" color="textSecondary">
                          No sessions match
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredEntries.map(([chatId, jobs]) => (
                      <SessionRow
                        key={chatId}
                        chatId={chatId}
                        jobs={jobs}
                        onCancel={onCancel}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
};

// ==============================|| PENDING ||============================== //

const Pending = () => {
  const [grouped, setGrouped] = useState({});
  const [chatflowNames, setChatflowNames] = useState({});
  const [totalJobs, setTotalJobs] = useState(0);
  const [isLoading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [chatflowSearch, setChatflowSearch] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const [jobsRes, chatflowsRes] = await Promise.all([
        followupApi.getPendingJobs({ start: 0, end: 500 }),
        chatflowsApi.getAllChatflows(),
      ]);

      const jobs = jobsRes.data?.jobs || [];
      setTotalJobs(jobsRes.data?.total || 0);

      // Build chatflow name map
      const nameMap = {};
      const chatflows = chatflowsRes.data || [];
      chatflows.forEach((cf) => {
        nameMap[cf.id] = cf.name;
      });
      setChatflowNames(nameMap);

      // Group: chatflowId → chatId → jobs[]
      const group = {};
      jobs.forEach((job) => {
        const cfId = job.data?.chatflowId || "unknown";
        const cId = job.data?.chatId || "unknown";
        if (!group[cfId]) group[cfId] = {};
        if (!group[cfId][cId]) group[cfId][cId] = [];
        group[cfId][cId].push(job);
      });
      setGrouped(group);
    } catch (error) {
      console.error("Failed to fetch pending jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleCancel = async (chatflowId, chatId) => {
    try {
      await followupApi.cancelFollowUp(chatflowId, chatId);
      fetchData();
    } catch (error) {
      console.error("Failed to cancel:", error);
    }
  };

  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Typography variant="h4">Pending Follow-ups ({totalJobs})</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            size="small"
            variant={autoRefresh ? "contained" : "outlined"}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            Auto-refresh {autoRefresh ? "ON" : "OFF"}
          </Button>
          <Button
            startIcon={<IconRefresh size={16} />}
            size="small"
            onClick={fetchData}
          >
            Refresh
          </Button>
        </Stack>
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
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>Chatflow</TableCell>
              <TableCell align="center">Sessions</TableCell>
              <TableCell align="center">Pending Jobs</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 4 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : Object.keys(grouped).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    sx={{ py: 3 }}
                  >
                    No pending follow-ups
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              Object.entries(grouped)
                .filter(([chatflowId]) => {
                  const name = chatflowNames[chatflowId] || chatflowId;
                  return (
                    !chatflowSearch ||
                    name.toLowerCase().includes(chatflowSearch.toLowerCase())
                  );
                })
                .map(([chatflowId, sessions]) => (
                  <ChatflowRow
                    key={chatflowId}
                    chatflowId={chatflowId}
                    chatflowName={chatflowNames[chatflowId] || chatflowId}
                    sessions={sessions}
                    onCancel={handleCancel}
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

export default Pending;
