@echo off
title Bloomee Web - Desktop Shortcut
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\shortcut.ps1"
echo.
pause
