@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Wayfarer-Video.ps1"
if not errorlevel 1 start "" "http://127.0.0.1:8788"
pause
