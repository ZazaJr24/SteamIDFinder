@echo off
title CubeCraft Legends
cd /d "%~dp0"
echo Starting CubeCraft Legends ... the game opens in your browser.
echo Keep this window open while playing. Close it to stop the game.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
if errorlevel 1 pause
