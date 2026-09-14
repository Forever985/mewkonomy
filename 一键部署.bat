@echo off
setlocal
title MewKonomy Deploy GitHub Pages

echo.
echo ========== [1/3] Flush DNS ==========
ipconfig /flushdns >nul 2>&1
echo   DNS cache flushed

echo.
echo ========== [2/3] Build and push (main + gh-pages) ==========
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-once.ps1"
set PS_EXIT=%errorlevel%

echo.
echo ========== [3/3] Done ==========
if "%PS_EXIT%"=="0" (
    echo   [OK] Deploy finished. Visit https://forever985.github.io/mewkonomy/
    echo   Hard refresh with Ctrl+F5 to see new features.
) else (
    echo   [!!] Deploy failed, please check logs above.
)
echo.
pause