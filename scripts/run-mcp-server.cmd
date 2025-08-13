@echo off
setlocal enableextensions

REM Windows launcher for the Delphi MCP server that avoids depending on PATH for Node.
REM It tries common Node.js install locations, then falls back to "node" if needed.

set "_NODE="
if exist "%ProgramFiles%\nodejs\node.exe" set "_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined _NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "_NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined _NODE set "_NODE=node"

REM Resolve repo root (this script is expected at repo\scripts\run-mcp-server.cmd)
set "_SCRIPT_DIR=%~dp0"
for %%I in ("%_SCRIPT_DIR%..") do set "_REPO_ROOT=%%~fI"

REM Ensure built JS exists; if not, suggest building
if not exist "%_REPO_ROOT%\dist\server.js" (
  echo [error] dist\server.js not found. Build the project first: npm run build 1>&2
  exit /b 1
)

REM dotenv is loaded inside the server (via import 'dotenv/config'), so no need for --env-file
"%_NODE%" "%_REPO_ROOT%\dist\server.js"

endlocal
