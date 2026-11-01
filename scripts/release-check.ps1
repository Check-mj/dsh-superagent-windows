﻿# Release rehearsal for DSH-Superagent: one command that says whether this checkout may be published.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-check.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release-check.ps1 -SkipTests   # fast structural pass
#
# It checks the things that must never be wrong for a public release: the tree is clean and pushed, the attribution to
# the upstream project is present everywhere a reader looks, the build and the whole test suite pass, and the published
# release's assets match the checksum the one-line installer will verify.
#
# Nothing here is tied to one machine: the version comes from package.json, the tool locations are discovered, and the
# repository name is a parameter.
[CmdletBinding()]
param(
  [string]$Version,                                   # defaults to package.json
  [string]$Repo = 'Check-mj/dsh-superagent-windows',
  [string]$Gh,                                        # defaults to a discovered gh.exe
  [switch]$SkipTests,
  [switch]$SkipOnline
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pass = New-Object System.Collections.Generic.List[string]
$fail = New-Object System.Collections.Generic.List[string]

function Check([string]$name, [scriptblock]$probe) {
  try {
    $result = & $probe
    $null = $pass.Add($name)
    Write-Host ('PASS  ' + $name) -ForegroundColor Green
    if ($result) { Write-Host ('      ' + $result) -ForegroundColor DarkGray }
  } catch {
    $null = $fail.Add($name + ' — ' + $_.Exception.Message.Trim())
    Write-Host ('FAIL  ' + $name + ' — ' + $_.Exception.Message.Trim()) -ForegroundColor Red
  }
}

function Need($condition, [string]$message) {
  if (-not $condition) { throw $message }
}

function Find-Tool([string]$name, [string[]]$candidates) {
  $command = Get-Command $name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

Write-Host ''
Write-Host '=== DSH-Superagent release check ===' -ForegroundColor Cyan
Write-Host ('repository : ' + $Repo)
Write-Host ('checkout   : ' + $root)

# ---------------------------------------------------------------- version
if (-not $Version) {
  $Version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
}
Write-Host ('version    : ' + $Version)
Write-Host ''

$git = Find-Tool 'git' @('C:\Program Files\Git\cmd\git.exe')
$pnpm = Find-Tool 'pnpm.cmd' @((Join-Path $env:APPDATA 'npm\pnpm.cmd'))
$gh = $Gh
if (-not $gh) {
  $gh = Find-Tool 'gh' @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Superagent\tools\gh\bin\gh.exe'),
    (Join-Path ${env:ProgramFiles} 'GitHub CLI\gh.exe')
  )
}

# ---------------------------------------------------------------- source state
Check 'git repository present' {
  Need ($git -and (Test-Path -LiteralPath (Join-Path $root '.git'))) 'not a git checkout'
  & $git -C $root rev-parse --short HEAD
}

Check 'working tree clean' {
  $dirty = & $git -C $root status --porcelain
  Need (-not $dirty) ("uncommitted files: " + (($dirty | Select-Object -First 5) -join ', '))
  'no uncommitted files'
}

Check 'branch pushed' {
  $local = (& $git -C $root rev-parse HEAD).Trim()
  $remote = (& $git -C $root rev-parse 'origin/main').Trim()
  Need ($local -eq $remote) 'local HEAD differs from origin/main; push before publishing'
  $local.Substring(0, 8)
}

# ---------------------------------------------------------------- attribution (must stay visible)
Check 'attribution present' {
  $readme = Get-Content -LiteralPath (Join-Path $root 'README.md') -Raw
  $notice = Get-Content -LiteralPath (Join-Path $root 'NOTICE') -Raw
  $license = Get-Content -LiteralPath (Join-Path $root 'LICENSE') -Raw
  $package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  $zh = Get-Content -LiteralPath (Join-Path $root 'locale\zh.json') -Raw
  $en = Get-Content -LiteralPath (Join-Path $root 'locale\en.json') -Raw
  $upstream = 'deepseek-ai/dsh-superagent-prototype'
  Need ($readme -like "*$upstream*") 'README does not name the upstream repository'
  Need ($notice -like "*$upstream*") 'NOTICE does not name the upstream repository'
  Need ($license -like '*DeepSeek Harness Team*') 'LICENSE lost the upstream copyright line'
  Need ($zh -like "*$upstream*" -and $en -like "*$upstream*") 'locale metadata does not name upstream'
  Need ($package.license -eq 'MIT') 'package.json licence is not MIT'
  Need (($package.repository | ConvertTo-Json -Compress) -like "*$upstream*") 'package.json repository does not point at upstream'
  'README, NOTICE, LICENSE, locale and package metadata all name upstream'
}

Check 'changelog has this version' {
  $changelog = Get-Content -LiteralPath (Join-Path $root 'CHANGELOG.md') -Raw
  Need ($changelog -match ('(?m)^## \[' + [regex]::Escape($Version) + '\]')) ('CHANGELOG.md has no section for ' + $Version)
  $Version
}

# ---------------------------------------------------------------- build and tests
if (-not $SkipTests) {
  Check 'pnpm available' { Need $pnpm 'pnpm not found on PATH'; & $pnpm --version }
  Check 'typecheck' {
    Push-Location $root
    try { & $pnpm typecheck | Out-Null; Need ($LASTEXITCODE -eq 0) ('typecheck exited ' + $LASTEXITCODE) }
    finally { Pop-Location }
    'tsc --noEmit'
  }
  Check 'build' {
    Push-Location $root
    try { & $pnpm build | Out-Null; Need ($LASTEXITCODE -eq 0) ('build exited ' + $LASTEXITCODE) }
    finally { Pop-Location }
    'tsdown'
  }
  Check 'tests' {
    Push-Location $root
    try { & $pnpm vitest run | Out-Null; Need ($LASTEXITCODE -eq 0) ('tests exited ' + $LASTEXITCODE) }
    finally { Pop-Location }
    'vitest run (includes portability and release invariants)'
  }
} else {
  Write-Host 'SKIP  build and tests (-SkipTests)' -ForegroundColor DarkYellow
}

# ---------------------------------------------------------------- the published release
if (-not $SkipOnline) {
  Check 'gh available' { Need $gh 'gh not found; pass -Gh or install the GitHub CLI'; & $gh --version | Select-Object -First 1 }

  Check ('release v' + $Version + ' exists with both assets') {
    $release = & $gh api ('repos/' + $Repo + '/releases/tags/v' + $Version) | ConvertFrom-Json
    $zip = $release.assets | Where-Object { $_.name -like '*-win-x64.zip' } | Select-Object -First 1
    $sum = $release.assets | Where-Object { $_.name -like '*.sha256' } | Select-Object -First 1
    Need $zip ('release has no *-win-x64.zip asset')
    Need $sum ('release has no .sha256 asset')
    Set-Variable -Name ReleaseDigest -Value $zip.digest -Scope Script
    ('zip ' + [math]::Round($zip.size / 1MB, 1) + ' MB, digest ' + $zip.digest)
  }

  Check 'installer verifies the published checksum' {
    $installer = Get-Content -LiteralPath (Join-Path $root 'install.ps1') -Raw
    $match = [regex]::Match($installer, "'" + [regex]::Escape($Version) + "'\s*=\s*'([0-9a-f]{64})'")
    Need $match.Success ('install.ps1 has no checksum entry for ' + $Version)
    $expected = $match.Groups[1].Value
    $published = ($script:ReleaseDigest -replace '^sha256:', '')
    Need ($published) 'the release asset carries no digest to compare'
    Need ($expected -eq $published) ('checksum mismatch: install.ps1 ' + $expected.Substring(0, 12) + '… vs release ' + $published.Substring(0, 12) + '…')
    'install.ps1 checksum matches the release digest'
  }
} else {
  Write-Host 'SKIP  release checks (-SkipOnline)' -ForegroundColor DarkYellow
}

# ---------------------------------------------------------------- verdict
Write-Host ''
$verdictColor = 'Green'
if ($fail.Count) { $verdictColor = 'Red' }
Write-Host ('=== ' + $pass.Count + ' passed, ' + $fail.Count + ' failed ===') -ForegroundColor $verdictColor
if ($fail.Count) {
  Write-Host 'NOT READY TO PUBLISH:' -ForegroundColor Red
  foreach ($item in $fail) { Write-Host ('  - ' + $item) -ForegroundColor Red }
  exit 1
}
Write-Host 'READY TO PUBLISH.' -ForegroundColor Green
Write-Host 'Remaining manual steps (docs/020): start the app and confirm setup runs, open the panel guide, and try the one-line install on a clean profile.'
exit 0
