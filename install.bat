@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Установка Elytra
echo.
echo   === Elytra: установка ===
echo.

rem ---- 1. Python ----
set "PY="
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PY=python"
if not defined PY py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1 && set "PY=py -3"
if not defined PY (
  echo Python не найден. Пробую поставить его через winget...
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  echo.
  echo Python установлен. Закройте это окно и запустите install.bat ещё раз.
  echo Если winget не сработал: скачайте Python с python.org и при установке
  echo отметьте галочку "Add Python to PATH".
  pause & exit /b
)

rem ---- 2. Библиотеки ----
echo [1/4] Ставлю библиотеки...
%PY% -m pip install --quiet --upgrade pip
%PY% -m pip install --quiet --upgrade pywebview minecraft-launcher-lib requests pyinstaller
if errorlevel 1 ( echo Не получилось установить библиотеки. Проверьте интернет. & pause & exit /b )

rem ---- 3. Сборка exe ----
echo [2/4] Собираю Elytra.exe (1-2 минуты)...
%PY% -m PyInstaller --noconfirm --clean --onefile --windowed --name Elytra --icon icon.ico --add-data "ui;ui" --add-data "icon.ico;." launcher.py >build.log 2>&1
if not exist "dist\Elytra.exe" ( echo Сборка не удалась, подробности в build.log & pause & exit /b )

rem ---- 4. Копирование в Программы ----
echo [3/4] Устанавливаю в %LOCALAPPDATA%\Programs\Elytra ...
set "DEST=%LOCALAPPDATA%\Programs\Elytra"
taskkill /im Elytra.exe /f >nul 2>&1
if not exist "%DEST%" mkdir "%DEST%"
copy /y "dist\Elytra.exe" "%DEST%\Elytra.exe" >nul
copy /y "uninstall.bat" "%DEST%\uninstall.bat" >nul
copy /y "icon.ico" "%DEST%\icon.ico" >nul

rem ---- 5. Ярлыки и пункт в «Приложениях» ----
echo [4/4] Создаю ярлыки...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w = New-Object -ComObject WScript.Shell; foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $s = $w.CreateShortcut((Join-Path $d 'Elytra.lnk')); $s.TargetPath = '%DEST%\Elytra.exe'; $s.WorkingDirectory = '%DEST%'; $s.IconLocation = '%DEST%\Elytra.exe,0'; $s.Description = 'Elytra — Minecraft launcher'; $s.Save() }"
set "KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Elytra"
reg add "%KEY%" /v DisplayName /d "Elytra" /f >nul
reg add "%KEY%" /v DisplayIcon /d "%DEST%\Elytra.exe" /f >nul
reg add "%KEY%" /v DisplayVersion /d "0.10.1" /f >nul
reg add "%KEY%" /v Publisher /d "Elytra" /f >nul
reg add "%KEY%" /v InstallLocation /d "%DEST%" /f >nul
reg add "%KEY%" /v UninstallString /d "\"%DEST%\uninstall.bat\"" /f >nul
reg add "%KEY%" /v NoModify /t REG_DWORD /d 1 /f >nul
reg add "%KEY%" /v NoRepair /t REG_DWORD /d 1 /f >nul

rem ---- 6. Установщик для друзей (если стоит Inno Setup) ----
set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if exist "%ISCC%" (
  "%ISCC%" /Q installer.iss && echo Установщик для друзей: dist\Elytra-Setup.exe
)

echo.
echo Готово! Elytra на рабочем столе и в меню Пуск.
start "" "%DEST%\Elytra.exe"
timeout /t 4 >nul
