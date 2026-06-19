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
  Switch,
  TextField,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Skeleton,
  Alert,
  useTheme,
} from "@mui/material";

// icons
import {
  IconPlus,
  IconTrash,
  IconEdit,
  IconGripVertical,
  IconTestPipe,
  IconClock,
  IconArrowRight,
  IconX,
  IconDeviceFloppy,
  IconRefresh,
} from "@tabler/icons-react";

// API
import followupApi from "@/api/followup";
import chatflowsApi from "@/api/chatflows";

// ==============================|| STEP BUILDER ||============================== //

const StepBuilder = ({ steps, onChange }) => {
  const theme = useTheme();

  const addStep = () => {
    const newStep = {
      stepName: `Step ${steps.length + 1}`,
      idleTimeout: 30,
      idleTimeoutUnit: "minutes",
      webhookUrl: "",
      webhookHeaders: "",
      maxFires: 0,
    };
    onChange([...steps, newStep]);
  };

  const removeStep = (index) => {
    const updated = steps.filter((_, i) => i !== index);
    onChange(updated);
  };

  const updateStep = (index, field, value) => {
    const updated = [...steps];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  return (
    <Box>
      <Stack spacing={2}>
        {steps.map((step, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={2}>
              {/* Header */}
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
              >
                <Stack direction="row" alignItems="center" spacing={1}>
                  <IconGripVertical
                    size={16}
                    color={theme.palette.text.secondary}
                  />
                  <Chip
                    label={`Step ${idx + 1}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                </Stack>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => removeStep(idx)}
                >
                  <IconTrash size={16} />
                </IconButton>
              </Stack>

              {/* Step Name */}
              <TextField
                label="Step Name"
                size="small"
                fullWidth
                value={step.stepName || ""}
                onChange={(e) => updateStep(idx, "stepName", e.target.value)}
                placeholder="e.g., Reminder, Escalate, Close"
              />

              {/* Timeout */}
              <Stack direction="row" spacing={1}>
                <TextField
                  label="Idle Timeout"
                  size="small"
                  type="number"
                  sx={{ width: 130 }}
                  value={step.idleTimeout || ""}
                  onChange={(e) =>
                    updateStep(
                      idx,
                      "idleTimeout",
                      parseInt(e.target.value) || 0
                    )
                  }
                  inputProps={{ min: 1 }}
                />
                <TextField
                  select
                  label="Unit"
                  size="small"
                  sx={{ width: 130 }}
                  value={step.idleTimeoutUnit || "minutes"}
                  onChange={(e) =>
                    updateStep(idx, "idleTimeoutUnit", e.target.value)
                  }
                >
                  <MenuItem value="minutes">Minutes</MenuItem>
                  <MenuItem value="hours">Hours</MenuItem>
                  <MenuItem value="days">Days</MenuItem>
                </TextField>
              </Stack>

              {/* Webhook URL */}
              <TextField
                label="Webhook URL"
                size="small"
                fullWidth
                value={step.webhookUrl || ""}
                onChange={(e) => updateStep(idx, "webhookUrl", e.target.value)}
                placeholder="https://example.com/webhook"
              />

              {/* Headers (optional) */}
              <TextField
                label="Custom Headers (JSON)"
                size="small"
                fullWidth
                multiline
                rows={2}
                value={step.webhookHeaders || ""}
                onChange={(e) =>
                  updateStep(idx, "webhookHeaders", e.target.value)
                }
                placeholder='{"Authorization": "Bearer ...", "X-Custom": "value"}'
              />

              {/* Max Fires */}
              <TextField
                label="Max Fires per Session"
                size="small"
                type="number"
                sx={{ width: 200 }}
                value={step.maxFires || 0}
                onChange={(e) =>
                  updateStep(idx, "maxFires", parseInt(e.target.value) || 0)
                }
                inputProps={{ min: 0 }}
                helperText="0 = unlimited"
              />
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Button
        startIcon={<IconPlus size={16} />}
        onClick={addStep}
        sx={{ mt: 2 }}
        variant="outlined"
        fullWidth
      >
        Add Step
      </Button>

      {/* Timeline Preview */}
      {steps.length > 0 && (
        <Paper
          variant="outlined"
          sx={{ mt: 2, p: 2, bgcolor: theme.palette.grey[50] }}
        >
          <Typography variant="subtitle2" gutterBottom>
            Timeline Preview
          </Typography>
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            flexWrap="wrap"
          >
            <Chip label="Message" size="small" color="info" />
            {steps.map((step, idx) => (
              <Stack
                key={idx}
                direction="row"
                alignItems="center"
                spacing={0.5}
              >
                <IconArrowRight size={14} />
                <Chip
                  icon={<IconClock size={12} />}
                  label={`${step.idleTimeout} ${step.idleTimeoutUnit}`}
                  size="small"
                  variant="outlined"
                />
                <IconArrowRight size={14} />
                <Chip
                  label={step.stepName || `Step ${idx + 1}`}
                  size="small"
                  color="primary"
                />
              </Stack>
            ))}
          </Stack>
          <Typography
            variant="caption"
            color="textSecondary"
            sx={{ mt: 1, display: "block" }}
          >
            ⟳ Any new message resets ALL timers
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

// ==============================|| CONFIG DIALOG ||============================== //

const ConfigDialog = ({ open, chatflowId, chatflowName, onClose, onSave }) => {
  const [config, setConfig] = useState({
    enabled: true,
    includeSessionDetails: true,
    maxMessages: 10,
  });
  const [steps, setSteps] = useState([]);
  const [isLoading, setLoading] = useState(false);
  const [isSaving, setSaving] = useState(false);

  useEffect(() => {
    if (open && chatflowId) {
      fetchConfig();
    }
  }, [open, chatflowId]);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await followupApi.getConfig(chatflowId);
      if (res.data?.config) {
        setConfig(res.data.config);
        setSteps(res.data.steps || []);
      } else {
        setConfig({
          enabled: true,
          includeSessionDetails: true,
          maxMessages: 10,
        });
        setSteps([]);
      }
    } catch (error) {
      console.error("Failed to load config:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await followupApi.upsertConfig({
        chatflowId,
        config: {
          enabled: config.enabled,
          includeSessionDetails: config.includeSessionDetails,
          maxMessages: config.maxMessages,
        },
        steps: steps.map((s) => ({
          stepName: s.stepName,
          idleTimeout: s.idleTimeout,
          idleTimeoutUnit: s.idleTimeoutUnit,
          webhookUrl: s.webhookUrl,
          webhookHeaders: s.webhookHeaders,
          maxFires: s.maxFires || 0,
        })),
      });
      onSave();
      onClose();
    } catch (error) {
      console.error("Failed to save config:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Typography variant="h4">
            Configure: {chatflowName || chatflowId}
          </Typography>
          <IconButton onClick={onClose}>
            <IconX size={18} />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {isLoading ? (
          <Stack spacing={2}>
            <Skeleton height={40} />
            <Skeleton height={40} />
            <Skeleton height={100} />
          </Stack>
        ) : (
          <Stack spacing={3}>
            {/* General Settings */}
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                General
              </Typography>
              <Stack spacing={2}>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Typography variant="body2">Enabled</Typography>
                  <Switch
                    checked={config.enabled}
                    onChange={(e) =>
                      setConfig({ ...config, enabled: e.target.checked })
                    }
                  />
                </Stack>
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Typography variant="body2">
                    Include session details in payload
                  </Typography>
                  <Switch
                    checked={config.includeSessionDetails}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        includeSessionDetails: e.target.checked,
                      })
                    }
                  />
                </Stack>
                <TextField
                  select
                  label="Max messages in payload"
                  size="small"
                  value={config.maxMessages || 10}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      maxMessages: parseInt(e.target.value),
                    })
                  }
                  sx={{ maxWidth: 200 }}
                >
                  <MenuItem value={5}>5</MenuItem>
                  <MenuItem value={10}>10</MenuItem>
                  <MenuItem value={20}>20</MenuItem>
                  <MenuItem value={50}>50</MenuItem>
                </TextField>
              </Stack>
            </Box>

            <Divider />

            {/* Steps */}
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Escalation Steps
              </Typography>
              <Typography
                variant="caption"
                color="textSecondary"
                gutterBottom
                display="block"
              >
                Define the steps that will fire sequentially when a session goes
                idle. Each step has its own timeout and webhook URL.
              </Typography>
              <StepBuilder steps={steps} onChange={setSteps} />
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={isSaving}
          startIcon={<IconDeviceFloppy size={16} />}
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// ==============================|| SETTINGS ||============================== //

const Settings = ({ editTarget, onEditDone }) => {
  const theme = useTheme();
  const [chatflows, setChatflows] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [isLoading, setLoading] = useState(true);
  const [editDialog, setEditDialog] = useState({
    open: false,
    chatflowId: null,
    chatflowName: "",
  });
  const [search, setSearch] = useState("");

  // Open edit dialog when editTarget is set from Dashboard
  useEffect(() => {
    if (editTarget?.chatflowId) {
      setEditDialog({
        open: true,
        chatflowId: editTarget.chatflowId,
        chatflowName: editTarget.chatflowName || "",
      });
      if (onEditDone) onEditDone();
    }
  }, [editTarget]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [chatflowsRes, configsRes] = await Promise.all([
        chatflowsApi.getAllChatflows(),
        followupApi.getAllConfigs(),
      ]);
      setChatflows(chatflowsRes.data || []);
      setConfigs(Array.isArray(configsRes.data) ? configsRes.data : []);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getConfigForChatflow = (chatflowId) => {
    return configs.find((c) => c.chatflowId === chatflowId);
  };

  // Filter by search and sort by updatedDate (most recent first)
  const filteredChatflows = chatflows
    .filter((cf) => cf.name?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => new Date(b.updatedDate) - new Date(a.updatedDate));

  const handleToggle = async (chatflowId, chatflowName, currentEnabled) => {
    try {
      await followupApi.upsertConfig({
        chatflowId,
        config: { enabled: !currentEnabled },
        steps: [], // don't change steps
      });
      fetchData();
    } catch (error) {
      console.error("Failed to toggle:", error);
    }
  };

  const handleDelete = async (chatflowId) => {
    if (!window.confirm("Delete follow-up config for this chatflow?")) return;
    try {
      await followupApi.deleteConfig(chatflowId);
      fetchData();
    } catch (error) {
      console.error("Failed to delete:", error);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Typography variant="h4">Follow-up Settings</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            placeholder="Search chatflows..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 220 }}
          />
          <Button
            startIcon={<IconRefresh size={16} />}
            size="small"
            onClick={fetchData}
          >
            Refresh
          </Button>
        </Stack>
      </Stack>

      <Alert severity="info" sx={{ mb: 2 }}>
        Configure follow-up timers per chatflow. When a session goes idle (no
        new messages), webhooks fire in order. Each new message resets all
        timers.
      </Alert>

      {/* Chatflows Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Chatflow</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Last Modified</TableCell>
              <TableCell align="center">Follow-up Enabled</TableCell>
              <TableCell align="center">Steps</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filteredChatflows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography
                    variant="body2"
                    color="textSecondary"
                    sx={{ py: 3 }}
                  >
                    {search
                      ? "No chatflows match your search"
                      : "No chatflows found"}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredChatflows.map((cf) => {
                const config = getConfigForChatflow(cf.id);
                return (
                  <TableRow key={cf.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>
                        {cf.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={cf.type || "CHATFLOW"}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="textSecondary">
                        {cf.updatedDate
                          ? new Date(cf.updatedDate).toLocaleDateString(
                              undefined,
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )
                          : "—"}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        checked={config?.enabled || false}
                        onChange={() =>
                          handleToggle(cf.id, cf.name, config?.enabled)
                        }
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      {config ? (
                        <Chip label={config.stepsCount || 0} size="small" />
                      ) : (
                        <Typography variant="body2" color="textSecondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Stack
                        direction="row"
                        spacing={0.5}
                        justifyContent="center"
                      >
                        <Button
                          size="small"
                          startIcon={<IconEdit size={14} />}
                          onClick={() =>
                            setEditDialog({
                              open: true,
                              chatflowId: cf.id,
                              chatflowName: cf.name,
                            })
                          }
                        >
                          Configure
                        </Button>
                        {config && (
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDelete(cf.id)}
                          >
                            <IconTrash size={16} />
                          </IconButton>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Edit Config Dialog */}
      <ConfigDialog
        open={editDialog.open}
        chatflowId={editDialog.chatflowId}
        chatflowName={editDialog.chatflowName}
        onClose={() =>
          setEditDialog({ open: false, chatflowId: null, chatflowName: "" })
        }
        onSave={fetchData}
      />
    </Box>
  );
};

export default Settings;
