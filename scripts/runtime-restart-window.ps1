[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ExePath,
    [Parameter(Mandatory=$true)][int]$ExpectedPid,
    [Parameter(Mandatory=$true)][string]$ExpectedStartTicks,
    [Parameter(Mandatory=$true)][string]$StateDirectory,
    [Parameter(Mandatory=$true)][string]$Channel,
    [Parameter(Mandatory=$true)][string]$NodePath,
    [string]$EvidenceDirectory
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-restart-window-core.ps1')
foreach ($file in @($ExePath, $NodePath)) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'The selected executable is unavailable.' } }
foreach ($argument in @($StateDirectory, $Channel, $PSScriptRoot)) { if ($argument -match '["\r\n]') { throw 'Invalid launch argument.' } }
if (-not [IO.Path]::IsPathRooted($StateDirectory) -or $Channel -notmatch '^[a-z0-9][a-z0-9._-]{0,63}$') { throw 'An explicit runtime namespace is required.' }
$script:target = Get-Process -Id $ExpectedPid -ErrorAction Stop
if (-not (Test-ZyraRestartTarget $script:target $ExpectedPid $ExpectedStartTicks $ExePath)) { throw 'The selected app is no longer the same process.' }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = 'Zyra restart helper'
$form.ClientSize = New-Object Drawing.Size(540, 332)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object Drawing.Font('Segoe UI', 10)
$form.BackColor = [Drawing.Color]::FromArgb(248, 249, 251)

$title = New-Object Windows.Forms.Label
$title.Text = 'Restart Zyra Preview when you are ready'
$title.Font = New-Object Drawing.Font('Segoe UI', 14, [Drawing.FontStyle]::Bold)
$title.SetBounds(24, 22, 492, 32)
$form.Controls.Add($title)
$description = New-Object Windows.Forms.Label
$description.Text = "This is a separate process. Nothing restarts until you click.`r`nWait for this turn to finish. The background agent is never killed."
$description.SetBounds(24, 66, 492, 54)
$form.Controls.Add($description)
$status = New-Object Windows.Forms.Label
$status.Text = 'Checking background work...'
$status.SetBounds(24, 134, 492, 48)
$status.AccessibleName = 'Restart readiness'
$form.Controls.Add($status)
$note = New-Object Windows.Forms.Label
$note.Text = 'Reopens the installed app. Does not install today''s source changes.'
$note.ForeColor = [Drawing.Color]::FromArgb(88, 96, 110)
$note.SetBounds(24, 190, 492, 28)
$form.Controls.Add($note)
$button = New-Object Windows.Forms.Button
$button.Text = 'Restart Zyra Preview'
$button.SetBounds(282, 272, 234, 36)
$button.Enabled = $false
$form.Controls.Add($button)
$cancel = New-Object Windows.Forms.Button
$cancel.Text = 'Not now'
$cancel.SetBounds(160, 272, 110, 36)
$cancel.Add_Click({ $form.Close() })
$form.Controls.Add($cancel)
$form.CancelButton = $cancel
$confirmation = New-Object Windows.Forms.CheckBox
$confirmation.Text = 'This turn has finished. Restart the app window only.'
$confirmation.SetBounds(24, 224, 492, 30)
$confirmation.Visible = $false
$form.Controls.Add($confirmation)
$confirmation.Add_CheckedChanged({
    if ($script:mode -eq 'observe') { $button.Enabled = Test-ZyraRestartObservation $script:observation $confirmation.Checked }
})

