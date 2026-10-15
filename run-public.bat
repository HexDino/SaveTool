@echo off
REM Start Save Tool + cloudflared tunnel + point the Cloudflare Worker at it.
REM Keep this window open while you use it; close it (or Ctrl+C) to stop.
cd /d "%~dp0"

REM make sure node is reachable even if PATH is minimal
node --version >nul 2>nul || set "PATH=%PATH%;C:\Program Files\nodejs"

node scripts\public.mjs %*
echo.
echo Save Tool has stopped.
pause
