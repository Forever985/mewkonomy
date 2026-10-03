@echo off
rem ---------------------------------------------------------------------------
rem  MewKonomy - one-click push (just double-click this file)
rem
rem  The real work lives in push-once.ps1, mirroring the layout of
rem  (the 1-click deploy bat -> deploy-once.ps1). It reuses the SAME network and
rem  credential recipe as deploy-once.ps1:
rem    * local HTTPS CONNECT relay scripts\local-github-proxy.mjs on 127.0.0.1:7899
rem      (Git for Windows' libcurl does not read the hosts file that Watt Toolkit
rem       rewrites, so git is pointed at this plain HTTP proxy instead)
rem    * temporary GIT_CONFIG_GLOBAL with credential.helper=wincred and
rem      GIT_CONFIG_NOSYSTEM=1, so the system-level helper-selector (which pops a
rem      blocking GCM dialog) never interferes. Your global config is untouched.
rem
rem  Keep this file ASCII-only + CRLF (Chinese text would be mangled by the
rem  console code page); chcp 65001 makes git's UTF-8 output readable.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
title MewKonomy Push to GitHub

cd /d "%~dp0"

echo.
echo ========== [1/2] Flush DNS ==========
ipconfig /flushdns >nul 2>&1
echo   DNS cache flushed

echo.
echo ========== [2/2] Push ==========
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push-once.ps1" -NoPause
set PS_EXIT=%errorlevel%

echo.
if "%PS_EXIT%"=="0" (
    echo   [OK] Push finished.
) else (
    echo   [!!] Push failed, please check the log above.
)
echo.
pause
exit /b %PS_EXIT%
