# relink-dev.ps1 - keep local file: plugins linked to their source dirs
#
# Why: `dsh plugin --profile web add <pkg>` makes pnpm re-materialize every
# file: dependency as a snapshot COPY inside node_modules. Edits made to the
# source after that copy was taken never take effect (code changes appear to
# do nothing after a restart).
#
# This script swaps those stale copies back to junctions pointing at the
# source directories, so the plugins always serve the latest source.
# Run it after changing plugin sources. Host-side changes still need a
# `dsh web` restart to be loaded by the running process.
#
# Usage:  .\relink-dev.ps1                        fix all known local plugins
#         .\relink-dev.ps1 -Name chicheng-cron    fix only one plugin
param(
  [string]$Name = ""
)
$ErrorActionPreference = 'Stop'
$profile = Join-Path $env:DSH_HOME 'profiles\web'
$nm = Join-Path $profile 'node_modules'
if (-not (Test-Path $profile)) { Write-Host "profile not found: $profile"; exit 1 }

# Only file: dependencies live here (github: deps are excluded on purpose).
# Adjust the mapping if your plugin sources live elsewhere.
$links = @{
  'chicheng-cron' = 'D:\Harness\chicheng-cron'
  'chicheng-push' = 'D:\Harness\chicheng-push'
}

$targets = if ($Name -ne '') { @{ $Name = $links[$Name] } } else { $links }
foreach ($entry in $targets.GetEnumerator()) {
  $pkg = $entry.Key
  $target = $entry.Value
  if (-not (Test-Path $target)) { Write-Host "SKIP $pkg (source missing: $target)"; continue }
  $dest = Join-Path $nm $pkg
  $item = Get-Item $dest -ErrorAction SilentlyContinue
  if ($item -and $item.LinkType) { Write-Host "OK   $pkg already a junction -> $($item.Target)"; continue }
  if ($item) { Remove-Item $dest -Recurse -Force; Write-Host "removed stale copy: $dest" }
  New-Item -ItemType Junction -Path $dest -Target $target | Out-Null
  Write-Host "LINK $pkg -> $target"
}
Write-Host 'done. Remember to restart dsh web for host-side changes.'
