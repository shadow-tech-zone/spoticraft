@echo off
rem Bloomee build — MSVC Developer Command Prompt se chalao: build.cmd
setlocal
cd /d %~dp0
where cl >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] cl.exe nahi mila. "Developer Command Prompt for VS" kholo aur phir build.cmd chalao.
  exit /b 1
)
if not exist build mkdir build
rc /nologo /fo build\app.res app.rc || exit /b 1
cl /nologo /utf-8 /O2 /std:c++17 /EHsc /MT /DUNICODE /D_UNICODE ^
  main.cpp ui.cpp net.cpp api.cpp player.cpp state.cpp build\app.res ^
  /Fe:build\Bloomee.exe ^
  /link /SUBSYSTEM:WINDOWS d2d1.lib dwrite.lib windowscodecs.lib winhttp.lib ^
    mfplat.lib mfreadwrite.lib mfuuid.lib ole32.lib uuid.lib shell32.lib ^
    shlwapi.lib dwmapi.lib comctl32.lib user32.lib gdi32.lib advapi32.lib
if %errorlevel% neq 0 exit /b 1
echo.
echo Build OK -^> app\build\Bloomee.exe
endlocal
