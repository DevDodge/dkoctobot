@echo off
:: ============================================================
::  DK-Platform START Script
::  3 layers of protection:
::    1. Watchdog loop  -> restarts on crash
::    2. Health-check   -> restarts if watchdog dies (every 2 min)
::    3. ONSTART task   -> restarts after reboot
::  The ONLY way to stop: dk-stop.bat
:: ============================================================

:: Ensure we run from the project root
cd /d "F:\DK-Platform"

:: Create logs directory if missing
if not exist "F:\DK-Platform\logs" mkdir "F:\DK-Platform\logs"

:: ---- Check if server is already running on port 1252 ----
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":1252 " ^| findstr "LISTENING" 2^>nul') do (
    echo [DK-Platform] Server is already running on port 1252 ^(PID: %%a^). Exiting.
    echo [DK-Platform] [%date% %time%] Already running ^(PID: %%a^), skipped duplicate start. >> "F:\DK-Platform\logs\dk-watchdog.log"
    goto :eof
)

:: ---- Write the lock file (watchdog runs while this exists) ----
echo RUNNING > "F:\DK-Platform\.dk-running.lock"

:: ---- Layer 3: Register ONSTART Scheduled Task (survives reboot) ----
echo [DK-Platform] Registering startup scheduled task...
schtasks /Delete /TN "DK-OctoBot-AutoStart" /F >nul 2>&1
schtasks /Create /TN "DK-OctoBot-AutoStart" /TR "cmd.exe /c \"F:\DK-Platform\dk-start.bat\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul 2>&1
if %errorlevel% neq 0 (
    echo [DK-Platform] WARNING: ONSTART failed ^(need admin^). Trying ONLOGON...
    schtasks /Create /TN "DK-OctoBot-AutoStart" /TR "cmd.exe /c \"F:\DK-Platform\dk-start.bat\"" /SC ONLOGON /RL HIGHEST /F >nul 2>&1
)
echo [DK-Platform] Boot task registered.

:: ---- Layer 2: Launch Health-Check background loop (every 10 sec) ----
del /f /q "F:\DK-Platform\.dk-healthcheck.lock" >nul 2>&1
start /min "DK-HealthCheck" cmd /c "F:\DK-Platform\dk-healthcheck.bat"
echo [DK-Platform] Health-check loop launched (every 10 sec).

:: ---- Set environment variables ----
set NODE_ENV=production
set PORT=1252
set APP_URL=https://www.dk.octobot.it.com
set NODE_TLS_REJECT_UNAUTHORIZED=0
set PGSSLMODE=disable
set NODE_OPTIONS=--max-old-space-size=4096

echo ============================================================
echo   DK-Platform Server - Watchdog Active
echo   Use dk-stop.bat to stop. Nothing else will work.
echo   Started: %date% %time%
echo ============================================================
echo [DK-Platform] [%date% %time%] === Server starting === >> "F:\DK-Platform\logs\dk-watchdog.log"

:: ---- Layer 1: Watchdog loop (restarts on crash) ----
:watchdog_loop

:: Check if the lock file still exists (dk-stop.bat deletes it)
if not exist "F:\DK-Platform\.dk-running.lock" (
    echo [DK-Platform] Lock file removed. Shutting down watchdog.
    echo [DK-Platform] [%date% %time%] Watchdog stopped - lock file removed. >> "F:\DK-Platform\logs\dk-watchdog.log"
    goto :eof
)

echo [DK-Platform] [%date% %time%] Starting server process...
echo [DK-Platform] [%date% %time%] Starting server process... >> "F:\DK-Platform\logs\dk-watchdog.log"

:: Launch the server (this blocks until the process exits)
cd /d "F:\DK-Platform\packages\server\bin"
node --max-old-space-size=4096 run start >> "F:\DK-Platform\logs\dk-octobot-out.log" 2>> "F:\DK-Platform\logs\dk-octobot-error.log"

:: Server process exited — check if we should restart
if not exist "F:\DK-Platform\.dk-running.lock" (
    echo [DK-Platform] [%date% %time%] Server stopped gracefully (lock removed).
    echo [DK-Platform] [%date% %time%] Server stopped gracefully. >> "F:\DK-Platform\logs\dk-watchdog.log"
    goto :eof
)

:: Lock file still exists = unexpected crash, auto-restart
echo [DK-Platform] [%date% %time%] Server exited unexpectedly! Restarting in 5 seconds...
echo [DK-Platform] [%date% %time%] CRASH DETECTED - restarting in 5s... >> "F:\DK-Platform\logs\dk-watchdog.log"

cd /d "F:\DK-Platform"
timeout /t 5 /nobreak >nul

goto :watchdog_loop
