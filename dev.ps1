# dev.ps1 - COUGHPH service manager (Windows / PowerShell 5.1)
#
# Usage:
#   .\dev.ps1 start      Start all 4 services (Supabase -> Inference -> Backend -> Frontend)
#   .\dev.ps1 restart    Cleanly stop everything (kills orphans), then start fresh
#   .\dev.ps1 stop       Stop everything
#   .\dev.ps1 status     Show which services are up + backend health detail
#
# Notes:
#   - Docker Desktop must be running first (Supabase runs in Docker).
#   - If blocked by execution policy, run:  powershell -ExecutionPolicy Bypass -File .\dev.ps1 <cmd>
#   - Idempotent: 'start' auto-detects already-running services and skips them.
#   - PIDs are tracked in .pids\; kill also sweeps ports 54321/8000/8001/5174 to catch orphans.

param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "restart", "stop", "status")]
    [string]$Command = "status"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidsDir = Join-Path $root ".pids"
$logsDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $pidsDir | Out-Null
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

# --- helpers ---------------------------------------------------------------

function Test-PortListening([int]$Port) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return (@($conns).Count -gt 0)
}

function Stop-PortListener([int]$Port) {
    # Never kill Docker-owned processes - doing so would close Docker Desktop.
    # Supabase (:54321) is managed by `npx supabase start/stop`, never killed by port.
    if ($Port -eq 54321) { return }
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in @($conns)) {
            try {
                $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
                if ($p -and $p.ProcessName -match "docker|com\.docker") { continue }
                Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
            } catch { }
        }
    } catch { }
}

function Write-Pid([string]$Name, [int]$ProcessId) {
    Set-Content -Path (Join-Path $pidsDir "$Name.pid") -Value $ProcessId
}

function Read-Pid([string]$Name) {
    $f = Join-Path $pidsDir "$Name.pid"
    if (Test-Path $f) { return [int](Get-Content $f -Raw).Trim() }
    return $null
}

function Remove-Pid([string]$Name) {
    Remove-Item (Join-Path $pidsDir "$Name.pid") -ErrorAction SilentlyContinue
}

function Wait-Port([int]$Port, [string]$Name, [int]$TimeoutSec = 40) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline -and -not (Test-PortListening $Port)) { Start-Sleep -Milliseconds 700 }
    if (Test-PortListening $Port) {
        Write-Host "  [OK] $Name up on :$Port"
    } else {
        Write-Host "  [FAIL] $Name did not start on :$Port - check logs/${Name}_err.log"
    }
}

function Wait-PortDown([int]$Port, [string]$Name, [int]$TimeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline -and (Test-PortListening $Port)) { Start-Sleep -Milliseconds 700 }
    if (Test-PortListening $Port) {
        Write-Host "  [WARN] $Name still listening on :$Port after $TimeoutSec sec"
    } else {
        Write-Host "  [OK] $Name down on :$Port"
    }
}

function Stop-Service([string]$Name, [int]$Port) {
    $pidVal = Read-Pid $Name
    if ($pidVal) {
        Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
    }
    Remove-Pid $Name
    Stop-PortListener $Port
    Start-Sleep -Milliseconds 500
}

# --- service starts ---------------------------------------------------------

function Resolve-SupabaseCli {
    # Prefer a globally installed CLI, else resolve the one cached by npx.
    # (Bypasses `npx supabase` which can hang on an interactive install prompt.)
    $cmd = Get-Command supabase.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $npxDir = Join-Path $env:LOCALAPPDATA "npm-cache\_npx"
    $cache = Get-ChildItem -LiteralPath $npxDir -Directory -ErrorAction SilentlyContinue |
        ForEach-Object {
            $bin = Join-Path $_.FullName "node_modules\@supabase\cli-windows-x64\bin\supabase.exe"
            if (Test-Path $bin) { [pscustomobject]@{ Path = $bin; Time = $_.LastWriteTime } }
        } | Sort-Object Time -Descending | Select-Object -First 1
    if ($cache) { return $cache.Path }
    return $null
}

function Start-Supabase {
    if (Test-PortListening 54321) {
        Write-Host "  [SKIP] Supabase already running on :54321"
        return
    }
    Write-Host "  [START] Supabase (this can take up to a minute)..."
    docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [FAIL] Docker is not running. Start Docker Desktop first, wait until it is ready, then run '.\dev.ps1 start' again."
        return
    }
    $cli = Resolve-SupabaseCli
    if (-not $cli) {
        Write-Host "  [FAIL] supabase CLI not found. Run 'npm install -g supabase' or 'npx supabase@latest' once to cache it."
        return
    }
    $supDir = Join-Path $root "supabase"
    $proc = Start-Process -FilePath $cli `
        -ArgumentList "start" `
        -WorkingDirectory $supDir `
        -RedirectStandardOutput (Join-Path $logsDir "supabase.log") `
        -RedirectStandardError (Join-Path $logsDir "supabase_err.log") `
        -WindowStyle Hidden -PassThru
    Write-Pid "supabase" $proc.Id
    Wait-Port 54321 "Supabase" 150
    if (Test-PortListening 54321) { return }
    # First-run can fail a healthcheck while the DB restores from backup;
    # storage recovers shortly after. Give the stack one clean retry.
    Write-Host "  [RETRY] Supabase healthcheck not ready yet - retrying once..."
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    $proc = Start-Process -FilePath $cli `
        -ArgumentList "start" `
        -WorkingDirectory $supDir `
        -RedirectStandardOutput (Join-Path $logsDir "supabase.log") `
        -RedirectStandardError (Join-Path $logsDir "supabase_err.log") `
        -WindowStyle Hidden -PassThru
    Write-Pid "supabase" $proc.Id
    Wait-Port 54321 "Supabase" 150
}

