@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 动感岛 · 感统小游戏
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没有找到 Node.js。请先安装 Node.js 后重新双击本文件。
  echo   下载地址： https://nodejs.org/
  echo.
  pause
  exit /b 1
)
echo.
echo   正在启动动感岛，浏览器窗口马上打开...
start "" "http://127.0.0.1:4321/"
node server.mjs
pause
