@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Установка библиотек ===
python -m pip install --upgrade pip
python -m pip install pywebview minecraft-launcher-lib requests pyinstaller
if errorlevel 1 (
  echo Ошибка установки. Проверьте, что Python установлен с галочкой "Add Python to PATH".
  pause & exit /b
)
echo === Сборка Elytra.exe ===
python -m PyInstaller --noconfirm --onefile --windowed --name Elytra --icon icon.ico --add-data "ui;ui" --add-data "icon.ico;." launcher.py
echo.
echo Готово! Лаунчер лежит в папке dist\Elytra.exe
pause
