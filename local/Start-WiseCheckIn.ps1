<#
.SYNOPSIS
    AHUT 考勤系统一键签到/检查自动化启动脚本
.DESCRIPTION
    读取本地配置，生成安全运行编号，唤起指定浏览器并进入全自动签到/状态检查流程。
.PARAMETER Mode
    运行模式：Run（完整签到，满足条件时提交）或 Check（仅检查登录与状态，不提交签到）。默认为 Run。
.PARAMETER ConfigPath
    配置文件路径，默认为脚本同目录下的 wise-checkin.config.json。
#>
[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [ValidateSet('Run', 'Check')]
    [string]$Mode = 'Run',

    [Parameter(Position = 1)]
    [string]$ConfigPath = ''
)

$ErrorActionPreference = 'Stop'

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "     AHUT 考勤系统 · 本地自动化签到终端 (v1.2.0)     " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

# 1. 解析配置文件
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $PSScriptRoot 'wise-checkin.config.json'
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Error "[错误] 找不到配置文件: $ConfigPath"
    exit 1
}

try {
    $configContent = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8
    $config = $configContent | ConvertFrom-Json
} catch {
    Write-Error "[错误] 解析配置文件失败: $_"
    exit 1
}

$browserPath = $config.browserPath
$userDataDir = $config.userDataDir
$profileName = if ($config.profileName) { $config.profileName } else { "Default" }
$loginUrl = if ($config.loginUrl) { $config.loginUrl } else { "https://xskq.ahut.edu.cn/index" }

# 2. 检查浏览器可执行文件
if (-not (Test-Path -LiteralPath $browserPath)) {
    Write-Error "[错误] 浏览器程序不存在: $browserPath"
    exit 2
}

# 3. 生成独立运行编号 (runId)
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$randomSuffix = Get-Random -Minimum 1000 -Maximum 9999
$runId = "run-$timestamp-$randomSuffix"

# 4. 构建携带自动化参数的 Preflight 启动 URL 与统一命令行参数
$separator = if ($loginUrl.Contains('?')) { '&' } else { '?' }
$launchUrl = "$loginUrl${separator}wiseRunId=$runId&wiseMode=Preflight&wiseTargetMode=$Mode"

$modeDescription = if ($Mode -eq 'Check') { "(仅检查状态，不执行最终业务提交)" } else { "(全流程自动签到)" }

$browserProcessName = [System.IO.Path]::GetFileNameWithoutExtension($browserPath)
if ([string]::IsNullOrWhiteSpace($browserProcessName)) {
    $browserProcessName = 'chrome'
}

