@echo off
rem ============================================================
rem Manual start (double-click). Keeps a console window open.
rem Log is appended to ..\logs\server.log
rem ============================================================
setlocal
cd /d "%~dp0.."
if not exist logs md logs
echo.>> logs\server.log
echo [%date% %time%] ===== start =====>> logs\server.log
node server.js>> logs\server.log 2>&1
echo [%date% %time%] exited, errorlevel=%ERRORLEVEL%>> logs\server.log
endlocal
