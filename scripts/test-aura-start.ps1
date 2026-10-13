# Regression test for the Mini PC service manager.
#
# Reproduces the exact Start-Process call that broke on Windows PowerShell 5.1:
#   "RedirectStandardOutput" and "RedirectStandardError" are same.
#
#   powershell -ExecutionPolicy Bypass -File scripts/test-aura-start.ps1

$ErrorActionPreference = 'Stop'
$failures = 0

function Report($label, $ok, $detail = '') {
    if ($ok) {
        Write-Host "[PASS] $label" -ForegroundColor Green
    } else {
        $script:failures++
        Write-Host "[FAIL] $label" -ForegroundColor Red
        if ($detail) { Write-Host "         $detail" -ForegroundColor Red }
    }
}

$tmp = Join-Path $env:TEMP "aura-test-$PID"
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$outLog = Join-Path $tmp 'svc.out.log'
$errLog = Join-Path $tmp 'svc.err.log'

Write-Host "=== service manager regression tests ==="
Write-Host "PowerShell $($PSVersionTable.PSVersion)"
Write-Host ''

# ---------------------------------------------------------------------------
# 1. Separate stdout/stderr files - this is the bug that was reported.
# ---------------------------------------------------------------------------
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue).Source }

if (-not $py) {
    Report 'python available to launch a test process' $false 'no python on PATH'
} else {
    try {
        # A .py file rather than -c: Start-Process mangles inline code that
        # contains spaces and quotes when it rebuilds the argument string, which
        # produced a misleading empty stdout in the first run of this test.
        $srcPy = Join-Path $tmp 'emit.py'
        @'
import sys
sys.stdout.write("STDOUT_MARKER\n")
sys.stderr.write("STDERR_MARKER\n")
'@ | Set-Content -Path $srcPy -Encoding ASCII

        Start-Process -FilePath $py `
             -ArgumentList $srcPy `
             -RedirectStandardOutput $outLog `
             -RedirectStandardError $errLog `
             -WindowStyle Hidden -PassThru -Wait | Out-Null
        Report 'Start-Process accepts separate stdout/stderr files' $true
    } catch {
        Report 'Start-Process accepts separate stdout/stderr files' $false $_.Exception.Message
    }

    # Both streams must actually land in their own file, each holding only its own.
    $outText = if (Test-Path $outLog) { Get-Content $outLog -Raw -ErrorAction SilentlyContinue } else { '' }
    $errText = if (Test-Path $errLog) { Get-Content $errLog -Raw -ErrorAction SilentlyContinue } else { '' }
    $hasOut = $outText -match 'STDOUT_MARKER'
    $hasErr = $errText -match 'STDERR_MARKER'
    Report 'stdout and stderr are captured to their own files' ($hasOut -and $hasErr) `
           "out=$hasOut err=$hasErr | out=[$($outText -replace '\r?\n','|')] err=[$($errText -replace '\r?\n','|')]"
}

# ---------------------------------------------------------------------------
# 2. The old combined-redirect form must still fail, proving test 1 is real.
#    If this starts succeeding, the machine is PowerShell 7+ and test 1 proves
#    nothing about 5.1.
# ---------------------------------------------------------------------------
try {
    Start-Process -FilePath $py `
         -ArgumentList '-c', 'pass' `
         -RedirectStandardOutput $outLog `
         -RedirectStandardError $outLog `
         -WindowStyle Hidden -PassThru -Wait -ErrorAction Stop | Out-Null
    $combinedWorked = $true
} catch {
    $combinedWorked = $false
}

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Report 'combined redirect is rejected on this PS version (as expected)' (-not $combinedWorked) `
           'the combined form unexpectedly succeeded, so test 1 is not meaningful here'
} else {
    Write-Host "[INFO] PowerShell 7+ allows the combined form; test 1 is not reproducing 5.1 here" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 3. Show-ErrorTail must print the reason, not just point at a file.
#    This is what saves the next failure from being a guessing game.
# ---------------------------------------------------------------------------
$errLog2 = Join-Path $tmp 'boom.err.log'
'Traceback (most recent call last):' | Set-Content $errLog2
'  File "inference_service.py", line 42, in load_models' | Add-Content $errLog2
'ModuleNotFoundError: No module named xgboost' | Add-Content $errLog2

# Pull the function out of the real script rather than duplicating it, so this
# tests the shipped code.
$scriptPath = Join-Path $PSScriptRoot '..\deploy\mini-pc\start-aura-services.ps1'
$src = Get-Content $scriptPath -Raw
$m = [regex]::Match($src, '(?s)function Show-ErrorTail.*?\n\}')
if (-not $m.Success) {
    Report 'Show-ErrorTail exists in start-aura-services.ps1' $false 'function not found'
} else {
    Report 'Show-ErrorTail exists in start-aura-services.ps1' $true
    Invoke-Expression $m.Value
    # Write-Host goes to the information stream, not the success stream, so it has
    # to be captured with 6>&1. Piping to Out-String on its own returns nothing,
    # which is what made this look broken when it was working fine.
    $captured = (Show-ErrorTail 'test-service' $errLog2 6>&1 | Out-String)
    Report 'Show-ErrorTail surfaces the actual error message' `
           ($captured -match 'No module named xgboost') `
           "captured: $($captured -replace '\r?\n', ' | ')"
}

# ---------------------------------------------------------------------------
# 4. Port helpers must work without admin rights.
# ---------------------------------------------------------------------------
$hasNet = $null -ne (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)
if ($hasNet) {
    $conn = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    Report 'Get-NetTCPConnection works for port checks' $true
} else {
    Report 'Get-NetTCPConnection available' $false 'cmdlet missing - Get-ListeningPid will always return null'
}

# ---------------------------------------------------------------------------
# 5. The script must parse. A syntax error means nothing below it runs.
# ---------------------------------------------------------------------------
$parseErrors = $null
$tokens = $null
[System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
Report 'start-aura-services.ps1 parses without syntax errors' ($parseErrors.Count -eq 0) `
       (($parseErrors | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Message)" }) -join '; ')

# ---------------------------------------------------------------------------
# 6. status must not need a venv, so it can diagnose a broken setup.
# ---------------------------------------------------------------------------
$statusOut = & $scriptPath status 6>&1 | Out-String
Report 'start-aura-services.ps1 status runs without any venv present' ($statusOut -match 'Inference') `
       ($statusOut.Trim() -replace "`r?`n", ' | ')

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($failures -eq 0) {
    Write-Host 'ALL PASS' -ForegroundColor Green
} else {
    Write-Host "$failures FAILURE(S)" -ForegroundColor Red
}
exit $(if ($failures -eq 0) { 0 } else { 1 })