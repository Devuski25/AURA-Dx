# verify-aura.ps1 - AURA-Dx Mini PC end-to-end health check (Windows / PowerShell 5.1)
#
#   .\deploy\mini-pc\verify-aura.ps1
#
# Checks every layer of the stack separately, because they ALL fail with the
# same misleading browser message ("No 'Access-Control-Allow-Origin'"):
#   1. backend listening on :8001          4. inference local /health
#   2. inference listening on :8000        5. public preflight  -> 200 + ACAO
#   3. backend local /api/health           6. public GET        -> 200 + ACAO
#
# Exit code = number of failed checks (0 = healthy), so it works in schedtasks/CI.

param(
    [string]$FrontendOrigin = "https://auradx.xyz",
    [switch]$SkipPublic     # skip steps 5-6 (offline / tunnel intentionally down)
)

$ErrorActionPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:Fail = 0

function Check([string]$Name, [bool]$Ok, [string]$Detail = "") {
    if ($Ok) {
        Write-Host ("  [PASS] {0,-34} {1}" -f $Name, $Detail) -ForegroundColor Green
    } else {
        Write-Host ("  [FAIL] {0,-34} {1}" -f $Name, $Detail) -ForegroundColor Red
        $script:Fail++
    }
}

function Test-Port([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

Write-Host "=== AURA-Dx verify ==="
Write-Host "root: $((Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))"
Write-Host ""

Write-Host "Layers (local):"
Check "backend listening :8001" (Test-Port 8001)
Check "inference listening :8000" (Test-Port 8000)

$tunnelUp = $false
$svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") { $tunnelUp = $true; $how = "windows service" }
elseif (Get-Process -Name cloudflared -ErrorAction SilentlyContinue) { $tunnelUp = $true; $how = "process" }
Check "cloudflared tunnel up" $tunnelUp $(if ($tunnelUp) { $how } else { "not running - see start-aura-services.ps1 start" })

$backendHealth = $null
try {
    $backendHealth = Invoke-RestMethod -Uri "http://localhost:8001/api/health" -TimeoutSec 8
} catch { }
Check "backend /api/health" ($null -ne $backendHealth -and $backendHealth.status -in @("healthy", "degraded")) `
    $(if ($backendHealth) { "status=$($backendHealth.status) db=$($backendHealth.services.database) infer=$($backendHealth.services.inference)" } else { "unreachable" })

$inferOk = $false
try {
    $r = Invoke-WebRequest -Uri "http://localhost:8000/health" -TimeoutSec 8 -UseBasicParsing
    $inferOk = ($r.StatusCode -eq 200)
} catch { }
Check "inference /health" $inferOk

if (-not $SkipPublic) {
    Write-Host ""
    Write-Host "Layers (public, through Cloudflare Tunnel):"

    # --- preflight ---
    $preOk = $false; $preDetail = ""
    try {
        $resp = Invoke-WebRequest -Uri "https://api.auradx.xyz/api/screenings" -Method Options `
            -Headers @{ "Origin" = $FrontendOrigin; "Access-Control-Request-Method" = "GET"; "Access-Control-Request-Headers" = "authorization" } `
            -TimeoutSec 15 -UseBasicParsing
        $acao = $resp.Headers["Access-Control-Allow-Origin"]
        $preOk = ($resp.StatusCode -eq 200 -and $acao -eq $FrontendOrigin)
        $preDetail = "HTTP $($resp.StatusCode) ACAO=$acao"
    } catch {
        $code = ""
        if ($_.Exception.Response) { try { $code = [int]$_.Exception.Response.StatusCode } catch { } }
        $preDetail = if ($code -eq 530 -or $code -eq 502) { "HTTP $code - tunnel not reachable (error 1033 = cloudflared down)" } else { "error: $($_.Exception.Message)" }
    }
    Check "preflight OPTIONS /api/screenings" $preOk $preDetail

    # --- real GET with Origin ---
    $getOk = $false; $getDetail = ""
    try {
        $resp = Invoke-WebRequest -Uri "https://api.auradx.xyz/api/health" `
            -Headers @{ "Origin" = $FrontendOrigin } -TimeoutSec 15 -UseBasicParsing
        $acao = $resp.Headers["Access-Control-Allow-Origin"]
        $getOk = ($resp.StatusCode -eq 200 -and $acao -eq $FrontendOrigin)
        $getDetail = "HTTP $($resp.StatusCode) ACAO=$acao"
    } catch {
        $getDetail = "error: $($_.Exception.Message)"
    }
    Check "GET /api/health with Origin" $getOk $getDetail
}

Write-Host ""
if ($script:Fail -eq 0) {
    Write-Host "ALL CHECKS PASSED" -ForegroundColor Green
} else {
    Write-Host "$($script:Fail) CHECK(S) FAILED" -ForegroundColor Red
    Write-Host "Start/restart the stack with: .\deploy\mini-pc\start-aura-services.ps1 restart"
}
exit $script:Fail
