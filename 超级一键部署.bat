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
REM DO NOT go back to `npx gh-pages -d dist` here.
REM That command defaults to CLEAN=true: it wipes the whole gh-pages branch first,
REM which deletes data/ (data.json, market.json and every market_history_*.json shard
REM maintained by GitHub Actions). It already destroyed the archive once (commit a4192aa).
REM scripts\publish-gh-pages.mjs only syncs non-data files and aborts if any data/ file
REM is missing or resized, so it cannot wipe the archive.
set REPO=https://github.com/Forever985/mewkonomy.git
set ATTEMPT=0

:deploy
set /a ATTEMPT+=1
echo   publish-gh-pages.mjs ^(attempt %ATTEMPT%/3^)...
node "%~dp0scripts\publish-gh-pages.mjs" --dir dist --repo %REPO%
if not errorlevel 1 goto ok
if %ATTEMPT% GEQ 3 goto failed
echo   failed, retrying in 5s...
timeout /t 5 >nul
goto deploy

:failed
echo.
echo GH-PAGES FAILED after 3 attempts.
echo If it is a network error (Connection reset / Could not connect to github.com),
echo start the local relay first, then run this file again:
echo     node scripts\local-github-proxy.mjs
echo and set HTTPS_PROXY=http://127.0.0.1:7899 for the git commands.
pause
exit /b 1

:ok
echo.
echo ========== DONE ==========
echo https://forever985.github.io/mewkonomy/
pause
