import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";

// material-ui
import { Box, Tabs, Tab } from "@mui/material";

// project imports
import MainCard from "@/ui-component/cards/MainCard";
import ViewHeader from "@/layout/MainLayout/ViewHeader";

// tabs
import Dashboard from "./Dashboard";
import Pending from "./Pending";
import History from "./History";
import Settings from "./Settings";
import ServiceStatus from "./ServiceStatus";

// icons
import {
  IconChartBar,
  IconClock,
  IconHistory,
  IconSettings,
  IconActivity,
} from "@tabler/icons-react";

// ==============================|| FOLLOW-UPS ||============================== //

const tabMap = ["dashboard", "pending", "history", "settings", "service"];

const FollowUps = () => {
  const { tab } = useParams();
  const navigate = useNavigate();
  const initialTab = tab ? tabMap.indexOf(tab) : 0;
  const [activeTab, setActiveTab] = useState(initialTab >= 0 ? initialTab : 0);
  const [editTarget, setEditTarget] = useState(null);

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
    navigate(`/followups/${tabMap[newValue]}`, { replace: true });
  };

  // Listen for edit-config events from Dashboard
  useEffect(() => {
    const handler = (e) => {
      setEditTarget(e.detail);
      setActiveTab(3); // switch to Settings tab
      navigate("/followups/settings", { replace: true });
    };
    window.addEventListener("followup-edit-config", handler);
    return () => window.removeEventListener("followup-edit-config", handler);
  }, [navigate]);

  return (
    <>
      <ViewHeader title="Follow-ups" />
      <MainCard sx={{ p: 0 }}>
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tabs
            value={activeTab}
            onChange={handleTabChange}
            aria-label="follow-ups tabs"
          >
            <Tab
              icon={<IconChartBar size={18} />}
              iconPosition="start"
              label="Dashboard"
            />
            <Tab
              icon={<IconClock size={18} />}
              iconPosition="start"
              label="Pending"
            />
            <Tab
              icon={<IconHistory size={18} />}
              iconPosition="start"
              label="History"
            />
            <Tab
              icon={<IconSettings size={18} />}
              iconPosition="start"
              label="Settings"
            />
            <Tab
              icon={<IconActivity size={18} />}
              iconPosition="start"
              label="Service"
            />
          </Tabs>
        </Box>
        <Box sx={{ p: 2 }}>
          {activeTab === 0 && <Dashboard />}
          {activeTab === 1 && <Pending />}
          {activeTab === 2 && <History />}
          {activeTab === 3 && (
            <Settings
              editTarget={editTarget}
              onEditDone={() => setEditTarget(null)}
            />
          )}
          {activeTab === 4 && <ServiceStatus />}
        </Box>
      </MainCard>
    </>
  );
};

export default FollowUps;
