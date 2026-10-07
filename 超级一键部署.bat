@echo off
rem ---------------------------------------------------------------------------
rem  MewKonomy - SUPER one-click deploy (build + push main + publish gh-pages)
rem
rem  This file used to re-implement the deploy steps with raw git commands
rem  (pnpm build:public / git push origin main / node publish-gh-pages.mjs).
rem  That duplicate path had NO proxy handling at all, so it only ever worked
rem  when the machine happened to reach GitHub directly - which it usually
rem  cannot:
rem    * Watt Toolkit in "hosts hijack" mode needs the local CONNECT relay
rem      (scripts\local-github-proxy.mjs, default 127.0.0.1:7899);
rem    * Watt Toolkit in "system proxy" mode exposes a plain HTTP proxy
rem      (measured on this machine: 127.0.0.1:10808);
rem    * and HTTP_PROXY in the environment pointed at 127.0.0.1:9044, a port
rem      that LISTENS but never responds - git reads it when it has no explicit
rem      proxy config, then hangs / fails with "invalid index-pack output".
rem
rem  So the fix is to NOT duplicate the logic: delegate to deploy-once.ps1,
rem  which probes every candidate port with a real git call, pins the working
rem  one, and uses a hardened clone (--depth 1 + HTTP/1.1 + big postBuffer).
rem
rem  Keep this file ASCII-only + CRLF (Chinese text would be mangled by the
rem  console code page); chcp 65001 makes git's UTF-8 output readable.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
title MewKonomy SUPER Deploy (main + gh-pages)

cd /d "%~dp0"

echo.
echo ========== [1/2] Flush DNS ==========
ipconfig /flushdns >nul 2>&1
echo   DNS cache flushed

echo.
echo ========== [2/2] Build + push main + publish gh-pages ==========
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-once.ps1" -NoPause
set PS_EXIT=%errorlevel%

echo.
echo ========== Done ==========
if "%PS_EXIT%"=="0" (
    echo   [OK] Deploy finished.
    echo        https://forever985.github.io/mewkonomy/
    echo        Hard refresh with Ctrl+F5 to see new features.
) else (
    echo   [!!] Deploy FAILED - see the log above.
)
echo.
pause
