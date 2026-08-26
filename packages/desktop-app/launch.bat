@echo off
REM launch.bat -- dubbelklikken om YAD als een gewoon bureaublad-programma te openen.
REM Start dist/main.js (als die nog niet draait) en opent daarna een systeem-
REM Chrome/Edge-venster in app-modus (--app=...) gericht op de lokale server.
REM Vereist: `pnpm --filter @yad/desktop-app build` moet al gedraaid zijn
REM (dist/ moet bestaan) en Node.js moet in PATH staan.

cd /d "%~dp0"

if not exist "dist\launch.js" (
  echo [yad-launch] dist\launch.js ontbreekt. Draai eerst: pnpm --filter @yad/desktop-app build
  pause
  exit /b 1
)

node dist\launch.js
if errorlevel 1 (
  echo.
  echo [yad-launch] Er ging iets mis bij het starten. Zie de melding hierboven,
  echo of log\server.log als die zelf niets toont.
  pause
  exit /b 1
)
