@echo off
echo YAD Ollama-tunnel — Frankfurt server
echo Poort 11434 is nu lokaal beschikbaar.
echo Sluit dit venster NIET — dan stopt de tunnel.
echo.
ssh -N -o StrictHostKeyChecking=no -i "C:\Code\al-yad\ollama_key" -L 11434:localhost:11434 root@138.201.204.97
echo.
echo Tunnel verbroken.
pause
