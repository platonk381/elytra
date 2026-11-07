@echo off
chcp 65001 >nul
title Удаление Elytra
echo Удалить Elytra? Ваши сборки, миры и настройки останутся в %%APPDATA%%\.elytra
choice /c YN /m "Да (Y) / Нет (N)"
if errorlevel 2 exit /b
taskkill /im Elytra.exe /f >nul 2>&1
powershell -NoProfile -Command "Remove-Item -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Elytra.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Elytra.lnk')"
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Elytra" /f >nul 2>&1
echo Elytra удалена.
cd /d "%TEMP%"
start "" /min cmd /c "cd /d "%TEMP%" & timeout /t 2 >nul & rmdir /s /q "%~dp0.""
