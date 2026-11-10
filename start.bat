@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 知幻 · PDF 划词翻译

rem ── 找 Python ────────────────────────────────────────────────
set "PYEXE="
where py >nul 2>nul && set "PYEXE=py -3"
if not defined PYEXE (
  where python >nul 2>nul && set "PYEXE=python"
)
if not defined PYEXE (
  echo.
  echo   未检测到 Python。
  echo.
  echo   请先安装 Python 3.10 或更高版本：
  echo     https://www.python.org/downloads/
  echo   安装时务必勾选 "Add python.exe to PATH"，然后重新双击本文件。
  echo.
  pause
  exit /b 1
)

for /f "tokens=2" %%v in ('%PYEXE% -V 2^>^&1') do set "PYVER=%%v"
echo   使用 Python %PYVER%

rem ── 首次运行：建虚拟环境 + 装依赖 ────────────────────────────
set "VENV=.venv"
if exist ".venv" if not exist "%VENV%\Scripts\python.exe" set "VENV=.venv-win"

if not exist "%VENV%\Scripts\python.exe" (
  echo   首次运行：创建虚拟环境…
  %PYEXE% -m venv %VENV%
  if errorlevel 1 (
    echo   创建虚拟环境失败。
    pause
    exit /b 1
  )
  echo   安装依赖（约 20MB，只需一次）…
  "%VENV%\Scripts\python.exe" -m pip install --upgrade pip >nul 2>nul
  "%VENV%\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo   默认源失败，改用清华镜像重试…
    "%VENV%\Scripts\python.exe" -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    if errorlevel 1 (
      echo.
      echo   依赖安装失败，请检查网络后重试。
      pause
      exit /b 1
    )
  )
)

rem ── 可选：打包成 exe（start.bat --build）──────────────────────
if /i "%~1"=="--build" (
  echo   安装 PyInstaller…
  "%VENV%\Scripts\python.exe" -m pip install pyinstaller
  if errorlevel 1 ( echo   安装失败 & pause & exit /b 1 )
  echo   开始打包（首次约 1–3 分钟）…
  "%VENV%\Scripts\python.exe" -m PyInstaller --noconfirm --clean --onedir --name Zhihuan --add-data "static;static" --collect-submodules uvicorn --collect-submodules websockets --hidden-import uvicorn.logging run.py
  if errorlevel 1 ( echo   打包失败 & pause & exit /b 1 )
  echo.
  echo   完成：dist\Zhihuan\Zhihuan.exe
  echo   整个 dist\Zhihuan 文件夹拷走即可，不再需要 Python。
  pause
  exit /b 0
)

rem ── 启动 ────────────────────────────────────────────────────
"%VENV%\Scripts\python.exe" -u run.py %*
if errorlevel 1 pause
