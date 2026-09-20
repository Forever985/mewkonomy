@echo off
cd /d "%~dp0"
title Deploy mewkonomy

echo [1/3] Building...
call pnpm build:public
if errorlevel 1 (
    echo BUILD FAILED
    pause
    exit /b 1
)

echo.
echo [2/3] Pushing main...
git push origin main
if errorlevel 1 (
    echo PUSH failed, retrying once...
    timeout /t 3 >nul
    git push origin main
)

echo.
echo [3/3] Deploying gh-pages...
call npx --yes gh-pages -d dist -b gh-pages --repo https://github.com/Forever985/mewkonomy
if errorlevel 1 (
    echo GH-PAGES FAILED
    pause
    exit /b 1
)

echo.
echo ========== DONE ==========
echo https://forever985.github.io/mewkonomy/
pause