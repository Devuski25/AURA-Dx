# dev-backend.ps1 - COUGHPH backend-only service manager (Windows / PowerShell 5.1)
#
# Usage:
#   .\dev-backend.ps1 start      Start backend + inference (no Docker/Supabase needed)
#   .\dev-backend.ps1 restart    Stop then start fresh
#   .\dev-backend.ps1 stop       Stop everything
#   .\dev-backend.ps1 status     Show which services are up + backend health detail
#   .\dev-backend.ps1 tunnel     Start the Cloudflare Tunnel (aura-dx-backend)
#
# Notes:
#   - No Docker required. Starts only inference (:8000) and backend (:8001).
#   - Frontend is on Cloudflare Pages (aura-dx.xyz) — no local dev server needed.
#   - Supabase is the production instance — no local Supabase needed.
#   - Idempotent: 'start' auto-detects already-running services and skips them.
#   - PIDs tracked in .pids\; kill sweeps ports 8000/8001 to catch orphans.

param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "restart", "stop", "status", "tunnel")]
    [string]$Command = "status"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidsDir = Join-Path $root ".pids"
$logsDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $pidsDir | Out-Null
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Test-PortListening([int]$Port) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return (@($conns).Count -gt 0)
}

function Stop-PortListener([int]$Port) {
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in @($conns)) {
            try {
                $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
                if ($p) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
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

function Stop-Service([string]$Name, [int]$Port) {
    $pidVal = Read-Pid $Name
    if ($pidVal) { Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue }
    Remove-Pid $Name
    Stop-PortListener $Port
    Start-Sleep -Milliseconds 500
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

function Start-BackendAll {
    Write-Host "=== COUGHPH BACKEND START ==="
    Start-Inference
    Start-Backend
    Write-Host ""
    Write-Host "  Cloudflare Tunnel: cloudflared tunnel run aura-dx-backend"
    Write-Host "  Start sequence finished. Run '.\dev-backend.ps1 status' to confirm."
}

function Stop-BackendAll {
    Write-Host "=== COUGHPH BACKEND STOP ==="
    Stop-Service "backend" 8001
    Stop-Service "inference" 8000
    Write-Host "  Done."
}

function Show-Status {
    Write-Host "=== COUGHPH BACKEND STATUS ==="
    foreach ($svc in @(
            @{ Name = "Inference"; Port = 8000 },
            @{ Name = "Backend"; Port = 8001 }
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
    Write-Host ""
    $tunnel = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($tunnel) {
        Write-Host "  Tunnel: running (api.aura-dx.xyz -> :8001, infer.aura-dx.xyz -> :8000)"
    } else {
        Write-Host "  Tunnel: not running (start with '.\dev-backend.ps1 tunnel')"
    }
}

function Start-Tunnel {
    $cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
    if (-not (Test-Path $cloudflared)) {
        Write-Host "  [FAIL] cloudflared not found at $cloudflared"
        Write-Host "  Install via: winget install Cloudflare.cloudflared"
        return
    }
    Write-Host "  [START] Cloudflare Tunnel (aura-dx-backend)..."
    Write-Host "  Press Ctrl+C to stop the tunnel."
    & $cloudflared tunnel run aura-dx-backend
}

switch ($Command) {
    "start"   { Start-BackendAll }
    "restart" { Stop-BackendAll; Write-Host ""; Start-BackendAll }
    "stop"    { Stop-BackendAll }
    "status"  { Show-Status }
    "tunnel"  { Start-Tunnel }
}