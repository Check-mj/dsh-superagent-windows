@echo off
rem Installs Superagent per user (no admin) and creates the shortcuts.
rem   install.cmd                 -> %LOCALAPPDATA%\Programs\Superagent
rem   install.cmd -Root "E:\Apps\Superagent"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %ERRORLEVEL%
