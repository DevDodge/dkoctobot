import { useEffect, useState } from "react";

// material-ui
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Collapse,
  Skeleton,
  Button,
  Stack,
  useTheme,
} from "@mui/material";

// icons
import {
  IconClock,
  IconCheck,
  IconX,
  IconSend,
  IconChevronDown,
  IconChevronRight,
  IconRefresh,
  IconPercentage,
  IconHeartbeat,
} from "@tabler/icons-react";

// API
import followupApi from "@/api/followup";

// ==============================|| STAT CARD ||============================== //

const StatCard = ({ title, value, icon, color, isLoading }) => {
  const theme = useTheme();
  return (
    <Card sx={{ height: "100%" }}>
      <CardContent>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="caption" color="textSecondary">
              {title}
            </Typography>
            <Typography variant="h3" sx={{ mt: 0.5 }}>
              {isLoading ? <Skeleton width={60} /> : value}
            </Typography>
          </Box>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: color ? `${color}20` : theme.palette.primary.light,
            }}
          >
            {icon}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

// ==============================|| COLLAPSIBLE ROW ||============================== //

const CollapsibleRow = ({ row, onEditConfig }) => {
  const [open, setOpen] = useState(false);

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
        <TableCell>{row.chatflowName || "Unnamed"}</TableCell>
        <TableCell>
          <Chip
            label="Enabled"
            size="small"
            color="success"
            variant="outlined"
          />
        </TableCell>
        <TableCell align="center">{row.stepsCount || 0}</TableCell>
        <TableCell align="center">{row.activeSessions || 0}</TableCell>
        <TableCell align="center">{row.pendingTasks || 0}</TableCell>
        <TableCell align="center">
          <Chip
            label={row.sentToday || 0}
            size="small"
            color="success"
            variant="filled"
            sx={{ minWidth: 32 }}
          />
        </TableCell>
        <TableCell align="center">
          <Chip
            label={row.failedToday || 0}
            size="small"
            color={row.failedToday > 0 ? "error" : "default"}
            variant="filled"
            sx={{ minWidth: 32 }}
          />
        </TableCell>
        <TableCell align="center">{row.totalFired || 0}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={9}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <Box sx={{ m: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <Typography variant="subtitle2" gutterBottom>
                    Steps Timeline
                  </Typography>
                  {row.steps && row.steps.length > 0 ? (
                    <Stack spacing={1}>
                      {row.steps.map((step, idx) => (
                        <Box
                          key={idx}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            pl: idx * 1.5,
                          }}
                        >
                          <IconClock size={14} />
                          <Typography variant="body2">
                            {step.idleTimeout} {step.idleTimeoutUnit} →{" "}
                            {step.stepName}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="textSecondary">
                      No steps configured
                    </Typography>
                  )}
                </Grid>
                <Grid item xs={12} md={4}>
                  <Typography variant="subtitle2" gutterBottom>
                    Quick Stats
                  </Typography>
                  <Typography variant="body2">
                    Active Sessions: {row.activeSessions || 0}
                  </Typography>
                  <Typography variant="body2">
                    Pending Tasks: {row.pendingTasks || 0}
                  </Typography>
                  <Typography variant="body2">
                    Total Fired: {row.totalFired || 0}
                  </Typography>
                </Grid>
                <Grid item xs={12} md={4}>
                  <Typography variant="subtitle2" gutterBottom>
                    Actions
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditConfig(row.chatflowId, row.chatflowName);
                      }}
                    >
                      Edit Config
                    </Button>
                  </Stack>
                </Grid>
              </Grid>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
};

// ==============================|| DASHBOARD ||============================== //

const Dashboard = () => {
  const theme = useTheme();
  const [stats, setStats] = useState(null);
  const [configs, setConfigs] = useState([]);
  const [health, setHealth] = useState(null);
  const [isLoading, setLoading] = useState(true);

  const handleEditConfig = (chatflowId, chatflowName) => {
    // Navigate to settings tab with the chatflow pre-selected
    // Using custom event to communicate with parent
    window.dispatchEvent(
      new CustomEvent("followup-edit-config", {
        detail: { chatflowId, chatflowName },
      })
    );
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, configsRes, healthRes] = await Promise.all([
        followupApi.getStats({ days: 7 }),
        followupApi.getAllConfigs(),
        followupApi.getHealth().catch(() => ({ data: null })),
      ]);
      setStats(
        statsRes?.data || {
          pending: 0,
          total: 0,
          sent: 0,
          failed: 0,
          successRate: 0,
        }
      );
      setConfigs(Array.isArray(configsRes?.data) ? configsRes.data : []);
      setHealth(healthRes?.data || null);
    } catch (error) {
      console.error("Failed to fetch follow-up data:", error);
      setStats({ pending: 0, total: 0, sent: 0, failed: 0, successRate: 0 });
      setConfigs([]);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30s
    const t = setInterval(() => fetchData(), 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <Box>
      {/* Stats Cards */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3} lg={2}>
          <StatCard
            title="Service"
            value={
              health?.status === "healthy"
                ? "Healthy"
                : health?.status === "degraded"
                ? "Degraded"
                : health?.status === "unhealthy"
                ? "Down"
                : "—"
            }
            icon={
              <IconHeartbeat
                size={22}
                color={
                  health?.status === "healthy"
                    ? theme.palette.success.main
                    : health?.status === "degraded"
                    ? theme.palette.warning.main
                    : theme.palette.error.main
                }
              />
            }
            color={
              health?.status === "healthy"
                ? theme.palette.success.main
                : health?.status === "degraded"
                ? theme.palette.warning.main
                : theme.palette.error.main
            }
            isLoading={isLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3} lg={2}>
          <StatCard
            title="Pending"
            value={stats?.pending || 0}
            icon={<IconClock size={22} color={theme.palette.warning.main} />}
            color={theme.palette.warning.main}
            isLoading={isLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3} lg={2}>
          <StatCard
            title="Fired (7d)"
            value={stats?.total || 0}
            icon={<IconSend size={22} color={theme.palette.info.main} />}
            color={theme.palette.info.main}
            isLoading={isLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3} lg={2}>
          <StatCard
            title="Success"
            value={stats?.sent || 0}
            icon={<IconCheck size={22} color={theme.palette.success.main} />}
            color={theme.palette.success.main}
            isLoading={isLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3} lg={2}>
          <StatCard
            title="Failed"
            value={stats?.failed || 0}
            icon={<IconX size={22} color={theme.palette.error.main} />}
            color={theme.palette.error.main}
            isLoading={isLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3} lg={2}>
          <StatCard
            title="Success Rate"
            value={`${stats?.successRate || 0}%`}
            icon={
              <IconPercentage size={22} color={theme.palette.primary.main} />
            }
            color={theme.palette.primary.main}
            isLoading={isLoading}
          />
        </Grid>
      </Grid>

      {/* Chatflows Table */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Typography variant="h4">Active Chatflows</Typography>
        <Button
          startIcon={<IconRefresh size={16} />}
          size="small"
          onClick={fetchData}
        >
          Refresh
        </Button>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>Chatflow</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="center">Steps</TableCell>
              <TableCell align="center">Active Sessions</TableCell>
              <TableCell align="center">Pending Tasks</TableCell>
              <TableCell align="center">Sent (Today)</TableCell>
              <TableCell align="center">Failed (Today)</TableCell>
              <TableCell align="center">Total Fired</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : configs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center">
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    sx={{ py: 3 }}
                  >
                    No follow-up configurations yet. Go to Settings to create
                    one.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              configs
                .filter((c) => c.enabled)
                .map((config) => (
                  <CollapsibleRow
                    key={config.id}
                    row={config}
                    onEditConfig={handleEditConfig}
                  />
                ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default Dashboard;
