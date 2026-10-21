$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-restart-window-core.ps1')
function Assert-True($value, $message) { if (-not $value) { throw $message } }
function Assert-Refused([scriptblock]$action) {
    $refused = $false
    try { & $action } catch { $refused = $true }
    Assert-True $refused 'Unsafe restart was not refused'
}
$script:closeCalls = 0
$script:launchCalls = 0
$started = [DateTime]::UtcNow.AddMinutes(-1)
$ticks = $started.Ticks.ToString()
$exe = 'C:\fixture-only\Zyra Preview.exe'
$target = [pscustomobject]@{ Id=4321; HasExited=$false; StartTime=$started; Path=$exe }
$target | Add-Member ScriptMethod CloseMainWindow { $script:closeCalls++; return $true }
$observation = [pscustomobject]@{ ready=$true; observedAt=[DateTime]::UtcNow.ToString('o') }
Assert-True (Test-ZyraRestartTarget $target 4321 $ticks $exe) 'Exact process rejected'
Assert-Refused { Request-ZyraWindowClose $target 1234 $ticks $exe $observation }
Assert-Refused { Request-ZyraWindowClose $target 4321 'wrong-start' $exe $observation }
Assert-Refused { Request-ZyraWindowClose $target 4321 $ticks 'C:\another-app.exe' $observation }
foreach ($ready in @($false, 'true', 1)) {
    Assert-Refused { Request-ZyraWindowClose $target 4321 $ticks $exe ([pscustomobject]@{ ready=$ready; observedAt=[DateTime]::UtcNow.ToString('o') }) }
}
foreach ($time in @([DateTime]::UtcNow.AddMinutes(-1), [DateTime]::UtcNow.AddMinutes(1))) {
    Assert-Refused { Request-ZyraWindowClose $target 4321 $ticks $exe ([pscustomobject]@{ ready=$true; observedAt=$time.ToString('o') }) }
}
Assert-True ($script:closeCalls -eq 0) 'A rejected click closed the window'
$legacy = [pscustomobject]@{ ready=$false; reason='legacy-activity-unavailable'; requiresConfirmation=$true; observedAt=[DateTime]::UtcNow.ToString('o') }
Assert-Refused { Request-ZyraWindowClose $target 4321 $ticks $exe $legacy }
Assert-True (Test-ZyraRestartObservation $legacy $true) 'Legacy window-only restart requires a separate user confirmation'
$busy = [pscustomobject]@{ ready=$false; reason='busy'; observedAt=[DateTime]::UtcNow.ToString('o') }
Assert-Refused { Request-ZyraWindowClose $target 4321 $ticks $exe $busy $true }
Request-ZyraWindowClose $target 4321 $ticks $exe $observation
Assert-True ($script:closeCalls -eq 1) 'A verified click must request a normal close once'
$launch = { param($path) Assert-True ($path -eq $exe) 'Wrong executable'; $script:launchCalls++ }
Assert-Refused { Start-ZyraAfterExit $target $exe $launch }
Assert-True ($script:launchCalls -eq 0) 'Relaunched before normal exit'
$target.HasExited = $true
Start-ZyraAfterExit $target $exe $launch
Assert-True ($script:launchCalls -eq 1) 'Confirmed exit did not relaunch'
Assert-Refused { Request-ZyraWindowClose $target 4321 $ticks $exe $observation }
$info = New-ZyraRestartProcessInfo $exe
Assert-True ($info.FileName -eq $exe -and -not $info.UseShellExecute -and $info.Arguments -eq '') 'Launch must target only the exact app'
Assert-True (-not $info.EnvironmentVariables.ContainsKey('ELECTRON_RUN_AS_NODE')) 'App inherited Node-only mode'
foreach ($name in @('runtime-restart-window.ps1', 'runtime-restart-window-core.ps1')) {
    $errors = $null; $tokens = $null
    [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors)
    Assert-True ($errors.Count -eq 0) "PowerShell parse failed: $name"
}
Write-Output 'Restart window: exact PID/start/path, idle/fresh click gate, graceful exit only, no launch before exit; tested without controlling any app'
