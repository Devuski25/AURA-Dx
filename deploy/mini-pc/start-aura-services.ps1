# start-aura-services.ps1 - AURA-Dx Mini PC service manager (Windows / PowerShell 5.1)
#
#   .\start-aura-services.ps1 start     Start inference (:8000) + backend (:8001) + Cloudflare tunnel
#   .\start-aura-services.ps1 stop      Stop everything this setup runs
#   .\start-aura-services.ps1 restart   Stop then start fresh
#   .\start-aura-services.ps1 status    Ports, health and tunnel state (no changes)
#   .\start-aura-services.ps1 install-autostart    Start the stack automatically at logon
#   .\start-aura-services.ps1 uninstall-autostart  Remove that automatic start
#
# Notes
#   - Repo root is resolved from this script's location, so it works from any cwd.
#   - Logs go to <repo>\logs\{inference,backend,cloudflared}.log
#   - If cloudflared is installed as a Windows service (recommended: see README note
#     in verify-aura.ps1), this script will NOT start a second tunnel instance.

param(
    [ValidateSet("start", "stop", "restart", "status", "install-autostart", "uninstall-autostart")]
    [string]$Action = "start"
)

# Auto-start registry entry (HKCU Run). Windows runs this at every logon.
# Used instead of a Windows service or scheduled task: both are refused on this
# machine (StartService error 87 / scheduled task 0xFFFFFFFF), and because this
# script launches the services via WMI it returns immediately - the spawned
# processes survive the launcher exiting.
$AutoStartName = "AURA-Dx Services"
function Get-AutoStartCommand {
    $ps = Join-Path $PSHOME "powershell.exe"
    return "`"$ps`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" start"
}
function Install-AutoStart {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name $AutoStartName -Value (Get-AutoStartCommand)
    Write-Host "[OK] auto-start installed: HKCU Run -> '$AutoStartName'" -ForegroundColor Green
    Write-Host "    value: $(Get-AutoStartCommand)"
}
function Uninstall-AutoStart {
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    Remove-ItemProperty -Path $key -Name $AutoStartName -ErrorAction SilentlyContinue
    Write-Host "[OK] auto-start removed" -ForegroundColor Green
}

$ErrorActionPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# deploy/mini-pc -> repo root
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Logs = Join-Path $Root "logs"
if (-not (Test-Path $Logs)) { New-Item -ItemType Directory -Path $Logs | Out-Null }

$Services = @(
    @{
        Name = "inference"
        Dir  = Join-Path $Root "packages\inference"
        Py   = Join-Path $Root "packages\inference\venv\Scripts\python.exe"
        Args = @("-m", "uvicorn", "inference_service:app", "--host", "0.0.0.0", "--port", "8000")
        Port = 8000
    },
    @{
        Name = "backend"
        Dir  = Join-Path $Root "backend"
        Py   = Join-Path $Root "backend\venv\Scripts\python.exe"
        Args = @("-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001")
        Port = 8001
    }
)

function Get-PortPid([int]$Port) {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
         Select-Object -First 1
    if ($c) { return $c.OwningProcess }
    return $null
}

function Test-Port([int]$Port) { return [bool](Get-PortPid $Port) }

function Show-ErrorTail([string]$Name, [string]$LogPath, [int]$Lines = 15) {
    # When a service dies during startup the only useful thing is the reason, and
    # nobody reads a log file under pressure. Print it.
    Write-Host ""
    Write-Host "  --- $Name log (last $Lines lines) ---" -ForegroundColor Red
    if (Test-Path $LogPath) {
        $tail = Get-Content $LogPath -Tail $Lines -ErrorAction SilentlyContinue
        if ($tail) { $tail | ForEach-Object { Write-Host "  $_" -ForegroundColor Red } }
        else { Write-Host "  (log is empty)" -ForegroundColor Red }
    } else {
        Write-Host "  (no log at $LogPath)" -ForegroundColor Red
    }
    Write-Host "  --- full log: $LogPath ---" -ForegroundColor Red
}

function Stop-PortOwner([int]$Port, [string]$Name) {
    # A venv's python.exe is a shim that launches the real interpreter as a
    # CHILD. The process that owns the port is the child, so Stop-Process on the
    # owning PID is not the whole story - and a plain Stop-Process on a shim PID
    # kills the shim only, leaving uvicorn listening while this script reports
    # success. taskkill /T kills the tree.
    #
    # Killing the tree means a second kill of an already-dead PID writes
    # "ERROR: The process N not found." to stderr. Under ErrorActionPreference
    # Stop, PS 5.1 promotes native stderr to a terminating error and aborts the
    # loop - so the port check is filtered first and stderr is silenced for the
    # duration of the call.
    $pid_ = Get-PortPid $Port
    if (-not $pid_) {
        Write-Host "  [SKIP] $Name not running"
        return
    }

    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        & taskkill /PID $pid_ /T /F 2>&1 | Out-Null
    } finally {
        $ErrorActionPreference = $prev
    }

    # Confirm rather than assume. A service still listening is worse than one
    # that failed to start, because nothing will tell you it is there.
    for ($i = 0; $i -lt 10; $i++) {
        if (-not (Test-Port $Port)) { break }
        Start-Sleep -Milliseconds 500
    }

    if (Test-Port $Port) {
        $still = Get-PortPid $Port
        Write-Host "  [WARN] ${Name}: port $Port STILL LISTENING (PID $still)" -ForegroundColor Red
        Write-Host "         Something else holds the port, or the process survived the kill." -ForegroundColor Red
    } else {
        Write-Host "  [STOP] $Name (port $Port free)"
    }
}

function Wait-Port([int]$Port, [string]$Name, [int]$TimeoutSec = 30) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Port $Port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    Write-Host "  [FAIL] $Name did not open port $Port within ${TimeoutSec}s" -ForegroundColor Red
    return $false
}

function Find-Cloudflared {
    $candidates = @(
        (Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\cloudflared\cloudflared.exe")
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    $onPath = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    return $null
}

function Test-CloudflaredService {
    $svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
    if ($svc) { return ($svc.Status -eq "Running") }
    return $false
}

function Get-TunnelId {
    $cfg = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
    if (-not (Test-Path $cfg)) { return $null }
    $line = Select-String -Path $cfg -Pattern "^\s*tunnel:\s*(\S+)" | Select-Object -First 1
    if ($line) { return $line.Matches[0].Groups[1].Value }
    return $null
}

# Launch via WMI (Win32_Process.Create) instead of Start-Process.
# Start-Process keeps the launching shell attached to the child, which makes
# non-interactive invocations (Task Scheduler, CI, an agent shell) hang until
# the service exits - it looked like a script freeze during `restart`.
# A WMI-spawned process is owned by WmiPrvSE, so this returns immediately.
function Invoke-WmiLaunch([string]$CommandLine) {
    $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
        -Arguments @{ CommandLine = $CommandLine } -ErrorAction SilentlyContinue
    return ($r -and $r.ReturnValue -eq 0)
}

function Start-ServiceProcess($Svc) {
    if (Test-Port $Svc.Port) {
        Write-Host "  [SKIP] $($Svc.Name) already listening on :$($Svc.Port)"
        return
    }
    if (-not (Test-Path $Svc.Py)) {
        Write-Host "  [FAIL] $($Svc.Name): venv python not found at $($Svc.Py)" -ForegroundColor Red
        return
    }
    Write-Host "  [START] $($Svc.Name) (:$($Svc.Port))..."
    $out = Join-Path $Logs "$($Svc.Name).log"
    # Truncate first, otherwise a failure shows the tail of the PREVIOUS run and
    # sends you chasing a problem that already got fixed.
    Set-Content -Path $out -Value "" -ErrorAction SilentlyContinue
    $cmd = "cmd /c cd /d $($Svc.Dir) && $($Svc.Py) $($Svc.Args -join ' ') > $out 2>&1"
    if (-not (Invoke-WmiLaunch $cmd)) {
        Write-Host "  [FAIL] $($Svc.Name): could not launch" -ForegroundColor Red
        return
    }
    if (-not (Wait-Port $Svc.Port $Svc.Name)) {
        Show-ErrorTail $Svc.Name $out
        return
    }
    Write-Host "  [OK] $($Svc.Name) up on :$($Svc.Port)" -ForegroundColor Green
}

function Start-Tunnel {
    if (Test-CloudflaredService) {
        Write-Host "  [SKIP] Cloudflare tunnel already running as a Windows service"
        return
    }
    if (Get-Process -Name cloudflared -ErrorAction SilentlyContinue) {
        Write-Host "  [SKIP] cloudflared tunnel process already running"
        return
    }
    $exe = Find-Cloudflared
    if (-not $exe) {
        Write-Host "  [FAIL] cloudflared.exe not found. Install it first:" -ForegroundColor Red
        Write-Host "         winget install Cloudflare.cloudflared"
        return
    }
    $tunnelId = Get-TunnelId
    if (-not $tunnelId) {
        Write-Host "  [FAIL] no tunnel id in $env:USERPROFILE\.cloudflared\config.yml" -ForegroundColor Red
        return
    }
    Write-Host "  [START] Cloudflare tunnel ($tunnelId)..."
    $log = Join-Path $Logs "cloudflared.log"
    # Launched through run-hidden.vbs (WScript.Shell.Run, windowStyle 0) rather
    # than `cmd /c start /b`. WMI creates processes inside a job object, so a
    # child that detaches from a short-lived cmd is torn down with it - the tunnel
    # registered its connections and died a second later.
    #
    # The command goes through a file because wscript parses its own command line
    # with C quoting rules and a quoted exe path plus two more quoted arguments
    # does not survive the trip; cloudflared is invoked with a truncated path and
    # never starts.
    $runner = Join-Path $PSScriptRoot 'run-hidden.vbs'
    $cmdFile = Join-Path $Logs 'cloudflared.cmd'
    Set-Content -Path $cmdFile -Encoding ASCII -Value (
        "`"$exe`" --logfile `"$log`" --loglevel info tunnel run $tunnelId"
    )
    $cmd = "wscript.exe `"$runner`" `"$cmdFile`""
    if (-not (Invoke-WmiLaunch $cmd)) {
        Write-Host "  [FAIL] tunnel: could not launch" -ForegroundColor Red
        return
    }
    Start-Sleep -Seconds 6
    if (Get-Process -Name cloudflared -ErrorAction SilentlyContinue) {
        Write-Host "  [OK] tunnel process up" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] tunnel exited - check logs\cloudflared_err.log" -ForegroundColor Red
    }
}

