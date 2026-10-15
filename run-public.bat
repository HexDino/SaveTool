@echo off
REM Start Save Tool + cloudflared tunnel + point the Cloudflare Worker at it.
REM Requires: cloudflared installed, and the savetool Worker already deployed (npx wrangler deploy).
cd /d "%~dp0"
node scripts\public.mjs %*
pause
