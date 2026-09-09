param(
  [string]$Repo = "justelson/zyra",
  [string]$Version = "latest",
  [string]$InstallDir = "$env:LOCALAPPDATA\Zyra\cli",
  [string]$SourceDirectory = "",
  [switch]$NoPathUpdate,
  [switch]$NoTerminalIntegration
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Headers = @{ "User-Agent" = "Zyra-Installer" }

function Resolve-ReleaseVersion {
  if ($Version -ne "latest") { return $Version.TrimStart("v") }
  if ($SourceDirectory) {
    $candidate = Get-ChildItem -LiteralPath $SourceDirectory -Filter "Zyra-TUI-*-windows-x64.exe" |
      Select-Object -First 1
    if ($candidate -and $candidate.Name -match '^Zyra-TUI-(.+)-windows-x64\.exe$') { return $Matches[1] }
    throw "Could not infer a Zyra version from $SourceDirectory. Pass -Version explicitly."
  }
  $release = Invoke-RestMethod -Headers $Headers -Uri "https://api.github.com/repos/$Repo/releases/latest"
  $resolved = [string]$release.tag_name
  if (-not $resolved) { throw "GitHub did not return a latest Zyra release." }
  return $resolved.TrimStart("v")
}

function Get-ReleaseFile([string]$Name, [string]$Destination) {
  if ($SourceDirectory) {
    $source = Join-Path $SourceDirectory $Name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing local release file: $source" }
    Copy-Item -LiteralPath $source -Destination $Destination -Force
    return
  }
  $url = "https://github.com/$Repo/releases/download/v$ResolvedVersion/$Name"
  Invoke-WebRequest -Headers $Headers -UseBasicParsing -Uri $url -OutFile $Destination
}

function Ensure-UserPath([string]$Directory) {
  if (($env:Path -split ';') -notcontains $Directory) { $env:Path = "$Directory;$env:Path" }
  if ($NoPathUpdate) { return }
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @($userPath -split ';' | Where-Object { $_ })
  if ($parts -contains $Directory) { return }
  $next = if ($userPath) { "$Directory;$userPath" } else { $Directory }
  [Environment]::SetEnvironmentVariable("Path", $next, "User")
  Write-Host "Added $Directory to your user PATH."
}

function Install-TerminalIntegration([string]$Executable, [string]$Command, [string]$CommandDirectory) {
  # Keep exactly one version argument: legacy routers reject extra arguments.
  # New standalone binaries opt into metadata through this child-only environment.
  $previousMetadataMode = [Environment]::GetEnvironmentVariable('ZYRA_INSTALL_METADATA', 'Process')
  try {
    $env:ZYRA_INSTALL_METADATA = '1'
    $response = (& $Executable --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the installed Zyra branding.' }
  } finally {
    [Environment]::SetEnvironmentVariable('ZYRA_INSTALL_METADATA', $previousMetadataMode, 'Process')
  }
  $IconPath = Join-Path $CommandDirectory 'zyra.ico'
  if ($response -eq "zyra $ResolvedVersion") {
    # Legacy releases have the shared mark in their PE resources, but cannot
    # export the original multi-resolution ICO through installer metadata.
    Add-Type -AssemblyName System.Drawing
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($Executable)
    if (-not $icon) { throw 'The legacy Zyra executable has no icon.' }
    try {
      $stream = [System.IO.File]::Create($IconPath)
      try { $icon.Save($stream) } finally { $stream.Dispose() }
    } finally { $icon.Dispose() }
  } else {
    $metadata = $response | ConvertFrom-Json
    if ($metadata.format -ne 1 -or $metadata.version -ne $ResolvedVersion -or -not $metadata.windowsIconBase64 -or $metadata.windowsIconBase64.Length -gt 1400000) {
      throw 'The installed Zyra branding metadata is invalid.'
    }
    $bytes = [Convert]::FromBase64String($metadata.windowsIconBase64)
    if ($bytes.Length -lt 22 -or $bytes.Length -gt 1048576 -or [BitConverter]::ToUInt32($bytes, 0) -ne 65536) { throw 'The Zyra branding asset is not an ICO.' }
    [System.IO.File]::WriteAllBytes($IconPath, $bytes)
  }

  # A fragment adds only Zyra's profile. Never parse or overwrite settings.json,
  # replace the user's default profile, or change unrelated terminal profiles.
  $FragmentDirectory = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\Zyra'
  New-Item -ItemType Directory -Force -Path $FragmentDirectory | Out-Null
  Copy-Item -LiteralPath $IconPath -Destination (Join-Path $FragmentDirectory 'zyra.ico') -Force
  $ProfileId = '{321ca745-fd51-522f-8dd0-dc7452b78c24}'
  $Shell = if ($env:ComSpec) { $env:ComSpec } else { Join-Path $env:SYSTEMROOT 'System32\cmd.exe' }
  $ShellArguments = '/d /s /c ""' + $Command + '""'
  $fragment = @{ profiles = @(@{
    guid = $ProfileId
    name = 'Zyra'
    commandline = '"' + $Shell + '" ' + $ShellArguments
    startingDirectory = $env:USERPROFILE
    icon = 'zyra.ico'
    closeOnExit = 'graceful'
  }) }
  $fragment | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $FragmentDirectory 'zyra.json') -Encoding UTF8

  $StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $StartMenu 'Zyra Terminal.lnk'))
  $terminal = Get-Command wt.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($terminal) {
    $shortcut.TargetPath = $terminal.Source
    $shortcut.Arguments = '-w new new-tab --profile "' + $ProfileId + '"'
  } else {
    $shortcut.TargetPath = $Shell
    $shortcut.Arguments = $ShellArguments
  }
  $shortcut.IconLocation = $IconPath + ',0'
  $shortcut.WorkingDirectory = $env:USERPROFILE
  $shortcut.Description = 'Zyra Terminal'
  $shortcut.Save()
  Write-Host 'Added Zyra Terminal to Start Menu and the Zyra profile to Windows Terminal.'
}

