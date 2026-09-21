@echo off
chcp 65001 >nul
title 自动配置 AHUT 考勤计划任务

:: 检查管理员权限，若无则请求 UAC 提权
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [提示] 正在请求管理员权限以配置 Windows 任务计划程序...
    powershell.exe -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-WiseTask.ps1"
pause
