@echo off
setlocal
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo NODE_24_REQUIRED: 请先安装 Node.js 24 或更高版本，然后重新打开终端。
  exit /b 2
)
node "%~dp0scripts\doctor.mjs" --text %*
exit /b %errorlevel%
