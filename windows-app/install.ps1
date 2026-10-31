# Installs Superagent into a per-user directory and creates the shortcuts.
#
# Nothing is pinned to one machine: the install root is a parameter with a
# per-user default, and the plugin checkout is recorded in config\paths.json so
# the two may live in different places.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Root "E:\Apps\Superagent"
[CmdletBinding()]
param(
  [string]$Root,
  [switch]$NoShortcuts,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$appSource = Join-Path $src 'Superagent'
$exeSource = Join-Path $appSource 'Superagent.exe'

Write-Host '=== Superagent installer ===' -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $exeSource)) {
  Write-Host "Not built yet: $exeSource" -ForegroundColor Yellow
  Write-Host 'Build it first (needs the electron devDependency once):' -ForegroundColor Yellow
  Write-Host '  cd ' + $src
  Write-Host '  & "C:\Program Files\nodejs\npm.cmd" install --allow-scripts=electron'
  Write-Host '  node build-portable.js'
  exit 1
}

# Install root: explicit parameter, then SUPERAGENT_HOME, then a per-user default.
if (-not $Root) { $Root = $env:SUPERAGENT_HOME }
if (-not $Root) { $Root = Join-Path $env:LOCALAPPDATA 'Programs\Superagent' }
$Root = [System.IO.Path]::GetFullPath($Root)
Write-Host ("install root : " + $Root)

if ((Test-Path -LiteralPath $Root) -and -not $Force) {
  $existing = Join-Path $Root 'Superagent.exe'
  if (Test-Path -LiteralPath $existing) {
    Write-Host ("Already installed at " + $Root + " (re-run with -Force to overwrite).") -ForegroundColor Yellow
  }
}

# The plugin checkout is this installer's parent directory; record it rather than copy it.
$checkout = (Resolve-Path -LiteralPath (Join-Path $src '..')).Path
Write-Host ("checkout     : " + $checkout)

New-Item -ItemType Directory -Force -Path $Root | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'config') | Out-Null

Write-Host 'Copying the application...'
$copyArgs = @($appSource, $Root, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
if ($Force) { $copyArgs += '/IS' }
$rc = Start-Process -FilePath 'robocopy.exe' -ArgumentList $copyArgs -Wait -PassThru -NoNewWindow
# robocopy: 0-7 are success codes, 8+ are failures.
if ($rc.ExitCode -ge 8) { throw ("robocopy failed with exit code " + $rc.ExitCode) }

$paths = [ordered]@{
  checkout  = $checkout
  installRoot = $Root
  installed = (Get-Date).ToString('o')
}
$pathsJson = Join-Path $Root 'config\paths.json'
[System.IO.File]::WriteAllText($pathsJson, ($paths | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("recorded     : " + $pathsJson)

if (-not $NoShortcuts) {
  $exe = Join-Path $Root 'Superagent.exe'
  $icon = Join-Path $Root 'resources\app\icon.ico'
  if (-not (Test-Path -LiteralPath $icon)) { $icon = Join-Path $Root 'Superagent.exe' }
  $shell = New-Object -ComObject WScript.Shell
  $links = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Superagent.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Superagent\Superagent.lnk')
  )
  foreach ($lnk in $links) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lnk) | Out-Null
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath = $exe
    # Required on machines where Chromium cannot start unsandboxed; harmless elsewhere.
    $s.Arguments = '--no-sandbox --disable-gpu'
    $s.WorkingDirectory = $Root
    $s.IconLocation = "$icon,0"
    $s.Description = 'Superagent - DeepSeek Harness proactive GitHub agent'
    $s.Save()
    Write-Host ("shortcut     : " + $lnk)
  }
}

Write-Host ''
Write-Host 'Done. Start it from the Desktop shortcut (Superagent).' -ForegroundColor Green
Write-Host ('Logs: ' + (Join-Path $env:APPDATA 'Superagent\app.log'))
