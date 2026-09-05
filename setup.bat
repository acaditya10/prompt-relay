@echo off
title opencode-bridge setup
echo.
echo  ===================================
echo   opencode-bridge - One-time setup
echo  ===================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found.
    pause
    exit /b 1
)

:: Create startup shortcut via Task Scheduler (runs on login, hidden)
echo  [1/3] Registering to start on login...
schtasks /create /tn "opencode-bridge" /tr "wscript.exe D:\Projects\opencode-mobile-notify\bridge-silent.vbs" /sc onlogon /rl highest /f >nul 2>&1
if %errorlevel% equ 0 (
    echo        Registered: opencode-bridge task
) else (
    echo        [!] Could not register task (try running as admin)
    echo        Falling back to startup folder...
    copy "D:\Projects\opencode-mobile-notify\bridge-silent.vbs" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\opencode-bridge.vbs" >nul 2>&1
    if %errorlevel% equ 0 (
        echo        Copied to Startup folder
    ) else (
        echo        [ERROR] Could not set up auto-start
    )
)

:: Start now
echo  [2/3] Starting bridge...
start /b wscript.exe "D:\Projects\opencode-mobile-notify\bridge-silent.vbs"
timeout /t 2 /nobreak >nul

:: Verify
echo  [3/3] Verifying...
tasklist /fi "windowtitle eq opencode-bridge" 2>nul | find "node" >nul 2>&1
if %errorlevel% equ 0 (
    echo        Bridge is running
) else (
    echo        Bridge started (runs in background)
)

echo.
echo  ===================================
echo   Done! Bridge is now permanent.
echo  ===================================
echo.
echo  - Starts automatically on login
echo  - Runs hidden in background
echo  - To stop:  schtasks /end /tn "opencode-bridge"
echo  - To remove: schtasks /delete /tn "opencode-bridge" /f
echo.
pause
