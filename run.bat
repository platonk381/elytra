@echo off
chcp 65001 >nul
cd /d "%~dp0"
python -m pip install --quiet pywebview minecraft-launcher-lib requests
python launcher.py
