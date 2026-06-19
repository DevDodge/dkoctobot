@echo off
:: ============================================================
::  DK-Platform STOP Script
::  This is the ONLY way to fully stop the DK-Platform.
::  It disables ALL 3 protection layers:
::    1. Removes lock file     -> watchdog loop exits
::    2. Kills server process  -> node process terminated
::    3. Removes BOTH tasks    -> no more auto-start
:: ============================================================

echo ============================================================
echo   DK-Platform Server - STOPPING ALL LAYERS
echo   %date% %time%
echo ============================================================

:: ---- Step 1: Remove the lock file (kills watchdog + health-check logic) ----
echo [DK-Platform] Step 1/4: Removing lock file...
if exist "F:\DK-Platform\.dk-running.lock" (
    del /f /q "F:\DK-Platform\.dk-running.lock" >nul 2>&1
    echo            Lock file removed.
) else (
    echo            Lock file was not present.
)

:: ---- Step 2: Kill ALL node processes on port 1252 ----
echo [DK-Platform] Step 2/4: Killing server process on port 1252...
set "KILLED=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":1252 " ^| findstr "LISTENING" 2^>nul') do (
    echo            Terminating PID: %%a
    taskkill /PID %%a /T /F >nul 2>&1
    set "KILLED=1"
)
if "%KILLED%"=="0" (
    echo            No process found on port 1252.
) else (
    echo            Server process terminated.
)

:: ---- Step 3: Remove the ONSTART scheduled task ----
echo [DK-Platform] Step 3/4: Removing boot startup task...
schtasks /Delete /TN "DK-OctoBot-AutoStart" /F >nul 2>&1
if %errorlevel% equ 0 (
    echo            Boot task removed.
) else (
    echo            Boot task was not present.
)

:: ---- Step 4: Kill the health-check background loop ----
echo [DK-Platform] Step 4/4: Stopping health-check loop...
del /f /q "F:\DK-Platform\.dk-healthcheck.lock" >nul 2>&1
:: Kill any cmd.exe running dk-healthcheck.bat
for /f "tokens=2" %%a in ('tasklist /fi "WINDOWTITLE eq DK-HealthCheck" /fo list 2^>nul ^| findstr "PID:"') do (
    taskkill /PID %%a /T /F >nul 2>&1
)
echo            Health-check loop stopped.

:: ---- Log the stop event ----
echo [DK-Platform] [%date% %time%] FULL STOP by dk-stop.bat >> "F:\DK-Platform\logs\dk-watchdog.log" 2>nul

echo.
echo ============================================================
echo   DK-Platform has been FULLY STOPPED.
echo   All protection layers disabled.
echo   To start again, run: dk-start.bat
echo ============================================================

pause
