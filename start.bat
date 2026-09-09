@echo off
cd /d "%~dp0"
start "" powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 1 >nul
start "" http://localhost:8934/index.html