function Stop-All {
    foreach ($Svc in $Services) {
        Stop-PortOwner $Svc.Port $Svc.Name
    }
    $svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        Write-Host "  [SKIP] tunnel is a Windows service - stop it with: Stop-Service cloudflared"
    } elseif (Get-Process -Name cloudflared -ErrorAction SilentlyContinue) {
        Write-Host "  [STOP] cloudflared tunnel"
        Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "  [SKIP] tunnel not running"
    }
}

function Show-Status {
    foreach ($Svc in $Services) {
        if (Test-Port $Svc.Port) { $s = "UP" } else { $s = "DOWN" }
        Write-Host ("  {0,-10} :{1,-5} {2}" -f $Svc.Name, $Svc.Port, $s)
    }
    if (Test-CloudflaredService) {
        Write-Host "  tunnel     Windows service: RUNNING"
    } elseif (Get-Process -Name cloudflared -ErrorAction SilentlyContinue) {
        Write-Host "  tunnel     process: RUNNING"
    } else {
        Write-Host "  tunnel     DOWN" -ForegroundColor Red
    }
    try {
        $h = Invoke-RestMethod -Uri "http://localhost:8001/api/health" -TimeoutSec 5
        Write-Host "  backend    health: $($h.status)"
    } catch {
        Write-Host "  backend    health: unreachable" -ForegroundColor Red
    }

    # Local ports being up is not the same as the live website working. The
    # browser calls https://api.auradx.xyz, which only reaches this machine if
    # the tunnel is up. 530 from Cloudflare means "I cannot reach the origin",
    # which is the single most common reason a locally-perfect stack still
    # fails for anyone visiting auradx.xyz.
    $tunnelUp = (Test-CloudflaredService) -or [bool](Get-Process -Name cloudflared -ErrorAction SilentlyContinue)
    if ($tunnelUp) {
        try {
            $r = Invoke-RestMethod -Uri "https://api.auradx.xyz/api/health" -TimeoutSec 20
            Write-Host "  live API   https://api.auradx.xyz -> $($r.status)" -ForegroundColor Green
        } catch {
            $code = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
            Write-Host "  live API   https://api.auradx.xyz -> HTTP $code" -ForegroundColor Red
            if ($code -eq 530) {
                Write-Host "             530 = the tunnel is not carrying traffic." -ForegroundColor Red
                Write-Host "             Restart it, or install it as a Windows service." -ForegroundColor Red
            }
        }
    } else {
        Write-Host "  live API   not reachable (tunnel down)" -ForegroundColor Red
        Write-Host "             The live website cannot reach the backend until the tunnel runs." -ForegroundColor Red
    }
    Write-Host "  logs       $Logs"
}

