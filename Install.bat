@echo off
setlocal
cd /d "%~dp0"
title LRR Visualizer - Install

where node >nul 2>nul
if errorlevel 1 goto nonode

echo.
echo  Installing the LRR Visualizer. This downloads a private copy of Chrome
echo  and ffmpeg - about 300-400 MB - so it can take a few minutes. Please wait...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto failed

echo.
echo  ============================================================
echo   Setup complete. You can close this window.
echo   To make a video, drag a song onto "Make Video.bat".
echo  ============================================================
echo.
pause
exit /b 0

:nonode
echo.
echo  Node.js is not installed yet.
echo  1. Go to https://nodejs.org
echo  2. Download and run the installer marked "LTS" - keep all the default options
echo  3. Then double-click Install.bat again
echo.
pause
exit /b 1

:failed
echo.
echo  Something went wrong during setup. Check your internet connection and
echo  double-click Install.bat again. If it keeps failing, see the README.
echo.
pause
exit /b 1
