# Shared by the standalone Windows form and its no-desktop-effects tests.
Set-StrictMode -Version Latest

function Test-ZyraRestartTarget {
    param($Target, [int]$ExpectedPid, [string]$ExpectedStartTicks, [string]$ExePath)
    try {
        return $null -ne $Target -and -not $Target.HasExited -and $Target.Id -eq $ExpectedPid -and
            $Target.StartTime.ToUniversalTime().Ticks.ToString() -ceq $ExpectedStartTicks -and
            [IO.Path]::GetFullPath($Target.Path).Equals([IO.Path]::GetFullPath($ExePath), [StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Test-ZyraRestartObservation {
    param($Observation, [bool]$LegacyConfirmed = $false)
    if ($null -eq $Observation) { return $false }
    if ($Observation.ready -is [bool] -and $Observation.ready) { return $true }
    return $LegacyConfirmed -and $Observation.reason -eq 'legacy-activity-unavailable' -and
        $Observation.requiresConfirmation -is [bool] -and $Observation.requiresConfirmation
}

function Request-ZyraWindowClose {
    param($Target, [int]$ExpectedPid, [string]$ExpectedStartTicks, [string]$ExePath, $Observation, [bool]$LegacyConfirmed = $false)
    $age = [double]::PositiveInfinity
    try { $age = ([DateTime]::UtcNow - [DateTime]::Parse($Observation.observedAt).ToUniversalTime()).TotalSeconds } catch {}
    if (-not (Test-ZyraRestartObservation $Observation $LegacyConfirmed) -or $age -lt 0 -or $age -gt 10) { throw 'Work is active or its status is unknown. Nothing was closed.' }
    if (-not (Test-ZyraRestartTarget $Target $ExpectedPid $ExpectedStartTicks $ExePath)) { throw 'The app changed since this helper opened. Nothing was closed.' }
    # WM_CLOSE invokes Electron's normal save/quit handlers. Never kill a PID/tree.
    if (-not $Target.CloseMainWindow()) { throw 'Zyra did not accept a normal window-close request. Use Quit in the app; nothing was forced.' }
}

function Start-ZyraAfterExit {
    param($Target, [string]$ExePath, [scriptblock]$Launch)
    if (-not $Target.HasExited) { throw 'Zyra is still saving or has refused to quit. Nothing was forced.' }
    & $Launch $ExePath
}

function New-ZyraRestartProcessInfo {
    param([string]$ExePath)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $ExePath
    $info.WorkingDirectory = Split-Path -Parent $ExePath
    $info.UseShellExecute = $false
    # The helper may have been launched by the agent's Node environment.
    [void]$info.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
    return $info
}