# 统一冷热启动参数：冷热启动均明确传入 profile-directory 与 user-data-dir
$argList = @()
if (-not [string]::IsNullOrWhiteSpace($profileName)) {
    $argList += "--profile-directory=`"$profileName`""
}
if (-not [string]::IsNullOrWhiteSpace($userDataDir)) {
    $argList += "--user-data-dir=`"$userDataDir`""
}
$argList += "`"$launchUrl`""
$cmdArgs = $argList -join ' '

# 检测浏览器运行状态（冷启动 vs 热启动）
$existingProcs = Get-Process -Name $browserProcessName -ErrorAction SilentlyContinue
$isColdStart = ($null -eq $existingProcs -or $existingProcs.Count -eq 0)
$startupType = if ($isColdStart) { "ColdStart" } else { "HotStart" }

Write-Host "[配置] 运行编号:   $runId" -ForegroundColor Yellow
Write-Host "[配置] 目标模式:   $Mode $modeDescription" -ForegroundColor Yellow
Write-Host "[配置] 启动阶段:   Preflight (单标签页预检与接管确认)" -ForegroundColor Yellow
Write-Host "[配置] 启动类型:   $startupType"
Write-Host "[配置] 浏览器路径: $browserPath"
Write-Host "[配置] 用户配置:   $profileName"
if (-not [string]::IsNullOrWhiteSpace($userDataDir)) {
    Write-Host "[配置] 数据目录:   $userDataDir"
}
Write-Host "[配置] 启动地址:   $loginUrl"
Write-Host "-----------------------------------------------------"

# 本地持久脱敏启动日志记录辅助函数
function Write-StartupLog {
    param(
        [string]$LogRunId,
        [string]$LogMode,
        [string]$LogStartupType,
        [long]$LogDurationMs,
        [string]$LogStatus,
        [int]$LogExitCode
    )
    try {
        $logEntry = [ordered]@{
            timestamp   = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            runId       = $LogRunId
            mode        = $LogMode
            startupType = $LogStartupType
            durationMs  = $LogDurationMs
            status      = $LogStatus
            exitCode    = $LogExitCode
        }
        $jsonLine = $logEntry | ConvertTo-Json -Compress
        $logPath = Join-Path $PSScriptRoot 'wise-startup.log'
        Add-Content -LiteralPath $logPath -Value $jsonLine -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

# 5. 唤起浏览器并执行两阶段页面标题轮询 (250ms 间隔，单次 15s 超时，1 次有限重试)
$maxAttempts = 2
$timeoutSecondsPerAttempt = 15
$pollIntervalMs = 250
$escapedRunId = [regex]::Escape($runId)
$ackRegex = "\[WISE_ACK:$escapedRunId\]"
$ackReceived = $false

$totalStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    if ($attempt -gt 1) {
        Write-Warning "[重试] 预检接管确认超时，正在进行第 $attempt 次有限重试..."
    } else {
        Write-Host "[提示] 正在启动浏览器并进入预检阶段 (第 $attempt 次尝试)..." -ForegroundColor Green
    }

    try {
        Start-Process -FilePath $browserPath -ArgumentList $cmdArgs -ErrorAction Stop
    } catch {
        Write-Error "[错误] 唤起浏览器失败 (第 $attempt 次尝试): $_"
        if ($attempt -eq $maxAttempts) {
            $totalStopwatch.Stop()
            $durationMs = [math]::Round($totalStopwatch.Elapsed.TotalMilliseconds)
            Write-StartupLog -LogRunId $runId -LogMode $Mode -LogStartupType $startupType -LogDurationMs $durationMs -LogStatus "BROWSER_START_FAILED" -LogExitCode 3
            exit 3
        }
        Start-Sleep -Seconds 1
        continue
    }

    Write-Host "[等待] 正在等待浏览器油猴脚本接管响应 [WISE_ACK:$runId] (超时: ${timeoutSecondsPerAttempt}s)..." -ForegroundColor Cyan
    $attemptTimer = [System.Diagnostics.Stopwatch]::StartNew()

    while ($attemptTimer.Elapsed.TotalSeconds -lt $timeoutSecondsPerAttempt) {
        $matchedProc = Get-Process -Name $browserProcessName -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowTitle -and ($_.MainWindowTitle -match $ackRegex) } |
            Select-Object -First 1

        if ($matchedProc) {
            $ackReceived = $true
            break
        }
        Start-Sleep -Milliseconds $pollIntervalMs
    }

    if ($ackReceived) {
        break
    }
}

$totalStopwatch.Stop()
$totalElapsedMs = [math]::Round($totalStopwatch.Elapsed.TotalMilliseconds)

if ($ackReceived) {
    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host " [成功] 捕获到扩展接管确认回执 [WISE_ACK:$runId]！" -ForegroundColor Green
    Write-Host " [耗时] 确认耗时: ${totalElapsedMs}ms" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host "[状态提示]" -ForegroundColor Cyan
    Write-Host "[√] 浏览器脚本已成功接管控制权，正在转入考勤流程。"
    Write-Host "[√] 实时执行进度请关注浏览器右下角【签到自动化看板】。"
    if ($Mode -eq 'Check') {
        Write-Host "[√] Check 模式将在检测并确认状态后安全停下，零写入退出。"
    }
    Write-Host ""
    Write-StartupLog -LogRunId $runId -LogMode $Mode -LogStartupType $startupType -LogDurationMs $totalElapsedMs -LogStatus "ACK_RECEIVED" -LogExitCode 0
    exit 0
} else {
    Write-Host "=====================================================" -ForegroundColor Red
    Write-Host " [失败] 启动接管超时：未能捕获到油猴脚本接管响应！" -ForegroundColor Red
    Write-Host " [详情] 运行编号: $runId | 共尝试: $maxAttempts 次 | 总耗时: ${totalElapsedMs}ms" -ForegroundColor Red
    Write-Host "=====================================================" -ForegroundColor Red
    Write-StartupLog -LogRunId $runId -LogMode $Mode -LogStartupType $startupType -LogDurationMs $totalElapsedMs -LogStatus "ACK_TIMEOUT" -LogExitCode 4
    exit 4
}