$script:mode = 'observe'
$script:probe = $null
$script:nextCheck = [DateTime]::MinValue
$script:closeRequestedAt = $null
$script:observation = $null
$script:evidenceCaptured = $false
function Save-HelperEvidence {
    if (-not $EvidenceDirectory -or $script:evidenceCaptured) { return }
    [void][IO.Directory]::CreateDirectory($EvidenceDirectory)
    # Capture only this form's own controls, never other windows or the desktop.
    $form.Refresh()
    $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
    $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
    $bitmap.Save((Join-Path $EvidenceDirectory 'restart-helper.png'), [Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    [pscustomobject]@{ title=$form.Text; visible=$form.Visible; status=$status.Text; restartEnabled=$button.Enabled; confirmationVisible=$confirmation.Visible; confirmationChecked=$confirmation.Checked; helperPid=$PID; targetPid=$ExpectedPid } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidenceDirectory 'restart-helper-ui.json') -Encoding UTF8
    $script:evidenceCaptured = $true
}
function Start-ReadinessProbe {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $NodePath
    $probeScript = Join-Path $PSScriptRoot 'runtime-restart-status.mjs'
    $info.Arguments = '"' + $probeScript + '" "' + $StateDirectory + '" "' + $Channel + '"'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $script:probe = [Diagnostics.Process]::Start($info)
    $script:outputTask = $script:probe.StandardOutput.ReadToEndAsync()
    $script:errorTask = $script:probe.StandardError.ReadToEndAsync()
    $script:probeStartedAt = [DateTime]::UtcNow
}
function Set-HelperFailure([string]$message) {
    $status.Text = $message
    $button.Enabled = $false
    $script:mode = 'failed'
    $cancel.Enabled = $true
    $cancel.Text = 'Close helper'
}
$button.Add_Click({
    if ($script:mode -ne 'observe' -or -not $button.Enabled) { return }
    # A click buys one fresh check, not permission to restart later when idle.
    $button.Enabled = $false
    $cancel.Enabled = $false
    $status.Text = 'Rechecking work before requesting a normal app exit...'
    $script:mode = 'verify-click'
    $script:clickRequestedAt = [DateTime]::UtcNow
    $script:nextCheck = [DateTime]::MinValue
})
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
    try {
        if ($script:mode -in @('failed', 'done')) { return }
        if ($script:mode -eq 'closing') {
            $script:target.Refresh()
            if ($script:target.HasExited) {
                $script:mode = 'launching'
                Start-ZyraAfterExit $script:target $ExePath {
                    param($path)
                    $launched = [Diagnostics.Process]::Start((New-ZyraRestartProcessInfo $path))
                    $launched.Dispose()
                }
                $script:mode = 'done'
                $status.Text = 'Zyra was reopened. Its Desktop owner handles any safe agent update.'
                $button.Text = 'Restart requested'
                $cancel.Text = 'Close helper'
                $cancel.Enabled = $true
            } elseif (([DateTime]::UtcNow - $script:closeRequestedAt).TotalSeconds -gt 30) {
                Set-HelperFailure 'Zyra has not quit. It may be saving or waiting for a dialog. Nothing was forced.'
            }
            return
        }
        if (-not (Test-ZyraRestartTarget $script:target $ExpectedPid $ExpectedStartTicks $ExePath)) {
            Set-HelperFailure 'The selected app closed or changed. This helper will not target its replacement.'
            return
        }
        if ($null -ne $script:probe) {
            if (-not $script:probe.HasExited) {
                if (([DateTime]::UtcNow - $script:probeStartedAt).TotalSeconds -gt 8) {
                    $script:probe.Kill() # Only our own read-only status subprocess.
                    Set-HelperFailure 'Could not confirm background work. Nothing was restarted.'
                }
                return
            }
            $exitCode = $script:probe.ExitCode
            $output = $script:outputTask.Result
            $script:probe.Dispose()
            $script:probe = $null
            if ($script:mode -eq 'verify-click' -and $script:probeStartedAt -lt $script:clickRequestedAt) {
                Start-ReadinessProbe
                return
            }
            $script:observation = $null
            if ($exitCode -eq 0) { try { $script:observation = $output | ConvertFrom-Json } catch {} }
            $legacy = $null -ne $script:observation -and $script:observation.reason -eq 'legacy-activity-unavailable'
            $confirmation.Visible = $legacy
            if (-not $legacy) { $confirmation.Checked = $false }
            $ready = Test-ZyraRestartObservation $script:observation $confirmation.Checked
            if ($script:mode -eq 'verify-click') {
                if ($ready) {
                    Request-ZyraWindowClose $script:target $ExpectedPid $ExpectedStartTicks $ExePath $script:observation $confirmation.Checked
                    $script:mode = 'closing'
                    $script:closeRequestedAt = [DateTime]::UtcNow
                    $status.Text = 'Waiting for Zyra to save and quit normally...'
                    return
                }
                $script:mode = 'observe'
                $cancel.Enabled = $true
                $status.Text = 'Work is active or unknown. Nothing restarted. Wait, then click again.'
            } elseif ($legacy) {
                $status.Text = 'This older agent cannot report work status. After this turn finishes, confirm below. Restarting the window does not force-stop agent work.'
            } elseif ($ready) {
                $status.Text = 'Ready. The background agent reports no active work.'
            } elseif ($null -ne $script:observation -and $script:observation.reason -eq 'busy') {
                $counts = $script:observation.activity
                $status.Text = "Waiting. Turns: $($counts.activeTurns), background: $($counts.backgroundChats), attention: $($counts.attention).`r`nRequests: $($counts.requests), app/workspace: $($counts.workspaceRequests), tools: $($counts.externalTools)."
            } else { $status.Text = 'Cannot confirm that work is idle. Restart is disabled.' }
            $button.Enabled = $ready
            Save-HelperEvidence
            $script:nextCheck = [DateTime]::UtcNow.AddSeconds(2)
        }
        if ($null -eq $script:probe -and [DateTime]::UtcNow -ge $script:nextCheck) { Start-ReadinessProbe }
    } catch { Set-HelperFailure $_.Exception.Message }
})
$form.Add_FormClosing({
    param($sender, $eventArgs)
    if ($script:mode -in @('verify-click', 'closing', 'launching')) { $eventArgs.Cancel = $true }
})
$form.Add_FormClosed({
    $timer.Stop()
    if ($null -ne $script:probe) {
        if (-not $script:probe.HasExited) { $script:probe.Kill() }
        $script:probe.Dispose()
    }
})
$timer.Start()
[void]$form.ShowDialog()
$timer.Dispose()
$form.Dispose()
$script:target.Dispose()
