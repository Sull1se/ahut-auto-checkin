<#
.SYNOPSIS
    自动检测当前发布版路径并一键注册 Windows 任务计划程序
.DESCRIPTION
    读取当前目录下的 Start-WiseCheckIn.ps1，自动配置每日定时签到任务并开启休眠唤醒、重试与网络检测。
.PARAMETER TaskName
    任务名称，默认为 AHUT-WiseCheckIn-Auto。
.PARAMETER DailyTime
    每日触发时间，默认为 22:00:00。
#>
[CmdletBinding()]
param (
    [string]$TaskName = "AHUT-WiseCheckIn-Auto",
    [string]$DailyTime = "22:00:00"
)

$ErrorActionPreference = 'Stop'

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "     AHUT 考勤一键任务计划程序自动化配置工具         " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

# 1. 自动定位发布版与启动脚本绝对路径
$releaseDir = $PSScriptRoot
$scriptPath = Join-Path $releaseDir 'Start-WiseCheckIn.ps1'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    Write-Error "[错误] 在当前目录下找不到启动脚本: $scriptPath"
    exit 1
}

Write-Host "[路径] 工作目录:   $releaseDir" -ForegroundColor Green
Write-Host "[路径] 目标脚本:   $scriptPath" -ForegroundColor Green
Write-Host "[配置] 计划时间:   每天 $DailyTime" -ForegroundColor Yellow

# 2. 检查是否已存在同名任务
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "[提示] 任务 '$TaskName' 已存在，本次将覆盖更新..." -ForegroundColor Yellow
}

# 3. 构造任务动作 (Action)
$powershellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$taskArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -Mode Run"
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $taskArgs -WorkingDirectory $releaseDir

# 4. 构造每天定时触发器 (Trigger)
$parsedTime = [datetime]::Parse($DailyTime)
$trigger = New-ScheduledTaskTrigger -Daily -At $parsedTime

# 5. 构造高级运行条件与设置 (Settings)
$settings = New-ScheduledTaskSettingsSet `
    -WakeToRun `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5)

# 6. 构造执行身份 (Principal)
# 必须为 Interactive (只在用户登录时运行)，才能拥有桌面图形上下文并拉起 Edge 油猴扩展
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$runLevel = if ($isAdmin) { 'Highest' } else { 'Limited' }

$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel $runLevel

# 7. 注册任务计划
try {
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host " [成功] 任务计划 '$TaskName' 已成功创建并就绪！" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host "任务属性摘要:" -ForegroundColor Cyan
    Write-Host " - 触发频次: 每天 $DailyTime"
    Write-Host " - 执行命令: powershell.exe $taskArgs"
    Write-Host " - 起始目录: $releaseDir"
    Write-Host " - 唤醒机制: 开启 (到点自动从休眠唤醒计算机)"
    Write-Host " - 运行身份: $env:USERNAME (只在登录时运行，拥有独立图形会话)"
    Write-Host "-----------------------------------------------------"
    Write-Host "提示: 可通过 Uninstall-WiseTask.cmd 随时卸载该任务。" -ForegroundColor Cyan
    Write-Host "=====================================================" -ForegroundColor Green
} catch {
    Write-Error "[错误] 创建任务计划失败: $_"
    exit 2
}
