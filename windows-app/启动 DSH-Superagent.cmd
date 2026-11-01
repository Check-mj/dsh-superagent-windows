@echo off
rem ==========================================================================
rem  DSH-Superagent portable launcher
rem  Double-click this file (or the Desktop shortcut) to start DSH-Superagent.
rem
rem  --no-sandbox / --disable-gpu are required on machines where the app is
rem  launched from a restricted/sandboxed context (Chromium would otherwise
rem  crash before any JavaScript runs). They are harmless otherwise.
rem
rem  Optional environment overrides:
rem    SUPERAGENT_PROFILE     profile name (default: superagent)
rem    SUPERAGENT_PORT        backend port (default: 0 = OS-assigned)
rem    SUPERAGENT_STATE_DIR   override the plugin stateDir (testing)
rem    SUPERAGENT_USER_DATA   override the app data directory
rem ==========================================================================
setlocal
set "APP=%~dp0Superagent.exe"
if exist "%APP%" goto :run
set "APP=%~dp0Superagent\Superagent.exe"
if exist "%APP%" goto :run
set "APP=%~dp0..\Superagent.exe"
:run
if not exist "%APP%" (
  echo Superagent.exe not found next to this launcher.
  pause
  exit /b 1
)
start "" "%APP%" --no-sandbox --disable-gpu %*
exit /b 0
