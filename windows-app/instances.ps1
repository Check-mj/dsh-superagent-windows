# Creates and starts Superagent instances: one window per context boundary (article §8.3).
#
#   windows-app\instances.ps1 -Action list
#   windows-app\instances.ps1 -Action add    -Name team-b -Label "Team B" -StateDir "C:\Users\me\.dsh\state\team-b"
#   windows-app\instances.ps1 -Action shortcut -Name team-b     # a Desktop shortcut that opens that window
#   windows-app\instances.ps1 -Action start  -Name team-b
#
# The application reads <install>\config\instances.json: each record names its own DSH profile, state directory and
# port, so separate boundaries never share a state lock, a policy or a credential directory.
[CmdletBinding()]
param(
  [ValidateSet('list', 'add', 'remove', 'start', 'shortcut')]
  [string]$Action = 'list',
  [string]$Name,
  [string]$Label,
  [string]$Profile = 'superagent',
  [string]$StateDir,
  [int]$Port = 0,
  [string]$Root
)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Join-Path $env:LOCALAPPDATA 'Programs\Superagent' }
$exe = Join-Path $Root 'Superagent.exe'
$file = Join-Path $Root 'config\instances.json'
$icon = Join-Path $Root 'resources\app\icon.ico'
if (-not (Test-Path -LiteralPath $icon)) { $icon = $exe }

function Read-Instances {
  if (-not (Test-Path -LiteralPath $file)) { return [pscustomobject]@{ instances = @() } }
  $text = [System.IO.File]::ReadAllText($file).TrimStart([char]0xFEFF)
  if (-not $text) { return [pscustomobject]@{ instances = @() } }
  return ($text | ConvertFrom-Json)
}
function Save-Instances($data) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
  [System.IO.File]::WriteAllText($file, ($data | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
}

switch ($Action) {
  'list' {
    $data = Read-Instances
    if (-not $data.instances -or $data.instances.Count -eq 0) { Write-Host "No instances in $file"; break }
    $data.instances | Format-Table name, label, profile, stateDir, port -AutoSize
  }
  'add' {
    if (-not $Name) { throw '-Name is required for add' }
    if (-not $StateDir) { throw '-StateDir is required for add' }
    $data = Read-Instances
    $list = @($data.instances | Where-Object { $_.name -ne $Name })
    $list += [pscustomobject]@{ name = $Name; label = $(if ($Label) { $Label } else { $Name }); profile = $Profile; stateDir = $StateDir; port = $Port }
    Save-Instances ([pscustomobject]@{ instances = $list })
    Write-Host "Added instance $Name -> $file"
  }
  'remove' {
    if (-not $Name) { throw '-Name is required for remove' }
    $data = Read-Instances
    Save-Instances ([pscustomobject]@{ instances = @($data.instances | Where-Object { $_.name -ne $Name }) })
    Write-Host "Removed instance $Name"
  }
  'start' {
    if (-not $Name) { throw '-Name is required for start' }
    Start-Process -FilePath $exe -ArgumentList '--no-sandbox', '--disable-gpu', '--instance', $Name -WorkingDirectory $Root
    Write-Host "Started instance $Name"
  }
  'shortcut' {
    if (-not $Name) { throw '-Name is required for shortcut' }
    $record = (Read-Instances).instances | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $record) { throw "No instance named $Name in $file" }
    $title = "Superagent ($($record.label))"
    $shell = New-Object -ComObject WScript.Shell
    $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) ($title + '.lnk')
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath = $exe
    $s.Arguments = '--no-sandbox --disable-gpu --instance ' + $Name
    $s.WorkingDirectory = $Root
    $s.IconLocation = "$icon,0"
    $s.Description = $title
    $s.Save()
    Write-Host "Shortcut: $lnk"
  }
}
