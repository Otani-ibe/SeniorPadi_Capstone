@echo off
REM Double-click this file to start SeniorPadi on this computer.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then double-click this file again.
  pause
  exit /b
)

if not exist .env (
  copy .env.example .env >nul
  echo A settings file called .env was created. Fill it in, save it, then double-click this file again.
  notepad .env
  pause
  exit /b
)

if not exist node_modules (
  echo Installing for the first time. This can take a few minutes...
  call npm install
)

call npm start
pause
