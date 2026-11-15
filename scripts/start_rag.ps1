#Requires -Version 7.4
param(
    # Kept for compatibility; configured LLM support is now always used.
    [switch]$UseConfiguredLLM,
    [switch]$StartInfrastructure,
    [ValidateRange(1, 65535)]
    [int]$BackendPort = 8000,
    [ValidateRange(1, 65535)]
    [int]$FrontendPort = 3000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $projectRoot "backend"
$frontendDirectory = Join-Path $projectRoot "frontend"
$pythonPath = Join-Path $backendDirectory ".venv\Scripts\python.exe"
$nextPath = Join-Path $frontendDirectory "node_modules\next\dist\bin\next"
$dataDirectory = Join-Path $projectRoot ".data"
$statePath = Join-Path $dataDirectory "repolens-processes.json"
$backendOutputLog = Join-Path $dataDirectory "repolens-backend.out.log"
$backendErrorLog = Join-Path $dataDirectory "repolens-backend.err.log"
$frontendOutputLog = Join-Path $dataDirectory "repolens-frontend.out.log"
$frontendErrorLog = Join-Path $dataDirectory "repolens-frontend.err.log"

function Assert-PortAvailable([int]$Port) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::IPv6Any, $Port)
    $listener.Server.DualMode = $true
    $listener.Server.ExclusiveAddressUse = $true
    try {
        $listener.Start()
    }
    catch {
        throw "端口 $Port 已被占用或无法绑定。请先停止原服务，或通过 -BackendPort / -FrontendPort 指定其他端口。"
    }
    finally {
        $listener.Stop()
    }
}

function Wait-ServiceReady($Process, [string]$Url, [string]$Name, [string]$ErrorLog) {
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while ([DateTime]::UtcNow -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "$Name 进程已退出（退出码 $($Process.ExitCode)），请检查 $ErrorLog。"
        }
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3 | Out-Null
            # A failed new server must not be mistaken for an existing server.
            Start-Sleep -Milliseconds 300
            $Process.Refresh()
            if ($Process.HasExited) {
                throw "$Name 进程已退出，请检查 $ErrorLog。"
            }
            return
        }
        catch {
            if ($Process.HasExited) {
                throw "$Name 进程已退出，请检查 $ErrorLog。"
            }
            Start-Sleep -Milliseconds 500
        }
    }
    throw "$Name 在 120 秒内没有就绪，请检查 $ErrorLog。"
}

if ($BackendPort -eq $FrontendPort) {
    throw "前后端不能使用同一个端口。"
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot ".env") -PathType Leaf)) {
    throw "未找到项目根目录的 .env。请先复制 .env.example 为 .env 并配置数据库、模型和向量库。"
}
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    throw "未找到 backend/.venv。请先创建虚拟环境并安装 backend/requirements.txt。"
}
if (-not (Test-Path -LiteralPath $nextPath -PathType Leaf)) {
    throw "未找到 Next.js。请先在 frontend 目录执行 npm install。"
}
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
Assert-PortAvailable $BackendPort
Assert-PortAvailable $FrontendPort

if ($StartInfrastructure) {
    Get-Command docker.exe -ErrorAction Stop | Out-Null
    & docker.exe compose --project-directory $projectRoot up -d --wait --wait-timeout 180 postgres etcd minio milvus
    if ($LASTEXITCODE -ne 0) {
        throw "基础设施启动失败，请检查 Docker Desktop 和 docker compose 日志。"
    }
}

New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

# Old versions changed the caller's environment. Remove those demo overrides
# only in the child process, so Pydantic can read the real .env configuration.
$backendEnvironment = @{}
$demoDatabasePath = (Join-Path $dataDirectory "repolens-local-demo.db").Replace("\", "/")
if ($env:DATABASE_URL -eq "sqlite:///$demoDatabasePath" -and $env:EMBEDDING_MODEL -eq "deterministic-demo") {
    foreach ($name in @(
        "DATABASE_URL", "MILVUS_ENABLED", "EMBEDDING_PROVIDER", "EMBEDDING_MODEL",
        "EMBEDDING_DIMENSIONS", "AUTO_SYNC_ENABLED", "DEMO_MODE", "LLM_API_KEY",
        "RAG_LLM_ENABLED", "RAGAS_ENABLED", "PYTHONPATH"
    )) {
        $backendEnvironment[$name] = $null
    }
    Write-Host "已在后端子进程中清除旧脚本遗留的演示配置，恢复读取 .env。"
}

$backendProcess = $null
$frontendProcess = $null
try {
    Write-Host "正在按 .env 配置启动后端……"
    $backendProcess = Start-Process `
        -FilePath $pythonPath `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort") `
        -WorkingDirectory $backendDirectory `
        -Environment $backendEnvironment `
        -RedirectStandardOutput $backendOutputLog `
        -RedirectStandardError $backendErrorLog `
        -WindowStyle Hidden `
        -PassThru
    Wait-ServiceReady $backendProcess "http://127.0.0.1:$BackendPort/health" "后端" $backendErrorLog

    # Launch Node directly so the recorded PID owns the Next.js process tree.
    Write-Host "正在启动前端……"
    $frontendProcess = Start-Process `
        -FilePath $nodePath `
        -ArgumentList @(('"' + $nextPath + '"'), "dev", "--hostname", "127.0.0.1", "--port", "$FrontendPort") `
        -WorkingDirectory $frontendDirectory `
        -Environment @{ NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:$BackendPort" } `
        -RedirectStandardOutput $frontendOutputLog `
        -RedirectStandardError $frontendErrorLog `
        -WindowStyle Hidden `
        -PassThru
    Wait-ServiceReady $frontendProcess "http://127.0.0.1:$FrontendPort" "前端" $frontendErrorLog

    @{
        backend = @{ pid = $backendProcess.Id; startTimeTicks = "$($backendProcess.StartTime.ToUniversalTime().Ticks)" }
        frontend = @{ pid = $frontendProcess.Id; startTimeTicks = "$($frontendProcess.StartTime.ToUniversalTime().Ticks)" }
    } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $statePath -Encoding utf8

    Write-Host "RepoLens AI 已启动："
    Write-Host "  前端：http://127.0.0.1:$FrontendPort"
    Write-Host "  后端：http://127.0.0.1:$BackendPort"
    Write-Host "  API 文档：http://127.0.0.1:$BackendPort/docs"
    Write-Host "  日志目录：$dataDirectory"
    Write-Host "  停止命令：& `"$(Join-Path $PSScriptRoot 'stop_rag.ps1')`""
    Write-Host "功能开关、数据库、Embedding、Milvus、LLM 和自动同步均遵循后端配置；不写入演示数据或修改知识库配置。"
}
catch {
    foreach ($process in @($frontendProcess, $backendProcess)) {
        if ($process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F | Out-Null
        }
    }
    throw
}
