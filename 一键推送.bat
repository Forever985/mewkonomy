@echo off
rem UTF-8 code page so git's UTF-8 output (Chinese commit titles) is readable in the console.
rem Keep this file ASCII-only + CRLF, and keep delayed expansion OFF
rem (it would swallow the "!" in the "[!!]" markers).
chcp 65001 >nul
title MewKonomy Push to GitHub

cd /d "%~dp0"

echo.
echo ========== [1/4] Flush DNS ==========
ipconfig /flushdns >nul 2>&1
echo   DNS cache flushed

echo.
echo ========== [2/4] Check repository ==========
where git >nul 2>&1
if errorlevel 1 (
    echo   [!!] git was not found in PATH.
    echo        Install Git for Windows, then run this again.
    goto :fail
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo   [!!] This folder is not a git repository:
    echo        %CD%
    goto :fail
)

for /f "tokens=*" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
echo   Branch   : %BRANCH%

for /f "tokens=*" %%r in ('git remote get-url origin 2^>nul') do set "REMOTE=%%r"
if not defined REMOTE (
    echo   [!!] Remote "origin" is not configured.
    goto :fail
)
echo   Remote   : %REMOTE%

echo   Pending commits:
git --no-pager log "origin/%BRANCH%..%BRANCH%" --oneline 2>nul

for /f "tokens=*" %%s in ('git status --porcelain') do set "DIRTY=1"
if defined DIRTY echo   [note] There are uncommitted changes; this script only pushes existing commits.

echo.
echo ========== [3/4] Push ==========
echo   Running: git push origin %BRANCH%
git push origin %BRANCH%
if not errorlevel 1 goto :ok

echo.
echo   [!!] Push failed. Retrying with proxy environment variables cleared...
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=
set ALL_PROXY=
git push origin %BRANCH%
if not errorlevel 1 goto :ok

echo.
echo   [!!] Push still failed. This is a network / proxy problem, not a git problem.
echo        Your commits are safe locally; nothing was lost.
echo.
echo        What to check:
echo          1. Can this machine reach github.com at all?
echo               ping github.com
echo          2. If you use a proxy / VPN client, open its dashboard and make sure
echo             github.com is allowed by the current rule / node.
echo             (On the machine that made these commits the local proxy replied
echo              "CONNECT tunnel failed, response 502" for github.com, while
echo              api.github.com answered 200 - i.e. a per-domain allowlist.)
echo          3. Try switching the proxy node, or turn the proxy off and run again.
goto :fail

:ok
echo.
echo ========== [4/4] Done ==========
echo   [OK] Pushed branch "%BRANCH%" to origin.
echo.
git --no-pager log --oneline -3
echo.
pause
exit /b 0

:fail
echo.
echo   Push did NOT complete. Fix the network and run this script again.
pause
exit /b 1
