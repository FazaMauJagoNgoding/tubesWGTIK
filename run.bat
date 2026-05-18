@echo off
cd /d "%~dp0"
echo Starting Python MediaPipe camera classifier...
echo.
echo Keep this window open while using the camera page.
echo URL: http://127.0.0.1:5000
echo.
start "" "http://127.0.0.1:5000"
python app.py
echo.
echo Server stopped.
pause
