@echo off
echo.
echo  Removing opencode-bridge...
echo.

:: Stop the task
schtasks /end /tn "opencode-bridge" >nul 2>&1

:: Delete the task
schtasks /delete /tn "opencode-bridge" /f >nul 2>&1

:: Remove from startup folder
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\opencode-bridge.vbs" >nul 2>&1

:: Kill any running instances
taskkill /f /im wscript.exe /fi "windowtitle eq *opencode-bridge*" >nul 2>&1

echo  Done. Bridge removed and stopped.
echo.
pause
