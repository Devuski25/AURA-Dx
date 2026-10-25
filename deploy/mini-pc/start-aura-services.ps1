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
        # -u: unbuffered stdout. Redirected to a file, Python block-buffers, so
        # a service that is still starting writes nothing and the log looks
        # empty -- which is exactly what a failed start looks like. The
        # difference between "still starting" and "died" is the one thing the
        # log is for.
        # run_service.py rather than uvicorn directly. It sets the Windows
        # Selector event loop before the loop is made, because the default
        # Proactor loop has a bug that kills this service's accept loop
        # after a request, leaving the port open and the service answering
        # nothing. The app string is still on the command line, so the
        # orphan matcher below still finds it.
        Args = @("-u", "run_service.py", "inference_service:app", "--host", "0.0.0.0", "--port", "8000",
                 # Backstop only. The service itself admits a fixed number of
                 # screenings at a time (SCORE_CONCURRENCY); this stops a
                 # runaway client from opening hundreds of connections and
                 # holding hundreds of spooled uploads on disk.
                 "--limit-concurrency", "64")
        Port = 8000
        # Matched by name when hunting orphans. It used to be read positionally
        # as Args[2], which silently became "uvicorn" the moment an argument
        # was added to the front -- and then every service matched every
        # other one's process.
        Module = "inference_service:app"
        # Loading both models off disk takes tens of seconds, and it happens
        # while the backend is starting too, so the two compete for the same
        # CPU and disk. 30s was not enough and the service was reported dead
        # while it was still coming up.
        StartTimeoutSec = 120
    },
    @{
        Name = "backend"
        Dir  = Join-Path $Root "backend"
        Py   = Join-Path $Root "backend\venv\Scripts\python.exe"
        # ONE worker on purpose. The process keeps state that must be
        # consistent across requests -- the profile cache, the heartbeat to
        # service_status, the rate-limit buckets -- and a second worker would
        # mean two of each, with an invalidation in one invisible to the other.
        # Concurrency comes from FastAPI's worker threads instead: blocking
        # handlers (every Supabase call) run there, while the event loop stays
        # free for health checks, status polls and uploads. See routes/api.py.
        Args = @("-u", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001",
                 # A memory backstop, not a quota. This many requests in flight
                 # at once already means something is wrong; refusing them is
                 # better than letting each one allocate.
                 "--limit-concurrency", "200")
        Port = 8001
        Module = "main:app"
        # The backend opens its port well after its own imports finish: the
        # startup path warms the status caches, which calls the inference
        # service, which is itself still loading models. On a busy box that
        # took over 30 seconds and the service was reported down while it was
        # perfectly healthy and about to listen.
        StartTimeoutSec = 120
    }
)

function Get-PortPid([int]$Port) {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
         Select-Object -First 1
    if ($c) { return $c.OwningProcess }
    return $null
}

function Test-Port([int]$Port) { return [bool](Get-PortPid $Port) }

function Get-OrphanPids($Service) {
    # Processes for this service that are ALIVE but own no listening socket.
    #
    # This exists because "is the port listening" and "is the process running"
    # are different questions, and only the first was being asked. On
    # 2026-10-18 the inference service lost its socket to a Windows
    # I/O completion-port failure and kept running:
    #
    #     ERROR: asyncio:Accept failed on a socket
    #     socket: <asyncio.TransportSocket laddr=('0.0.0.0', 8000)>
    #     OSError: [WinError 64] The specified network name is no longer available
    #
    # The process stayed up with both models loaded -- 987 MB, 44 threads --
    # while answering nothing. Get-PortPid returns nothing for it, so
    # Stop-PortOwner reported "not running" and skipped it, and the next start
    # put a SECOND inference service on top of the first.
    #
    # Two inferences loaded on an 8 GB box is how the next one dies, and the
    # cycle repeats: dead socket, orphaned models, no port owner to kill,
    # another instance, less free memory. Measured on this machine -- free RAM
    # was 648 MB with one orphaned inference holding ~1 GB, and killing it
    # returned 1.2 GB immediately.
    #
    # Matched on the uvicorn module argument rather than the executable path,
    # because the venv shim and its real child share one command line and both
    # must go. taskkill /T then takes the tree.
    $module = $Service.Module   # "inference_service:app" / "main:app"
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($module) } |
        Select-Object -ExpandProperty ProcessId
}

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

