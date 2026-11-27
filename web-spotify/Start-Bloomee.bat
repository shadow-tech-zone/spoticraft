@echo off
title Bloomee Web
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
echo.
echo Bloomee band ho gaya hai.
pause
