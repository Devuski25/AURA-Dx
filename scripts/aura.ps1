<#
.SYNOPSIS
    Start, stop, restart or check the AURA-Dx backend and inference services.

.DESCRIPTION
    The backend and inference services are NOT long-running daemons. They only
    need to be up while someone is actually using AURA-Dx, so this script is
    how you turn them on when you start working and off when you stop.

    Both services run from the repository checkout on this machine:

        backend/                 -> FastAPI, port 8001
        packages/inference/      -> FastAPI, port 8000

    Inference is started first and health-checked, because the backend calls
    it on every screening. Starting the backend alone leaves screenings failing
    with a 502 until inference is up.

.PARAMETER Action
    start | stop | restart | status

.EXAMPLE
    .\aura.ps1 start
    .\aura.ps1 status
    .\aura.ps1 stop

.NOTES
    Requires each service's venv to exist:
        backend\venv\Scripts\python.exe
        packages\inference\venv\Scripts\python.exe
    Run this from PowerShell, not cmd.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepoRoot 'backend'
$InferDir  = Join-Path $RepoRoot 'packages\inference'

$BackendPort = 8001
$InferPort   = 8000

# PID files are kept out of the repo so they are never committed.
$StateDir = Join-Path $env:LOCALAPPDATA 'AURA-Dx'
$BackendPidFile = Join-Path $StateDir 'backend.pid'
$InferPidFile   = Join-Path $StateDir 'inference.pid'
$BackendLog     = Join-Path $StateDir 'backend.log'
$InferLog       = Join-Path $StateDir 'inference.log'

function New-StateDir {
    if (-not (Test-Path $StateDir)) {
        New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
    }
}

function Get-ListeningPid([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
                Select-Object -First 1
        return $conn.OwningProcess
    } catch {
        return $null
    }
}

function Test-Service([int]$Port, [string]$Path) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port$Path" `
             -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch {
        # A 503 from the health endpoint still means the server is listening,
        # it just has not finished loading models yet.
        if ($_.Exception.Response -and
            [int]$_.Exception.Response.StatusCode -eq 503) { return $true }
        return $false
    }
}

function Get-Status {
    Write-Host ''
    Write-Host '  AURA-Dx service status' -ForegroundColor Cyan
    Write-Host '  ----------------------' -ForegroundColor DarkGray

    $inferUp  = $null -ne (Get-ListeningPid $InferPort)
    $backendUp = $null -ne (Get-ListeningPid $BackendPort)

    $iState = if ($inferUp)  { 'RUNNING' } else { 'stopped' }
    $bState = if ($backendUp) { 'RUNNING' } else { 'stopped' }
    $iColour = if ($inferUp)  { 'Green' } else { 'DarkGray' }
    $bColour = if ($backendUp) { 'Green' } else { 'DarkGray' }

    Write-Host ("  Inference  {0,-8}  http://localhost:{1}/health"     -f $iState,  $InferPort)   -ForegroundColor $iColour
    Write-Host ("  Backend    {0,-8}  http://localhost:{1}/api/health" -f $bState, $BackendPort) -ForegroundColor $bColour

    if ($inferUp) {
        $i = if (Test-Service $InferPort '/health') { 'responding' } else { 'not responding yet (loading models)' }
        Write-Host "              $i" -ForegroundColor DarkGray
    }
    if ($backendUp) {
        $b = if (Test-Service $BackendPort '/api/health') { 'responding' } else { 'not responding yet' }
        Write-Host "              $b" -ForegroundColor DarkGray
    }

    Write-Host ''
    if ($backendUp -and -not $inferUp) {
        Write-Host '  Note: backend is up but inference is not.' -ForegroundColor Yellow
        Write-Host '        Screenings will fail with a 502 until inference starts.' -ForegroundColor Yellow
        Write-Host ''
    }
}

