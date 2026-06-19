import { useEffect, useState, useCallback } from "react";

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
  Button,
  Stack,
  Switch,
  FormControlLabel,
  Alert,
  AlertTitle,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Tooltip,
  useTheme,
} from "@mui/material";

// icons
import {
  IconRefresh,
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconServer,
  IconDatabase,
  IconTimeline,
  IconPlugConnected,
  IconCircuitDiode,
  IconClock,
  IconPlayerPlay,
  IconManualGearbox,
  IconCpu,
} from "@tabler/icons-react";

// API
import followupApi from "@/api/followup";

// ==============================|| STAT CARD ||============================== //

const StatCard = ({ title, value, icon, color, subtitle, isLoading }) => {
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
            <Typography variant="h4" sx={{ mt: 0.5 }}>
              {isLoading ? "—" : value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="textSecondary">
                {subtitle}
              </Typography>
            )}
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

// ==============================|| SERVICE STATUS ||============================== //

const ServiceStatus = () => {
  const theme = useTheme();
  const [health, setHealth] = useState(null);
  const [circuits, setCircuits] = useState(null);
  const [isLoading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [resetDialog, setResetDialog] = useState(null); // url or null
  const [resetLoading, setResetLoading] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await followupApi.getHealth();
      setHealth(res?.data || null);
    } catch {
      setHealth(null);
    }
  }, []);

  const fetchCircuits = useCallback(async () => {
    try {
      const res = await followupApi.getCircuits();
      setCircuits(res?.data || null);
    } catch {
      setCircuits(null);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchHealth(), fetchCircuits()]);
    setLoading(false);
  }, [fetchHealth, fetchCircuits]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(fetchAll, 10000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchAll]);

  const handleReset = async () => {
    setResetLoading(true);
    try {
      await followupApi.resetCircuits(resetDialog);
      await fetchCircuits();
    } catch {
      /* ignore */
    }
    setResetLoading(false);
    setResetDialog(null);
  };

  // Derive status
  const status = health?.status;
  const isHealthy = status === "healthy";
  const isDegraded = status === "degraded";
  const isUnhealthy = status === "unhealthy";

  const openCircuits = circuits?.open || 0;
  const hasIssues = isUnhealthy || openCircuits > 0;

  return (
    <Box>
      {/* Global Status Banner */}
      <Alert
        severity={
          isHealthy ? "success" : isDegraded ? "warning" : "error"
        }
        icon={
          isHealthy ? (
            <IconCheck size={20} />
          ) : (
            <IconAlertTriangle size={20} />
          )
        }
        sx={{ mb: 3 }}
        action={
          <FormControlLabel
            control={
              <Switch
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                size="small"
              />
            }
            label="Auto"
          />
        }
      >
        <AlertTitle>
          {isHealthy
            ? "Service Healthy"
            : isDegraded
            ? "Service Degraded"
            : isUnhealthy
            ? "Service Unhealthy"
            : "Status Unknown"}
        </AlertTitle>
        {health ? (
          <Typography variant="body2">
            Uptime: {Math.floor((health.uptime || 0) / 3600)}h{" "}
            {Math.floor(((health.uptime || 0) % 3600) / 60)}m | PID:{" "}
            {health.process?.pid || "—"} | Memory:{" "}
            {health.process?.memoryMB || "—"} MB
            {hasIssues &&
              ` | ${openCircuits} open circuit${openCircuits !== 1 ? "s" : ""}`}
          </Typography>
        ) : (
          <Typography variant="body2">
            Service unreachable — check that followup-service is running
          </Typography>
        )}
      </Alert>

      {/* Refresh Button */}
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
        <Button
          startIcon={<IconRefresh size={16} />}
          size="small"
          onClick={fetchAll}
        >
          Refresh
        </Button>
      </Stack>

      {/* Connectivity Cards */}
      <Typography variant="h5" sx={{ mb: 1.5 }}>
        Connectivity
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <StatCard
            title="Redis"
            value={health?.redis?.state === "up" ? "Connected" : "Disconnected"}
            icon={
              <IconDatabase
                size={22}
                color={
                  health?.redis?.state === "up"
                    ? theme.palette.success.main
                    : theme.palette.error.main
                }
              />
            }
            color={
              health?.redis?.state === "up"
                ? theme.palette.success.main
                : theme.palette.error.main
            }
            subtitle={
              health?.redis?.latencyMs != null
                ? `${health.redis.latencyMs}ms`
                : undefined
            }
            isLoading={isLoading}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard
            title="ClickHouse"
            value={
              health?.clickhouse?.state === "up" ? "Connected" : "Disconnected"
            }
            icon={
              <IconServer
                size={22}
                color={
                  health?.clickhouse?.state === "up"
                    ? theme.palette.success.main
                    : theme.palette.error.main
                }
              />
            }
            color={
              health?.clickhouse?.state === "up"
                ? theme.palette.success.main
                : theme.palette.error.main
            }
            isLoading={isLoading}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard
            title="Uptime"
            value={
              health?.uptime != null
                ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`
                : "—"
            }
            icon={<IconClock size={22} />}
            isLoading={isLoading}
          />
        </Grid>
      </Grid>

      {/* Pipeline Stats */}
      <Typography variant="h5" sx={{ mb: 1.5 }}>
        Pipeline
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Consumer Lag"
            value={health?.consumer?.lag ?? "—"}
            icon={
              <IconPlugConnected
                size={22}
                color={
                  (health?.consumer?.lag || 0) > 50000
                    ? theme.palette.warning.main
                    : theme.palette.success.main
                }
              />
            }
            color={
              (health?.consumer?.lag || 0) > 50000
                ? theme.palette.warning.main
                : theme.palette.success.main
            }
            subtitle={
              health?.consumer?.lastEventAgeMs
                ? `last event: ${Math.round(health.consumer.lastEventAgeMs / 1000)}s ago`
                : undefined
            }
            isLoading={isLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Active Workers"
            value={health?.workers?.active ?? "—"}
            icon={
              <IconPlayerPlay
                size={22}
                color={theme.palette.info.main}
              />
            }
            color={theme.palette.info.main}
            isLoading={isLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Pending Timers"
            value={health?.timers?.pending ?? "—"}
            icon={
              <IconTimeline
                size={22}
                color={
                  (health?.timers?.pending || 0) > 1_000_000
                    ? theme.palette.error.main
                    : (health?.timers?.pending || 0) > 500_000
                    ? theme.palette.warning.main
                    : theme.palette.success.main
                }
              />
            }
            color={
              (health?.timers?.pending || 0) > 1_000_000
                ? theme.palette.error.main
                : (health?.timers?.pending || 0) > 500_000
                ? theme.palette.warning.main
                : theme.palette.success.main
            }
            subtitle={
              health?.timers?.zsetSizeBytes != null
                ? `${(health.timers.zsetSizeBytes / 1024 / 1024).toFixed(1)} MB`
                : undefined
            }
            isLoading={isLoading}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Process Memory"
            value={health?.process?.memoryMB ? `${health.process.memoryMB} MB` : "—"}
            icon={
              <IconCpu
                size={22}
                color={theme.palette.primary.main}
              />
            }
            color={theme.palette.primary.main}
            isLoading={isLoading}
          />
        </Grid>
      </Grid>

      {/* Circuit Breakers */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1.5 }}
      >
        <Typography variant="h5">Circuit Breakers</Typography>
        <Stack direction="row" spacing={1}>
          <Chip
            label={`${circuits?.open || 0} open`}
            size="small"
            color={(circuits?.open || 0) > 0 ? "error" : "success"}
          />
          <Chip
            label={`${circuits?.halfOpen || 0} half-open`}
            size="small"
            color="warning"
          />
          <Chip
            label={`${circuits?.closed || 0} closed`}
            size="small"
            color="success"
          />
        </Stack>
      </Stack>

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Endpoint URL</TableCell>
              <TableCell align="center">State</TableCell>
              <TableCell align="center">Consecutive Failures</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!circuits || circuits.total === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    sx={{ py: 2 }}
                  >
                    No circuits active. All endpoints are healthy.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              /* The API currently returns aggregate stats, not per-url.
                 For a full per-url view we'd need to add a list endpoint.
                 For now, show the summary. */
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography variant="body2" color="textSecondary" sx={{ py: 2 }}>
                    {circuits.open > 0
                      ? `${circuits.open} circuits open — use "Reset All" to attempt recovery`
                      : "No open circuits"}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <Tooltip title="Reset all open circuits">
          <Button
            size="small"
            variant="outlined"
            color="warning"
            startIcon={<IconCircuitDiode size={16} />}
            onClick={() => setResetDialog(null)}
            disabled={(circuits?.open || 0) === 0}
          >
            Reset All Circuits
          </Button>
        </Tooltip>
      </Stack>

      {/* Memory Guard Status */}
      {health?.memoryGuard?.degraded && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Memory Guard Active</AlertTitle>
          Timer ZSET is at {health.memoryGuard.zsetSize?.toLocaleString()} members
          — new timers are being rejected to prevent Redis OOM.
        </Alert>
      )}

      {/* Reset Confirmation Dialog */}
      <Dialog open={resetDialog !== undefined} onClose={() => setResetDialog(undefined)}>
        <DialogTitle>Reset Circuit Breakers?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {resetDialog
              ? `This will close the circuit for ${resetDialog}, allowing webhooks to be sent again.`
              : "This will reset ALL open circuits. Affected endpoints will receive webhooks on their next timer."}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetDialog(undefined)}>Cancel</Button>
          <Button
            onClick={handleReset}
            color="warning"
            variant="contained"
            disabled={resetLoading}
          >
            {resetLoading ? "Resetting..." : "Reset"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ServiceStatus;
