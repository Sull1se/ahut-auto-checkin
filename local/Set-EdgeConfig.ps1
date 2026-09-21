<#
.SYNOPSIS
    自动获取系统 Microsoft Edge 浏览器路径并更新 wise-checkin.config.json 配置
.DESCRIPTION
    多源探测系统安装的 Edge 浏览器路径与当前用户 User Data 目录，并更新配置文件中的 browserPath 与 userDataDir 字段。
.PARAMETER ConfigPath
    目标配置文件路径，默认读取脚本同目录下的 wise-checkin.config.json。
.PARAMETER CustomEdgePath
    手动指定 Edge 路径（若指定则跳过自动检索）。
.PARAMETER NoBackup
    若指定，则在修改前不创建 .bak 备份文件。
#>
[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [string]$ConfigPath = '',

    [Parameter()]
    [string]$CustomEdgePath = '',

    [Parameter()]
    [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "      AHUT 签到工具 - Edge 浏览器自动检测与配置      " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

# 1. 探测 Edge 可执行文件路径
$edgePath = $null

if (-not [string]::IsNullOrWhiteSpace($CustomEdgePath)) {
    if (Test-Path -LiteralPath $CustomEdgePath) {
        $edgePath = (Get-Item -LiteralPath $CustomEdgePath).FullName
        Write-Host "[检测] 使用用户指定 Edge 路径: $edgePath" -ForegroundColor Green
    } else {
        Write-Error "[错误] 指定的 Edge 路径不存在: $CustomEdgePath"
        exit 1
    }
} else {
    Write-Host "[检测] 正在检索系统中的 Microsoft Edge 安装路径..." -ForegroundColor Cyan

    $candidates = @(
        # 注册表 App Paths (系统与当前用户)
        (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)',
        (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)',
        # 注册表 WOW6432Node
        (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)',
        (Get-ItemProperty 'HKCU:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)',
        # 常见环境变量标准安装路径
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
        "${env:LOCALAPPDATA}\Microsoft\Edge\Application\msedge.exe",
        # 默认系统固定路径兜底
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    )

    foreach ($candidate in $candidates) {
        if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
            $edgePath = (Get-Item -LiteralPath $candidate).FullName
            break
        }
    }

    # PATH 环境变量兜底
    if (-not $edgePath) {
        try {
            $whereResult = where.exe msedge 2>$null
            if ($whereResult) {
                $first = if ($whereResult -is [array]) { $whereResult[0] } else { $whereResult }
                if (Test-Path -LiteralPath $first) {
                    $edgePath = (Get-Item -LiteralPath $first).FullName
                }
            }
        } catch {}
    }
}

if (-not $edgePath) {
    Write-Host "=====================================================" -ForegroundColor Red
    Write-Host "[错误] 未能在系统中检测到 Microsoft Edge 浏览器！" -ForegroundColor Red
    Write-Host "=====================================================" -ForegroundColor Red
    Write-Host "排查建议:" -ForegroundColor Yellow
    Write-Host "1. 请确认您的电脑上已安装 Microsoft Edge；"
    Write-Host "2. 若安装在非标准目录，可通过传参指定路径执行: .\Set-EdgeConfig.ps1 -CustomEdgePath '您的路径\msedge.exe'；"
    Write-Host "3. 或直接手动打开 wise-checkin.config.json 修改 browserPath 字段。"
    exit 1
}

Write-Host "[成功] 已定位 Edge 路径: $edgePath" -ForegroundColor Green

# 2. 定位 Edge 用户数据目录 (User Data)
$localAppData = $env:LOCALAPPDATA
if ($localAppData -match 'exebox-sandbox' -and (Test-Path "C:\Users\$env:USERNAME\AppData\Local")) {
    $localAppData = "C:\Users\$env:USERNAME\AppData\Local"
}
$edgeUserData = Join-Path $localAppData 'Microsoft\Edge\User Data'
Write-Host "[检测] 对应 Edge 用户数据目录: $edgeUserData" -ForegroundColor Gray

# 3. 校验配置文件路径
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $ConfigPath = Join-Path $PSScriptRoot 'wise-checkin.config.json'
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Error "[错误] 找不到目标配置文件: $ConfigPath"
    exit 1
}

# 4. 解析与更新配置
try {
    $rawContent = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
    $config = $rawContent | ConvertFrom-Json
} catch {
    Write-Error "[错误] 解析配置文件失败: $_"
    exit 1
}

# 备份原文件
if (-not $NoBackup) {
    $backupPath = "$ConfigPath.bak"
    Copy-Item -LiteralPath $ConfigPath -Destination $backupPath -Force
    Write-Host "[备份] 原配置文件已备份至: $backupPath" -ForegroundColor Cyan
}

$oldBrowserPath = $config.browserPath
$oldUserDataDir = $config.userDataDir

$config.browserPath = $edgePath
$config.userDataDir = $edgeUserData

# 转换为格式化 JSON 并还原 URL 中的 & (避免 \u0026)
$newJson = ($config | ConvertTo-Json -Depth 10)
$newJson = $newJson -replace '\\u0026', '&'

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ConfigPath, $newJson + "`n", $utf8NoBom)

Write-Host "=====================================================" -ForegroundColor Green
Write-Host "       Edge 浏览器路径自动检测与配置替换完成         " -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "[替换] browserPath:" -ForegroundColor Yellow
Write-Host "   旧值: $oldBrowserPath" -ForegroundColor Gray
Write-Host "   新值: $edgePath" -ForegroundColor Green
Write-Host "[替换] userDataDir:" -ForegroundColor Yellow
Write-Host "   旧值: $oldUserDataDir" -ForegroundColor Gray
Write-Host "   新值: $edgeUserData" -ForegroundColor Green
Write-Host "-----------------------------------------------------"
Write-Host "[完成] 配置文件已更新: $ConfigPath" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Green