function Start-Inference {
    $python = Join-Path $InferDir 'venv\Scripts\python.exe'
    if (-not (Test-Path $python)) {
        throw "Inference venv not found at $python`n  Create it with:`n  python -m venv packages\inference\venv`n  packages\inference\venv\Scripts\pip install -r packages\inference\requirements.txt"
    }
    if ($null -ne (Get-ListeningPid $InferPort)) {
        Write-Host '  Inference already running.' -ForegroundColor DarkGray
        return
    }

    New-StateDir
    Write-Host '  Starting inference... ' -NoNewline
    $p = Start-Process -FilePath $python `
         -ArgumentList '-m', 'uvicorn', 'inference_service:app', '--host', '0.0.0.0', '--port', "$InferPort" `
         -WorkingDirectory $InferDir `
         -RedirectStandardOutput $InferLog `
         -RedirectStandardError $InferLog `
         -WindowStyle Hidden -PassThru
    $p.Id | Out-File -FilePath $InferPidFile -Encoding ascii

    # Both models load at startup, which takes a while on CPU. Wait for the
    # port rather than reporting success the moment the process appears.
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 1
        if ($null -ne (Get-ListeningPid $InferPort)) { break }
        if ($p.HasExited) {
            Write-Host 'FAILED' -ForegroundColor Red
            Write-Host "  See $InferLog" -ForegroundColor Red
            throw 'Inference exited during startup. Check the log above.'
        }
    }

    if ($null -eq (Get-ListeningPid $InferPort)) {
        Write-Host 'TIMED OUT' -ForegroundColor Red
        Write-Host "  See $InferLog" -ForegroundColor Red
        return
    }
    Write-Host 'up (port 8000)' -ForegroundColor Green
}

function Start-Backend {
    $python = Join-Path $BackendDir 'venv\Scripts\python.exe'
    if (-not (Test-Path $python)) {
        throw "Backend venv not found at $python`n  Create it with:`n  cd backend; python -m venv venv`n  venv\Scripts\pip install -r requirements.txt"
    }
    if ($null -ne (Get-ListeningPid $BackendPort)) {
        Write-Host '  Backend already running.' -ForegroundColor DarkGray
        return
    }

    New-StateDir
    Write-Host '  Starting backend... ' -NoNewline
    $p = Start-Process -FilePath $python `
         -ArgumentList '-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', "$BackendPort" `
         -WorkingDirectory $BackendDir `
         -RedirectStandardOutput $BackendLog `
         -RedirectStandardError $BackendLog `
         -WindowStyle Hidden -PassThru
    $p.Id | Out-File -FilePath $BackendPidFile -Encoding ascii

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if ($null -ne (Get-ListeningPid $BackendPort)) { break }
        if ($p.HasExited) {
            Write-Host 'FAILED' -ForegroundColor Red
            Write-Host "  See $BackendLog" -ForegroundColor Red
            throw 'Backend exited during startup. Check the log above.'
        }
    }

    if ($null -eq (Get-ListeningPid $BackendPort)) {
        Write-Host 'TIMED OUT' -ForegroundColor Red
        return
    }
    Write-Host 'up (port 8001)' -ForegroundColor Green
}

function Stop-One([int]$Port, [string]$Name, [string]$PidFile) {
    # Prefer the PID file, but fall back to whatever owns the port so a service
    # started another way is still stoppable.
    $targetPid = $null
    if (Test-Path $PidFile) {
        $targetPid = Get-Content $PidFile -ErrorAction SilentlyContinue
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }

    $owner = Get-ListeningPid $Port
    if ($null -ne $owner -and $owner -ne $targetPid) {
        $targetPid = $owner
    }

    if ($null -eq $targetPid) {
        Write-Host "  $Name is already stopped." -ForegroundColor DarkGray
        return
    }

    try {
        Stop-Process -Id $targetPid -Force -ErrorAction Stop
        Write-Host "  $Name stopped (pid $targetPid)." -ForegroundColor Green
    } catch {
        Write-Host "  Could not stop ${Name}: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

switch ($Action) {
    'start' {
        Write-Host ''
        Write-Host '  Starting AURA-Dx...' -ForegroundColor Cyan
        Start-Inference
        Start-Backend
        Get-Status
        Write-Host '  Frontend: npm run dev   (run from frontend-new)' -ForegroundColor DarkGray
        Write-Host ''
    }
    'stop' {
        Write-Host ''
        Write-Host '  Stopping AURA-Dx...' -ForegroundColor Cyan
        # Backend first: it calls inference, so taking it down first avoids a
        # window where the UI gets connection errors instead of clean refusals.
        Stop-One $BackendPort 'Backend'   $BackendPidFile
        Stop-One $InferPort   'Inference' $InferPidFile
        Write-Host '  Both services are down.' -ForegroundColor Green
        Write-Host ''
    }
    'restart' {
        & $PSScriptRoot 'aura.ps1' stop
        Start-Sleep -Seconds 1
        & $PSScriptRoot 'aura.ps1' start
    }
    'status' {
        Get-Status
    }
}