$ResolvedVersion = Resolve-ReleaseVersion
if ($ResolvedVersion -notmatch '^\d+\.\d+\.\d+(?:-(?:alpha|beta)(?:[.-]?\d+)?)?$') {
  throw "Invalid Zyra release version: $ResolvedVersion"
}

$AssetName = "Zyra-TUI-$ResolvedVersion-windows-x64.exe"
$TempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("zyra-install-" + [System.Guid]::NewGuid().ToString("N"))
$DownloadedAsset = Join-Path $TempDirectory $AssetName
$DownloadedChecksums = Join-Path $TempDirectory "SHA256SUMS"
New-Item -ItemType Directory -Force -Path $TempDirectory | Out-Null

try {
  Write-Host "Downloading Zyra $ResolvedVersion for Windows x64..."
  Get-ReleaseFile $AssetName $DownloadedAsset
  Get-ReleaseFile "SHA256SUMS" $DownloadedChecksums
  $checksumLine = Get-Content -LiteralPath $DownloadedChecksums |
    Where-Object { $_ -match "^([a-fA-F0-9]{64})  $([regex]::Escape($AssetName))$" } |
    Select-Object -First 1
  if (-not $checksumLine) { throw "SHA256SUMS does not contain $AssetName." }
  $expectedHash = ($checksumLine -split '  ', 2)[0].ToLowerInvariant()
  $actualHash = (Get-FileHash -LiteralPath $DownloadedAsset -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) { throw "Zyra download failed SHA-256 verification." }

  $VersionDirectory = Join-Path $InstallDir $ResolvedVersion
  $Target = Join-Path $VersionDirectory "zyra.exe"
  New-Item -ItemType Directory -Force -Path $VersionDirectory | Out-Null
  $PendingTarget = Join-Path $VersionDirectory "zyra.pending.exe"
  Copy-Item -LiteralPath $DownloadedAsset -Destination $PendingTarget -Force
  try {
    Copy-Item -LiteralPath $PendingTarget -Destination $Target -Force
    Remove-Item -LiteralPath $PendingTarget -Force
  } catch {
    Write-Host "The current Zyra binary is in use. The verified update is staged for the next launch."
  }

  $CommandDirectory = Join-Path $env:LOCALAPPDATA "Zyra\bin"
  $Command = Join-Path $CommandDirectory "zyra.cmd"
  New-Item -ItemType Directory -Force -Path $CommandDirectory | Out-Null
  $escapedTarget = $Target.Replace('%', '%%')
  $escapedPendingTarget = $PendingTarget.Replace('%', '%%')
  $launcherLine = '"' + $escapedTarget + '" %*'
  $pendingLauncherLine = '"' + $escapedPendingTarget + '" %*'
  $pendingCheckLine = 'if not exist "' + $escapedPendingTarget + '" goto zyra_run_current'
  $promoteLine = 'copy /y "' + $escapedPendingTarget + '" "' + $escapedTarget + '" >nul 2>&1'
  $removePendingLine = 'del /q "' + $escapedPendingTarget + '" >nul 2>&1'
  Set-Content -LiteralPath $Command -Encoding Ascii -Value @(
    '@echo off',
    'rem zyra-standalone-launcher:v2',
    'setlocal',
    $pendingCheckLine,
    $promoteLine,
    'if errorlevel 1 goto zyra_run_pending',
    $removePendingLine,
    ':zyra_run_current',
    $launcherLine,
    'exit /b %ERRORLEVEL%',
    ':zyra_run_pending',
    $pendingLauncherLine,
    'exit /b %ERRORLEVEL%'
  )
  Ensure-UserPath $CommandDirectory

  Write-Host "Checking the installed binary..."
  $LaunchTarget = if (Test-Path -LiteralPath $PendingTarget) { $PendingTarget } else { $Target }
  & $LaunchTarget --version
  if ($LASTEXITCODE -ne 0) { throw "The installed Zyra binary did not start successfully." }
  if (-not $NoTerminalIntegration) { Install-TerminalIntegration $LaunchTarget $Command $CommandDirectory }
} finally {
  Remove-Item -LiteralPath $TempDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Zyra $ResolvedVersion is installed. Open a new terminal and run: zyra"
