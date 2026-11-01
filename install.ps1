# DSH-Superagent — one-line installer (Windows)
#
#   irm https://raw.githubusercontent.com/Check-mj/dsh-superagent-windows/main/install.ps1 | iex
#
# Downloads the release package, verifies its SHA-256, extracts it and runs the installer that ships inside the
# package (the same installer the repository uses, so the on-disk layout is unchanged). Existing configuration and
# state are never touched: the installer only copies the application payload and creates shortcuts.
#
# When piped into `iex` no parameters can be passed, so the overrides are environment variables:
#   $env:DSH_SUPERAGENT_VERSION = '0.1.0'          which release to install
#   $env:DSH_SUPERAGENT_ROOT    = 'E:\Apps\DSH'    install directory (default %LOCALAPPDATA%\Programs\Superagent)
#   $env:DSH_SUPERAGENT_NOSHORTCUTS = '1'          skip Desktop / Start Menu shortcuts
#
# Saved to a file, the switches work too:
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Version 0.1.0 -Root "E:\Apps\DSH"

[CmdletBinding()]
param(
  [string]$Version = $(if ($env:DSH_SUPERAGENT_VERSION) { $env:DSH_SUPERAGENT_VERSION } else { '0.1.0' }),
  [string]$Root = $(if ($env:DSH_SUPERAGENT_ROOT) { $env:DSH_SUPERAGENT_ROOT } else { Join-Path $env:LOCALAPPDATA 'Programs\Superagent' }),
  [switch]$NoShortcuts = ($env:DSH_SUPERAGENT_NOSHORTCUTS -eq '1'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repo = 'Check-mj/dsh-superagent-windows'
$asset = "DSH-Superagent-$Version-win-x64.zip"
$base = "https://github.com/$repo/releases/download/v$Version"
# SHA-256 of every published asset; an unknown version is downloaded but reported as unverified.
$checksums = @{ '0.1.0' = 'c3326969af76e2e75349567a628dc4ef94139f990c214cb5a747b21dabb586d5' }

function Write-Step([string]$text) { Write-Host $text -ForegroundColor Cyan }
function Write-Warn([string]$text) { Write-Host $text -ForegroundColor Yellow }

Write-Step "=== DSH-Superagent $Version — one-line installer ==="
Write-Host "  from     : $base/$asset"
Write-Host "  installs to: $Root"

$tmp = Join-Path $env:TEMP ("dsh-superagent-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $zip = Join-Path $tmp $asset
  Write-Step 'Downloading…'
  try {
    Invoke-WebRequest -Uri "$base/$asset" -OutFile $zip -UseBasicParsing
  } catch {
    # Some networks cannot reach github.com/releases (redirects are filtered) while api.github.com works: ask the
    # release API for the asset id and download the binary from there.
    Write-Warn "  direct download failed ($($_.Exception.Message)); retrying through api.github.com"
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/v$Version" -UseBasicParsing
    $meta = $release.assets | Where-Object { $_.name -eq $asset } | Select-Object -First 1
    if (-not $meta) { throw "Release v$Version has no asset named $asset." }
    Invoke-WebRequest -Uri $meta.url -OutFile $zip -UseBasicParsing -Headers @{ Accept = 'application/octet-stream' }
  }
  $sizeMb = '{0:N1}' -f ((Get-Item -LiteralPath $zip).Length / 1MB)
  Write-Host "  downloaded $sizeMb MB"

  $expected = $checksums[$Version]
  if ($expected) {
    Write-Step 'Verifying SHA-256…'
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
    if ($actual -ne $expected) { throw "Checksum mismatch. expected $expected, got $actual. Delete the download and retry." }
    Write-Host '  checksum OK'
  } else {
    Write-Warn "  no published checksum for $Version; skipping verification"
  }

  Write-Step 'Extracting…'
  $app = Join-Path $tmp 'app'
  Expand-Archive -LiteralPath $zip -DestinationPath $app -Force
  $installer = Join-Path $app 'install.ps1'
  if (-not (Test-Path -LiteralPath $installer)) { throw "The package does not contain install.ps1 (unexpected for $asset)." }

  Write-Step 'Installing…'
  $arguments = @{ Root = $Root }
  if ($NoShortcuts) { $arguments['NoShortcuts'] = $true }
  if ($Force) { $arguments['Force'] = $true }
  & $installer @arguments
  if ($LASTEXITCODE -ne 0) { throw "The installer exited with $LASTEXITCODE." }

  Write-Host ''
  Write-Step 'Done. Next steps:'
  Write-Host '  1. Start DSH-Superagent from the Desktop shortcut (or the Start Menu).'
  Write-Host '  2. In the panel, open 介绍 (the first tab) for the four first steps.'
  Write-Host '  3. Attribution and differences: README, NOTICE and WINDOWS-DELTA.md in the project repository.'
  Write-Host "  Logs: $(Join-Path $env:APPDATA 'Superagent\app.log')"
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
