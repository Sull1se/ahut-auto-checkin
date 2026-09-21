<#
.SYNOPSIS
    卸载 AHUT 考勤 Windows 任务计划程序
.DESCRIPTION
    注销并删除指定的 AHUT-WiseCheckIn-Auto 定时任务。
.PARAMETER TaskName
    任务名称，默认为 AHUT-WiseCheckIn-Auto。
#>
[CmdletBinding()]
param (
    [string]$TaskName = "AHUT-WiseCheckIn-Auto"
)

$ErrorActionPreference = 'Stop'

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "       AHUT 考勤定时任务计划一键卸载工具             " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if (-not $existingTask) {
    Write-Host "[提示] 系统中未找到名为 '$TaskName' 的任务计划，无需卸载。" -ForegroundColor Yellow
    exit 0
}

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host " [成功] 任务计划 '$TaskName' 已成功移除！" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Green
} catch {
    Write-Error "[错误] 卸载任务计划失败: $_"
    exit 1
}