function Stop-PortOwner([int]$Port, [string]$Name, $Svc) {
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

    # Kill any live process for this service that owns no port -- the
    # dead-socket case Get-OrphanPids documents. Without this the models stay
    # resident and the next start stacks a second copy on top of them.
    $orphans = @(Get-OrphanPids $Svc)
    if ($orphans.Count -gt 0) {
        Write-Host "  [CLEAN] ${Name}: $($orphans.Count) process(es) alive but not listening (orphaned models)"
    }

    if (-not $pid_ -and $orphans.Count -eq 0) {
        Write-Host "  [SKIP] $Name not running"
        return
    }

    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        # Port owner first, then any orphans. /T takes each one's tree, so a
        # shim PID and its real interpreter both die.
        if ($pid_) { & taskkill /PID $pid_ /T /F 2>&1 | Out-Null }
        foreach ($op in $orphans) { & taskkill /PID $op /T /F 2>&1 | Out-Null }
    } finally {
        $ErrorActionPreference = $prev
    }

    # Confirm rather than assume. A service still listening is worse than one
    # that failed to start, because nothing will tell you it is there. The
    # orphan check matters here too: a port that never listened in the first
    # place can pass this loop instantly while the process is still resident.
    for ($i = 0; $i -lt 10; $i++) {
        if (-not (Test-Port $Port) -and @(Get-OrphanPids $Service).Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    }

    $left = @(Get-OrphanPids $Svc)
    if (Test-Port $Port) {
        $still = Get-PortPid $Port
        Write-Host "  [WARN] ${Name}: port $Port STILL LISTENING (PID $still)" -ForegroundColor Red
        Write-Host "         Something else holds the port, or the process survived the kill." -ForegroundColor Red
    } elseif ($left.Count -gt 0) {
        # The dangerous state: nothing answers on the port, so a health check
        # says "down" and looks fine, while a GB of models stays resident and
        # starves the next instance. Worth shouting about.
        Write-Host "  [WARN] ${Name}: port $Port free but $($left.Count) process(es) still resident (PID $($left -join ','))" -ForegroundColor Red
        Write-Host "         Models are still in memory. A restart may fail from lack of RAM." -ForegroundColor Red
    } else {
        Write-Host "  [STOP] $Name (port $Port free, no resident process)"
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
    if (-not $r -or $r.ReturnValue -ne 0) { return 0 }
    return $r.ProcessId
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

    # Reap orphans before launching.
    #
    # A service can be alive with its socket dead -- the Windows
    # I/O completion-port failure does exactly that -- and then it holds its
    # log file open and answers nothing. `start` is the recovery path for
    # exactly that case, so it has to clean up as well as `restart` does.
    # Without this, starting a new instance beside the orphan left two
    # processes fighting over one log file and one port, and the new one never
    # opened the port at all.
    $orphans = @(Get-OrphanPids $Svc)
    if ($orphans.Count -gt 0) {
        Write-Host "  [CLEAN] $($Svc.Name): $($orphans.Count) orphaned process(es) still resident (PID $($orphans -join ','))"
        foreach ($op in $orphans) { & taskkill /PID $op /T /F 2>&1 | Out-Null }
        Start-Sleep -Milliseconds 800
    }

    Write-Host "  [START] $($Svc.Name) (:$($Svc.Port))..."
    $out = Join-Path $Logs "$($Svc.Name).log"
    # Truncate first, otherwise a failure shows the tail of the PREVIOUS run and
    # sends you chasing a problem that already got fixed.
    Set-Content -Path $out -Value "" -ErrorAction SilentlyContinue
    $cmd = "cmd /c cd /d $($Svc.Dir) && $($Svc.Py) $($Svc.Args -join ' ') > $out 2>&1"
    $pid_ = Invoke-WmiLaunch $cmd
    if (-not $pid_) {
        Write-Host "  [FAIL] $($Svc.Name): could not launch" -ForegroundColor Red
        return
    }
    $timeout = if ($Svc.StartTimeoutSec) { $Svc.StartTimeoutSec } else { 30 }
    if (-not (Wait-Port $Svc.Port $Svc.Name $timeout)) {
        # "Did not open the port" and "the process died" are different faults
        # and need different responses. A service that is alive but still
        # starting will come up on its own; killing it and relaunching is the
        # one thing that turns a slow start into a failed one.
        $alive = @(Get-OrphanPids $Svc)
        if ($alive.Count -gt 0) {
            Write-Host "  [SLOW] $($Svc.Name) is alive (PID $($alive -join ',')) but has not opened :$($Svc.Port) yet." -ForegroundColor Yellow
            Write-Host "         It is still starting -- do NOT kill it. Check again in a minute." -ForegroundColor Yellow
        } else {
            Write-Host "  [FAIL] $($Svc.Name) died during startup" -ForegroundColor Red
            Show-ErrorTail $Svc.Name $out
        }
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
        Stop-PortOwner $Svc.Port $Svc.Name $Svc
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
