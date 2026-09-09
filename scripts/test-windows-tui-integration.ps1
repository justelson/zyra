$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Temporary = Join-Path ([IO.Path]::GetTempPath()) ('zyra terminal [fixture] ' + [Guid]::NewGuid().ToString('N'))
$Previous = @{ LOCALAPPDATA=$env:LOCALAPPDATA; APPDATA=$env:APPDATA; USERPROFILE=$env:USERPROFILE; ZYRA_INSTALL_METADATA=$env:ZYRA_INSTALL_METADATA }
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
try {
  $env:LOCALAPPDATA = Join-Path $Temporary 'local'
  $env:APPDATA = Join-Path $Temporary 'roaming'
  $env:USERPROFILE = Join-Path $Temporary 'home'
  $env:ZYRA_INSTALL_METADATA = 'preserve-fixture-value'
  $CommandDirectory = Join-Path $env:LOCALAPPDATA 'Zyra\bin'
  New-Item -ItemType Directory -Path $CommandDirectory,$env:USERPROFILE -Force | Out-Null
  $Command = Join-Path $CommandDirectory 'zyra.cmd'
  Set-Content -LiteralPath $Command -Value '@exit /b 0' -Encoding Ascii
  $script:ResolvedVersion = '0.6.1'
  $script:SharedIcon = [IO.File]::ReadAllBytes((Join-Path $Root 'desktop\resources\icon.ico'))
  $script:FixtureMetadata = @{format=1;version=$ResolvedVersion;windowsIconBase64=[Convert]::ToBase64String($SharedIcon)} | ConvertTo-Json -Compress
  function Read-FixtureBinary {
    Assert (($args -join ' ') -eq '--version') 'Installer did not use a legacy-safe version-only probe.'
    Assert ($env:ZYRA_INSTALL_METADATA -eq '1') 'New binaries need the metadata opt-in.'
    $global:LASTEXITCODE = 0
    Write-Output $script:FixtureMetadata
  }
  $script:Terminal = Join-Path $Temporary 'wt.exe'
  [IO.File]::WriteAllBytes($script:Terminal, [byte[]]@())
  function Get-Command { param($Name, $CommandType, $ErrorAction)
    Assert ($Name -eq 'wt.exe') 'Unexpected command lookup.'
    if ($script:Terminal) { [pscustomobject]@{ Source=$script:Terminal } }
  }
  $Tokens = $null; $ParseErrors = $null
  $Ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Root 'install.ps1'), [ref]$Tokens, [ref]$ParseErrors)
  Assert ($ParseErrors.Count -eq 0) 'Installer PowerShell syntax is invalid.'
  $Definition = $Ast.Find({ param($Node) $Node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq 'Install-TerminalIntegration' }, $true)
  Assert ($null -ne $Definition) 'Terminal integration function is missing.'
  Invoke-Expression $Definition.Extent.Text
  $Settings = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\settings.json'
  New-Item -ItemType Directory -Path (Split-Path $Settings) -Force | Out-Null
  [IO.File]::WriteAllText($Settings, '// Existing user settings must stay byte-identical.')
  $SettingsBefore = [IO.File]::ReadAllBytes($Settings)
  Install-TerminalIntegration 'Read-FixtureBinary' $Command $CommandDirectory
  Assert ($env:ZYRA_INSTALL_METADATA -eq 'preserve-fixture-value') 'Installer leaked its metadata environment into later launches.'
  $FragmentRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\Zyra'
  $Fragment = Get-Content -LiteralPath (Join-Path $FragmentRoot 'zyra.json') -Raw | ConvertFrom-Json
  Assert ($Fragment.profiles.Count -eq 1) 'Expected exactly one owned profile.'
  Assert ($Fragment.profiles[0].guid -eq '{321ca745-fd51-522f-8dd0-dc7452b78c24}') 'Profile identity changed.'
  Assert ($Fragment.profiles[0].icon -eq 'zyra.ico') 'Profile must use its packaged local icon.'
  Assert ($Fragment.profiles[0].commandline.Contains($Command)) 'Profile must launch the stable TUI command.'
  Assert ($Fragment.profiles[0].startingDirectory -eq $env:USERPROFILE) 'Profile must not start inside the installation.'
  $SharedBytes = [Convert]::ToBase64String($script:SharedIcon)
  Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $FragmentRoot 'zyra.ico'))) -eq $SharedBytes) 'Fragment icon differs from Desktop.'
  Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $CommandDirectory 'zyra.ico'))) -eq $SharedBytes) 'Shortcut icon differs from Desktop.'
  $Link = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Zyra Terminal.lnk'
  $Shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($Link)
  Assert ($Shortcut.TargetPath -eq $script:Terminal) 'Shortcut must use Windows Terminal when available.'
  Assert ($Shortcut.Arguments.Contains($Fragment.profiles[0].guid)) 'Shortcut must select the owned profile.'
  Assert ($Shortcut.IconLocation -eq ((Join-Path $CommandDirectory 'zyra.ico') + ',0')) 'Shortcut has the wrong icon source.'
  Install-TerminalIntegration 'Read-FixtureBinary' $Command $CommandDirectory
  Assert (@(Get-ChildItem -LiteralPath $FragmentRoot -Filter '*.json').Count -eq 1) 'Reinstall duplicated the profile.'
  Assert ([Convert]::ToBase64String([IO.File]::ReadAllBytes($Settings)) -eq [Convert]::ToBase64String($SettingsBefore)) 'Existing Terminal settings changed.'
  $script:Terminal = $null
  Install-TerminalIntegration 'Read-FixtureBinary' $Command $CommandDirectory
  $Shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($Link)
  Assert ($Shortcut.TargetPath -eq $env:ComSpec) 'A machine without Terminal needs a console fallback.'
  Assert ($Shortcut.IconLocation -eq ((Join-Path $CommandDirectory 'zyra.ico') + ',0')) 'Console fallback lost the shared icon.'
  Write-Output 'Windows TUI integration: exact Desktop icon, owned fragment/shortcut, idempotence, fallback and untouched user settings: ok'
} finally {
  foreach ($Name in $Previous.Keys) { Set-Item "Env:$Name" $Previous[$Name] }
  if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Recurse -Force }
}
