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
#
# stdout and stderr MUST go to separate files. Windows PowerShell 5.1 rejects
# Start-Process outright when both are pointed at the same path:
#
#     Start-Process : This command cannot be run because
#     "RedirectStandardOutput" and "RedirectStandardError" are same.
#
# PowerShell 7 allows it, but this script has to run on 5.1 because that is
# what ships with Windows. Separate files are better anyway - uvicorn writes
# model-load progress to stderr and tracebacks to stderr too, and merging the
# two streams loses the distinction when you come to debug a failed start.
$StateDir = Join-Path $env:LOCALAPPDATA 'AURA-Dx'
$BackendPidFile = Join-Path $StateDir 'backend.pid'
$InferPidFile   = Join-Path $StateDir 'inference.pid'
$BackendOutLog  = Join-Path $StateDir 'backend.out.log'
$BackendErrLog  = Join-Path $StateDir 'backend.err.log'
$InferOutLog    = Join-Path $StateDir 'inference.out.log'
$InferErrLog    = Join-Path $StateDir 'inference.err.log'

function New-StateDir {
    if (-not (Test-Path $StateDir)) {
        New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
    }
}

function Show-ErrorTail([string]$Name, [string]$Path) {
    # When a service dies during startup the only useful thing is the reason, and
    # reading it out of a log file is exactly what nobody does under pressure.
    # Print the last few lines straight into the console.
    Write-Host ''
    Write-Host "  --- $Name error log (last 15 lines) ---" -ForegroundColor Red
    if (Test-Path $Path) {
        $lines = Get-Content $Path -Tail 15 -ErrorAction SilentlyContinue
        if ($lines) {
            $lines | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        } else {
            Write-Host '  (log is empty)' -ForegroundColor Red
        }
    } else {
        Write-Host "  (no log at $Path)" -ForegroundColor Red
    }
    Write-Host "  --- full log: $Path ---" -ForegroundColor Red
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
         -RedirectStandardOutput $InferOutLog `
         -RedirectStandardError $InferErrLog `
         -WindowStyle Hidden -PassThru
    $p.Id | Out-File -FilePath $InferPidFile -Encoding ascii

    # Both models load at startup, which takes a while on CPU. Wait for the
    # port rather than reporting success the moment the process appears.
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 1
        if ($null -ne (Get-ListeningPid $InferPort)) { break }
        if ($p.HasExited) {
            Write-Host 'FAILED' -ForegroundColor Red
            Show-ErrorTail 'inference' $InferErrLog
            throw 'Inference exited during startup. Check the log above.'
        }
    }

    if ($null -eq (Get-ListeningPid $InferPort)) {
        Write-Host 'TIMED OUT' -ForegroundColor Red
        Show-ErrorTail 'inference' $InferErrLog
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
         -RedirectStandardOutput $BackendOutLog `
         -RedirectStandardError $BackendErrLog `
         -WindowStyle Hidden -PassThru
    $p.Id | Out-File -FilePath $BackendPidFile -Encoding ascii

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        if ($null -ne (Get-ListeningPid $BackendPort)) { break }
        if ($p.HasExited) {
            Write-Host 'FAILED' -ForegroundColor Red
            Show-ErrorTail 'backend' $BackendErrLog
            throw 'Backend exited during startup. Check the log above.'
        }
    }

    if ($null -eq (Get-ListeningPid $BackendPort)) {
        Write-Host 'TIMED OUT' -ForegroundColor Red
        Show-ErrorTail 'backend' $BackendErrLog
        return
    }
    Write-Host 'up (port 8001)' -ForegroundColor Green
}

function Stop-One([int]$Port, [string]$Name, [string]$PidFile) {
    # A venv's python.exe is a shim: it launches the real interpreter as a
    # CHILD process. The PID we recorded at start time is the shim, but the
    # process that owns the port is the child. Stop-Process on the shim kills the
    # shim only and leaves uvicorn listening, which means `stop` reports success
    # while the service is still up - precisely the failure this script exists
    # to prevent. taskkill /T kills the whole tree, so both PIDs are targeted.
    $pids = @()

    if (Test-Path $PidFile) {
        $recorded = Get-Content $PidFile -ErrorAction SilentlyContinue
        if ($recorded) { $pids += $recorded.Trim() }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }

    $owner = Get-ListeningPid $Port
    if ($null -ne $owner) { $pids += [string]$owner }

    $pids = $pids | Where-Object { $_ -and (Get-Process -Id $_ -ErrorAction SilentlyContinue) } | Select-Object -Unique
    if ($pids.Count -eq 0) {
        Write-Host "  $Name is already stopped." -ForegroundColor DarkGray
        return
    }

    # Killing the shim takes its child with it, so by the time the loop reaches
    # the child PID the process is already gone and taskkill writes
    # "ERROR: The process N not found." to stderr. Under $ErrorActionPreference
    # 'Stop', PowerShell 5.1 promotes native stderr to a terminating error, which
    # used to abort stop halfway and leave the services running - the exact thing
    # this script must never do. Silence stderr for this call only.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        foreach ($p in $pids) {
            # /T kills the process tree, /F skips the confirmation prompt.
            & taskkill /PID $p /T /F 2>&1 | Out-Null
        }
    } finally {
        $ErrorActionPreference = $previousPreference
    }

    # Confirm rather than assume. A service that is still listening is worse than
    # one that failed to start, because nothing will tell you it is there.
    for ($i = 0; $i -lt 10; $i++) {
        if ($null -eq (Get-ListeningPid $Port)) { break }
        Start-Sleep -Milliseconds 500
    }

    if ($null -eq (Get-ListeningPid $Port)) {
        Write-Host "  $Name stopped (port $Port free)." -ForegroundColor Green
    } else {
        $still = Get-ListeningPid $Port
        Write-Host "  ${Name}: WARNING - port $Port is STILL LISTENING (pid $still)." -ForegroundColor Red
        Write-Host '  Something else has the port, or the process survived the kill.' -ForegroundColor Red
        Write-Host "  Try:  Get-Process -Id $still | Stop-Process -Force" -ForegroundColor Red
    }
}

switch ($Action) {
    'start' {
        Write-Host ''
        Write-Host '  Starting AURA-Dx...' -ForegroundColor Cyan
        try {
            Start-Inference
            Start-Backend
        } catch {
            # Do not leave a half-started pair behind. Backend without inference
            # looks "up" in status but fails every screening with a 502, which is
            # a confusing state to debug later.
            Write-Host ''
            Write-Host '  Start failed - rolling back so nothing is left half-running.' -ForegroundColor Yellow
            Stop-One $BackendPort 'Backend'   $BackendPidFile
            Stop-One $InferPort   'Inference' $InferPidFile
            Write-Host ''
            throw
        }
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
        # Re-invoke as a child process rather than calling the functions directly.
        # A failed stop must not prevent the start from being attempted.
        $self = Join-Path $PSScriptRoot 'aura.ps1'
        & $self stop
        Start-Sleep -Seconds 1
        & $self start
    }
    'status' {
        Get-Status
    }
}