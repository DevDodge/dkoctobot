@echo off
:: ============================================================
::  DK-Platform HEALTH CHECK (background loop - every 10 sec)
::  Runs in a minimized window, launched by dk-start.bat.
::  If the lock file exists but the server is NOT running,
::  it relaunches dk-start.bat automatically.
:: ============================================================

:: Prevent duplicate instances
if exist "F:\DK-Platform\.dk-healthcheck.lock" (
    echo [DK-HealthCheck] Another instance is already running. Exiting.
    goto :eof
)
echo RUNNING > "F:\DK-Platform\.dk-healthcheck.lock"

echo [DK-HealthCheck] Health-check loop started (every 10 seconds).
echo [DK-HealthCheck] [%date% %time%] Health-check loop started. >> "F:\DK-Platform\logs\dk-watchdog.log"

:healthcheck_loop

:: If lock file doesn't exist, user stopped the platform — exit
if not exist "F:\DK-Platform\.dk-running.lock" (
    echo [DK-HealthCheck] Lock file gone. Exiting health-check loop.
    echo [DK-HealthCheck] [%date% %time%] Exiting - lock file removed. >> "F:\DK-Platform\logs\dk-watchdog.log"
    del /f /q "F:\DK-Platform\.dk-healthcheck.lock" >nul 2>&1
    goto :eof
)

:: Check if server is listening on port 1252
set "RUNNING=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":1252 " ^| findstr "LISTENING" 2^>nul') do (
    set "RUNNING=1"
)

:: If running, all good — wait and check again
if "%RUNNING%"=="1" goto :wait

:: Server is down but should be running — restart it
echo [DK-HealthCheck] [%date% %time%] Server DOWN! Relaunching...
echo [DK-HealthCheck] [%date% %time%] Server DOWN - relaunching dk-start.bat >> "F:\DK-Platform\logs\dk-watchdog.log"
start "" cmd /c "F:\DK-Platform\dk-start.bat"

:: Wait 30 seconds after a restart to give the server time to boot
timeout /t 30 /nobreak >nul
goto :healthcheck_loop

:wait
timeout /t 10 /nobreak >nul
goto :healthcheck_loop
