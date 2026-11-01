@echo off
rem Starts the Guitar Theory helper and opens the app in the browser.
rem Make a shortcut to this file on the Desktop. Leave the window open while
rem you play; closing it stops the helper. Nothing leaves this computer.
cd /d "%~dp0..\.."
set "tool=tools\songimport\.venv\Scripts\songimport.exe"
set "venvpy=tools\songimport\.venv\Scripts\python.exe"

rem The import tool lives entirely under tools\songimport. If it is missing,
rem or its Python has gone, build it here first. That needs a Python 3 on
rem the PATH and takes about ten minutes the first time.
set "needsetup="
if not exist "%tool%" set "needsetup=1"
if not defined needsetup (
  "%venvpy%" -c "import songimport" >nul 2>&1
  if errorlevel 1 set "needsetup=1"
)
if defined needsetup (
  echo The import tool needs setting up on this computer. Doing that now...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "tools\songimport\setup.ps1"
  if errorlevel 1 (
    echo.
    echo Setup did not finish. The messages above say why.
    pause
    exit /b 1
  )
  echo.
)

if not exist "dist\index.html" (
  echo Building the app once...
  call npm run build
)
"%tool%" serve
if errorlevel 1 pause
