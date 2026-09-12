@echo off
setlocal
title Cork Manager - Windows Installer Builder
echo.
echo ==========================================
echo       Cork Manager Windows Builder
echo ==========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install the current Node.js LTS from https://nodejs.org/
  echo Then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm was not found. Reinstall Node.js LTS.
  pause
  exit /b 1
)

echo Node:
node --version
echo npm:
npm --version
echo.

if exist node_modules (
  echo Existing node_modules found.
) else (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
)

echo.
echo Building the Windows NSIS installer...
call npx electron-builder --win nsis
if errorlevel 1 goto :fail

echo.
echo ==========================================
echo BUILD SUCCESSFUL
echo ==========================================
echo Installer files are in:
echo %CD%\dist
echo.
explorer "%CD%\dist"
pause
exit /b 0

:fail
echo.
echo ==========================================
echo BUILD FAILED
echo ==========================================
echo The error above is the reason no dist folder was created.
echo Please copy the error text if you need help.
pause
exit /b 1
