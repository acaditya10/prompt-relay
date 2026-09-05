@echo off
title opencode-mobile-notify setup
echo.
echo  ===================================
echo   opencode-mobile-notify - Setup
echo  ===================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found.
    echo  Download from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Check npm
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] npm not found.
    pause
    exit /b 1
)

echo  [1/4] Installing dependencies...
cd /d "%~dp0server"
call npm install --silent
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed
    pause
    exit /b 1
)

echo  [2/4] Generating icons...
node generate-icons.js

:: Check for tunnel tool (prefer ngrok, fallback to localtunnel)
echo  [3/4] Starting server...
start /b node index.js

:: Wait for server to start
timeout /t 2 /nobreak >nul

echo  [4/4] Starting tunnel...
echo.
echo  ===================================
echo   Your PWA URL (open on phone):
echo  ===================================
echo.

where ngrok >nul 2>&1
if %errorlevel% equ 0 (
    ngrok http 3077
) else (
    where lt >nul 2>&1
    if %errorlevel% equ 0 (
        lt --port 3077
    ) else (
        echo  [!] No tunnel tool found. Installing localtunnel...
        call npm install -g localtunnel
        lt --port 3077
    )
)

:end
pause
