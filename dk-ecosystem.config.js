// DK-Platform PM2 Ecosystem Configuration
// Used by dk-start.ps1 for persistent auto-restart deployment
module.exports = {
  apps: [
    {
      name: "DK-OctoBot",
      script: "./packages/server/bin/run",
      args: "start",
      cwd: "C:\\Systems\\DK-Platform",
      interpreter: "node",
      interpreter_args: "--max-old-space-size=4096",
      node_args: "--max-old-space-size=4096",
      env: {
        NODE_ENV: "production",
        PORT: 1252,
        APP_URL: "https://www.dk.octobot.it.com",
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        PGSSLMODE: "disable",
      },
      // Auto-restart settings
      watch: false,
      autorestart: true,
      max_restarts: 50,
      min_uptime: "10s",
      restart_delay: 5000,
      max_memory_restart: "3G",
      // Logging
      log_file: "C:\\Systems\\DK-Platform\\logs\\dk-octobot-combined.log",
      out_file: "C:\\Systems\\DK-Platform\\logs\\dk-octobot-out.log",
      error_file: "C:\\Systems\\DK-Platform\\logs\\dk-octobot-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 30000,
    },
  ],
};
