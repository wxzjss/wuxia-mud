@echo off
chcp 65001 >nul 2>nul
title Wuxia MUD - Mod Site
cd /d "%~dp0"

rem Prefer the bundled Node, then fall back to the system one.
set "NODE_BIN="
if exist "runtime\node.exe" set "NODE_BIN=runtime\node.exe"
if not defined NODE_BIN (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_BIN=node"
)

if not defined NODE_BIN (
  echo [ERROR] Node.js not found.
  echo This package should include runtime\node.exe.
  echo Please re-download a complete package, or install Node.js 18+ from
  echo https://nodejs.org/
  pause
  exit /b 1
)

%NODE_BIN% server\mod-site.js %*
pause