switch ($Action) {
    "start" {
        Write-Host "=== AURA-Dx start (Mini PC) ==="
        foreach ($Svc in $Services) { Start-ServiceProcess $Svc }
        Start-Tunnel
        Write-Host "Done. Run .\deploy\mini-pc\verify-aura.ps1 to confirm end-to-end."
    }
    "stop" {
        Write-Host "=== AURA-Dx stop ==="
        Stop-All
    }
    "restart" {
        Stop-All
        Start-Sleep -Seconds 2
        foreach ($Svc in $Services) { Start-ServiceProcess $Svc }
        Start-Tunnel
        Write-Host "Done. Run .\deploy\mini-pc\verify-aura.ps1 to confirm end-to-end."
    }
    "status" {
        Write-Host "=== AURA-Dx status ==="
        Show-Status
        $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
        $v = (Get-ItemProperty -Path $key -Name $AutoStartName -ErrorAction SilentlyContinue).$AutoStartName
        if ($v) { Write-Host "  autostart  enabled" } else { Write-Host "  autostart  not installed (run: .\start-aura-services.ps1 install-autostart)" -ForegroundColor Yellow }
    }
    "install-autostart" {
        Install-AutoStart
    }
    "uninstall-autostart" {
        Uninstall-AutoStart
    }
}
