@echo off
rem Starts the Guitar Theory helper and opens the app in the browser.
rem Make a shortcut to this file on the Desktop. Leave the window open while
rem you play; closing it stops the helper. Nothing leaves this computer.
cd /d "%~dp0..\.."
if not exist "tools\songimport\.venv\Scripts\songimport.exe" (
  echo The import tool is not set up yet. Run this first, then try again:
  echo   powershell -ExecutionPolicy Bypass -File tools\songimport\setup.ps1
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo Building the app once...
  call npm run build
)
"tools\songimport\.venv\Scripts\songimport.exe" serve
if errorlevel 1 pause
