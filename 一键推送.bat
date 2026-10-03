@echo off
rem ---------------------------------------------------------------------------
rem  MewKonomy - one-click push (just double-click this file)
rem
rem  Why this file is ASCII-only + CRLF, and keeps delayed expansion OFF:
rem    * ASCII-only -> Chinese text would be mangled by the console code page.
rem    * CRLF       -> matches the other .bat files in this repo.
rem    * no "!"     -> enabledelayedexpansion would swallow the "!" in "[!!]".
rem  chcp 65001 makes git's UTF-8 output (Chinese commit titles) readable.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
title MewKonomy Push to GitHub

cd /d "%~dp0"

set "LOG=%TEMP%\mewkonomy-push.log"

echo.
echo ========== [1/5] Flush DNS ==========
ipconfig /flushdns >nul 2>&1
echo   DNS cache flushed

echo.
echo ========== [2/5] Check repository ==========
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

set "DIRTY="
for /f "tokens=*" %%s in ('git status --porcelain') do set "DIRTY=1"
if defined DIRTY echo   [note] There are uncommitted changes; this script only pushes existing commits.

echo.
echo ========== [3/5] Pre-flight checks ==========
set "WF="
for /f "tokens=*" %%f in ('git diff --name-only "origin/%BRANCH%..%BRANCH%" 2^>nul ^| findstr /I /C:".github/workflows/"') do set "WF=1"
if defined WF (
    echo   [warn] Pending commits modify files under .github/workflows/ :
    git --no-pager diff --name-only "origin/%BRANCH%..%BRANCH%" 2>nul | findstr /I /C:".github/workflows/"
    echo.
    echo          GitHub REJECTS such a push unless the Personal Access Token
    echo          used for this remote has the "workflow" scope.
    echo          Token page: https://github.com/settings/tokens
) else (
    echo   OK - no workflow file changes in the pending commits.
)

echo.
echo ========== [4/5] Push ==========
echo   Running: git push origin %BRANCH%
git push origin %BRANCH% >"%LOG%" 2>&1
if not errorlevel 1 goto :pushed

echo.
echo   [!!] Push failed. Output of the first attempt:
type "%LOG%"
echo.

findstr /I /C:"workflow" "%LOG%" >nul 2>&1
if not errorlevel 1 goto :wfscope

findstr /I /C:"Connection was reset" /C:"Recv failure" /C:"Connection reset" /C:"timed out" /C:"Failed to connect" /C:"Could not resolve" /C:"Empty reply" "%LOG%" >nul 2>&1
if not errorlevel 1 goto :netretry

findstr /I /C:"Authentication failed" /C:"403" /C:"Permission denied" /C:"invalid username or password" "%LOG%" >nul 2>&1
if not errorlevel 1 goto :authfail

goto :unknown

:netretry
echo   [..] Looks like a network error. Retrying with proxy environment variables cleared...
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=
set ALL_PROXY=
git push origin %BRANCH% >"%LOG%" 2>&1
if not errorlevel 1 goto :pushed
echo.
echo   [!!] The retry failed too. Output:
type "%LOG%"
echo.
echo   Connectivity problem. What to check:
echo     1. Is there internet at all?   ping github.com
echo     2. Using a proxy / VPN / Steam++ (Watt Toolkit)?
echo        Steam++ "accelerates" GitHub by rewriting the Windows hosts file
echo        (github.com -^> 127.0.0.1) and reverse-proxying it locally.
echo        To verify a bypass, compare these two:
echo            nslookup github.com
echo            curl -I --resolve github.com:443:20.205.243.166 https://github.com
echo        If the second one works, the network itself is fine and only the
echo        hosts rewrite is in the way - quit Steam++, or disable its GitHub
echo        acceleration, then run this script again.
echo     3. Otherwise switch the proxy node.
goto :fail

:wfscope
echo   [!!] Root cause: the Personal Access Token lacks the "workflow" scope.
echo        GitHub refuses to create or update files under .github/workflows/
echo        unless the token is allowed to manage workflows.
echo.
echo   Fix (about 30 seconds, nothing needs to be re-cloned):
echo     1. Open  https://github.com/settings/tokens
echo     2. Click the token currently used for this repository.
echo     3. Tick the checkbox named "workflow".
echo     4. Scroll to the bottom and press "Update token".
echo     5. Run this script again.
echo.
echo   Alternative: push over SSH instead of HTTPS. No token is involved there,
echo   so the scope rule does not apply - but this machine has no SSH key yet,
echo   so that path needs one-time setup first.
goto :fail

:authfail
echo   [!!] Root cause: GitHub rejected the credentials.
echo        The stored token is probably expired or has been revoked.
echo        Issue a new one at https://github.com/settings/tokens and let the
echo        credential helper store it again (the next push will prompt for it).
goto :fail

:unknown
echo   [!!] Push failed for a reason this script does not recognise.
echo        The full output is shown above. Your commits are safe locally.
goto :fail

:pushed
echo.
echo ========== [5/5] Done ==========
echo   [OK] Pushed branch "%BRANCH%" to origin.
echo.
git --no-pager log --oneline -3
echo.
pause
exit /b 0

:fail
echo.
echo   Push did NOT complete. Your commits are still safe on this machine.
echo   Fix the cause described above, then run this script again.
pause
exit /b 1
