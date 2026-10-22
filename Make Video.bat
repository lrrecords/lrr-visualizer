@echo off
setlocal
cd /d "%~dp0"
title LRR Visualizer

where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist "node_modules\puppeteer\" goto install
goto checkargs

:install
echo.
echo  First run - installing the parts the visualizer needs. This takes a few minutes...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto failed

:checkargs
if "%~1"=="" goto noargs

:askpreset
echo.
echo  Which look would you like?
echo.
echo    1 = Particles       - bursts of glowing particles that explode on the kick drum
echo    2 = Waveform rings  - circles that ripple with the bass, mids and highs
echo    3 = Colour fields   - soft clouds of colour that swell and drift
echo    4 = All three
echo.
set "CHOICE="
set "PRESET="
set /p "CHOICE=  Type 1, 2, 3 or 4 and press Enter: "
if "%CHOICE%"=="1" set "PRESET=particles"
if "%CHOICE%"=="2" set "PRESET=rings"
if "%CHOICE%"=="3" set "PRESET=fields"
if "%CHOICE%"=="4" set "PRESET=all"
if not defined PRESET goto askpreset

echo.
set "MODE="
set /p "MODE=  Make a quick 15-second PREVIEW first? Type Y for preview, or press Enter for the full song: "
set "EXTRA="
if /i "%MODE%"=="Y" set "EXTRA=--preview"
if /i "%MODE%"=="Y" goto run

echo.
echo  The vertical version for Shorts/Reels is a 60-second clip.
set "VSTART="
set /p "VSTART=  Press Enter to let the tool pick the most energetic part, or type a start time like 1:05: "
if not defined VSTART set "VSTART=auto"
set "EXTRA=--vertical-start %VSTART%"

:run
echo.
node src\cli.js %* --preset %PRESET% %EXTRA% --out "%~dp0output"
if errorlevel 1 (
  echo.
  echo  Some videos could not be made - see the messages above.
)
echo.
echo  Opening the output folder...
start "" "%~dp0output"
pause
exit /b 0

:noargs
echo.
echo  To make a video, close this window and DRAG a song - WAV or MP3 -
echo  onto "Make Video.bat". You can drag several songs at once.
echo.
pause
exit /b 0

:nonode
echo.
echo  Node.js is not installed yet. Install the "LTS" version from
echo  https://nodejs.org - keep the default options - then try again.
echo.
pause
exit /b 1

:failed
echo.
echo  Setup failed. Check your internet connection and try again.
echo.
pause
exit /b 1
