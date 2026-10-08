@echo off
chcp 65001 >nul 2>nul
title Wuxia MUD - Combined Server (Game + Mod Site)
cd /d "%~dp0"

echo.
echo   ============================================
echo      WUXIA MUD  -  Single Port Launcher
echo   ============================================
echo.

set "NODE_BIN="
if exist "runtime\node.exe" set "NODE_BIN=runtime\node.exe"
if not defined NODE_BIN (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_BIN=node"
)

if not defined NODE_BIN (
  echo   [ERROR] Node.js not found.
  echo   This package should include runtime\node.exe.
  echo   Please re-download a complete package, or install Node.js 18+ from
  echo   https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo   Game and Mod Site will both run on port 8800.
echo.
echo     Game      http://127.0.0.1:8800/
echo     Mod Site  http://127.0.0.1:8800/site/
echo.
echo   Press Ctrl+C to stop the server.
echo.

%NODE_BIN% server\combined.js
pause
