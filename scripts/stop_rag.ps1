#Requires -Version 7.4
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $projectRoot ".data\repolens-processes.json"

if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    Write-Host "没有找到启动记录，服务可能尚未启动或已经停止。"
    return
}

$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
foreach ($name in @("frontend", "backend")) {
    $record = $state.$name
    $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if (-not $process) {
        Write-Host "$name 已停止。"
        continue
    }
    # PIDs can be reused; never terminate a different process with the same ID.
    if ("$($process.StartTime.ToUniversalTime().Ticks)" -ne $record.startTimeTicks) {
        Write-Host "$name 的原进程已退出，跳过被复用的 PID $($record.pid)。"
        continue
    }
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    if ($LASTEXITCODE -ne 0 -and -not $process.HasExited) {
        throw "无法停止 $name，请检查进程权限后重试。"
    }
    Write-Host "$name 已停止。"
}
Remove-Item -LiteralPath $statePath
Write-Host "前后端已停止。数据库和 Milvus 等基础设施保持运行。"
