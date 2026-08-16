@echo off
REM Capaciteiten-wacht: draait de benchmark en meldt alleen bij verandering.
REM Zie scripts/capaciteiten-wacht.mjs voor de uitleg. Geen alarm als Chrome dicht is.
cd /d C:\Code\al-yad
node scripts\capaciteiten-wacht.mjs >> C:\Code\al-yad\data\capaciteiten-wacht.log 2>&1
