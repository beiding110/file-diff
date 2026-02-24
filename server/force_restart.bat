@echo off
REM ========================================
REM  强制重启服务器（清除所有缓存）
REM ========================================

chcp 65001 >nul 2>nul

echo.
echo ╔══════════════════════════════════════════════════════╗
║     强制重启服务器 - 清除所有缓存                      ║
╚══════════════════════════════════════════════════════════╝
echo.

REM 步骤 1: 停止所有 Node.js 进程
echo [1/4] 停止所有 Node.js 进程...
taskkill /F /IM node.exe >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo    ✓ 已停止 Node.js 进程
) else (
    echo    ⚠️  没有运行中的 Node.js 进程
)
timeout /t 2 /nobreak >nul

REM 步骤 2: 清除 npm 缓存
echo.
echo [2/4] 清除 npm 缓存...
call npm cache clean --force >nul 2>nul
echo    ✓ npm 缓存已清除

REM 步骤 3: 清除 Node.js require 缓存
echo.
echo [3/4] 清除 Node.js 模块缓存...
if exist "node_modules\.cache" (
    rmdir /s /q "node_modules\.cache" >nul 2>nul
    echo    ✓ 模块缓存已清除
) else (
    echo    ⚠️  没有找到模块缓存
)

REM 步骤 4: 启动服务器
echo.
echo [4/4] 启动服务器...
echo.
echo ╔══════════════════════════════════════════════════════╗
║   🚀 正在启动服务器...                                  ║
╚══════════════════════════════════════════════════════════╝
echo.
echo    启动后，请确认看到版本号：
echo    🚀 BidComparator API Server v2024-02-11-bull4x-fixed
echo.
echo ═══════════════════════════════════════════════════════
echo.

node server.js

REM 如果启动失败
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ╔══════════════════════════════════════════════════════╗
    ║   ❌ 服务器启动失败！                                    ║
    ╚══════════════════════════════════════════════════════════╝
    echo.
    pause
    exit /b 1
)

echo.
echo 服务器已停止
pause