function Start-Inference {
    if (Test-PortListening 8000) {
        Write-Host "  [SKIP] Inference already running on :8000"
        return
    }
    Write-Host "  [START] Inference (:8000)..."
    $py = Join-Path $root "packages\inference\venv\Scripts\python.exe"
    $proc = Start-Process -FilePath $py `
        -ArgumentList "-m", "uvicorn", "inference_service:app", "--port", "8000" `
        -WorkingDirectory (Join-Path $root "packages\inference") `
        -RedirectStandardOutput (Join-Path $logsDir "inference.log") `
        -RedirectStandardError (Join-Path $logsDir "inference_err.log") `
        -WindowStyle Hidden -PassThru
    Write-Pid "inference" $proc.Id
    Wait-Port 8000 "Inference"
}

function Start-Backend {
    if (Test-PortListening 8001) {
        Write-Host "  [SKIP] Backend already running on :8001"
        return
    }
    Write-Host "  [START] Backend (:8001)..."
    $py = Join-Path $root "backend\venv\Scripts\python.exe"
    $proc = Start-Process -FilePath $py `
        -ArgumentList "-m", "uvicorn", "main:app", "--port", "8001" `
        -WorkingDirectory (Join-Path $root "backend") `
        -RedirectStandardOutput (Join-Path $logsDir "backend.log") `
        -RedirectStandardError (Join-Path $logsDir "backend_err.log") `
        -WindowStyle Hidden -PassThru
    Write-Pid "backend" $proc.Id
    Wait-Port 8001 "Backend"
}

function Start-Frontend {
    if (Test-PortListening 5174) {
        Write-Host "  [SKIP] Frontend already running on :5174"
        return
    }
    Write-Host "  [START] Frontend (:5174)..."
    $proc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npx vite --port 5174" `
        -WorkingDirectory (Join-Path $root "frontend-new") `
        -RedirectStandardOutput (Join-Path $logsDir "frontend.log") `
        -RedirectStandardError (Join-Path $logsDir "frontend_err.log") `
        -WindowStyle Hidden -PassThru
    Write-Pid "frontend" $proc.Id
    Wait-Port 5174 "Frontend"
}

# --- aggregate commands -----------------------------------------------------

function Start-All {
    Write-Host "=== COUGHPH START ==="
    Start-Supabase
    Start-Inference
    Start-Backend
    Start-Frontend
    Write-Host ""
    Write-Host "Start sequence finished. Run '.\dev.ps1 status' to confirm."
}

function Stop-All {
    Write-Host "=== COUGHPH STOP ==="
    Stop-Service "frontend" 5174
    Stop-Service "backend" 8001
    Stop-Service "inference" 8000
    Write-Host "  [STOP] Supabase..."
    $supPid = Read-Pid "supabase"
    if ($supPid) { Stop-Process -Id $supPid -Force -ErrorAction SilentlyContinue }
    Remove-Pid "supabase"
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c", "npx supabase stop" `
        -WorkingDirectory (Join-Path $root "supabase") `
        -WindowStyle Hidden | Out-Null
    Wait-PortDown 54321 "Supabase"
    Write-Host "  Done."
}

function Show-Status {
    Write-Host "=== COUGHPH SERVICE STATUS ==="
    foreach ($svc in @(
            @{ Name = "Supabase";  Port = 54321 },
            @{ Name = "Inference"; Port = 8000 },
            @{ Name = "Backend";   Port = 8001 },
            @{ Name = "Frontend";  Port = 5174 }
        )) {
        $up = Test-PortListening $svc.Port
        $status = if ($up) { "[OK]  " } else { "[DOWN]" }
        Write-Host ("  {0} {1,-10} on :{2}" -f $status, $svc.Name, $svc.Port)
    }
    Write-Host ""
    try {
        $h = Invoke-RestMethod -Uri "http://localhost:8001/api/health" -TimeoutSec 5
        Write-Host "  Backend health: $($h.status)"
        Write-Host "    database   = $($h.services.database)"
        Write-Host "    inference  = $($h.services.inference)"
        Write-Host "    auth       = $($h.services.auth)"
    } catch {
        Write-Host "  Backend health: unreachable"
    }
}

# --- dispatch ---------------------------------------------------------------

switch ($Command) {
    "start"   { Start-All }
    "restart" { Stop-All; Write-Host ""; Start-All }
    "stop"    { Stop-All }
    "status"  { Show-Status }
}
