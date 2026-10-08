@echo off
chcp 65001 >nul 2>nul
title Wuxia MUD Launcher
cd /d "%~dp0"

echo.
echo   ============================================
echo      WUXIA MUD  -  One-Click Launcher
echo   ============================================
echo.

rem ------------------------------------------------------------------
rem  Locate Node.js:
rem    1) bundled runtime\node.exe  (recommended - nothing to install)
rem    2) node from the system PATH
rem ------------------------------------------------------------------
set "NODE_BIN="
if exist "runtime\node.exe" set "NODE_BIN=runtime\node.exe"

if not defined NODE_BIN (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_BIN=node"
)

if not defined NODE_BIN (
  echo   [ERROR] Node.js not found.
  echo.
  echo   This package is supposed to contain runtime\node.exe.
  echo   If that file is missing, the archive was not extracted fully -
  echo   try extracting again with 7-Zip or Bandizip.
  echo.
  echo   Or install Node.js manually: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo   Starting game server (8787) and Mod site (8788)...
echo   Using Node: %NODE_BIN%
echo.

start "Wuxia MUD - Game" cmd /k "chcp 65001 >nul && %NODE_BIN% server\game-server.js"
timeout /t 2 /nobreak >nul
start "Wuxia MUD - Mod Site" cmd /k "chcp 65001 >nul && %NODE_BIN% server\mod-site.js"

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:8787"

echo   Started.
echo   Game    http://127.0.0.1:8787
echo   Mods    http://127.0.0.1:8788
echo.
echo   Close the two console windows to stop the servers.
echo.
timeout /t 5 /nobreak >nul
exit /b 0
