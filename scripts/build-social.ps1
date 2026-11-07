param([switch]$DebugBuild)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$arguments=@('build','--locked','--package','aurum-social-worker','--bin','aurum-social-worker','--package','aurum-social','--bin','aurum-social-firewall')
if (!$DebugBuild) { $arguments+='--release' }
Push-Location -LiteralPath $projectRoot
try {
  if (Test-Path -LiteralPath (Join-Path $projectRoot '.tools/cargo/bin/cargo.exe')) {
    & (Join-Path $PSScriptRoot 'cargo.ps1') -CargoArguments $arguments
  } else { & cargo @arguments }
  if ($LASTEXITCODE) { throw 'Isolated Social sidecar compilation failed' }
  $targetRoot=if ($env:CARGO_TARGET_DIR) { [IO.Path]::GetFullPath($env:CARGO_TARGET_DIR,$projectRoot) } else { Join-Path $projectRoot 'target' }
  $profile=if ($DebugBuild) { 'debug' } else { 'release' }
  $destination=Join-Path $projectRoot 'src-tauri/social-runtime'
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  foreach($name in @('aurum-social-worker.exe','aurum-social-firewall.exe')) {
    Copy-Item -LiteralPath (Join-Path $targetRoot "$profile/$name") -Destination (Join-Path $destination $name) -Force
  }
  # A directly launched local release binary needs the same offline fallback as
  # its installer. These files are not resources of the on-demand CI installer.
  $localRuntime=Join-Path $targetRoot "$profile/social"
  New-Item -ItemType Directory -Path $localRuntime -Force | Out-Null
  foreach($name in @('aurum-social-worker.exe','aurum-social-firewall.exe')) {
    Copy-Item -LiteralPath (Join-Path $destination $name) -Destination (Join-Path $localRuntime $name) -Force
  }
  & node (Join-Path $PSScriptRoot 'package-social-runtime.mjs')
  if ($LASTEXITCODE) { throw 'Social runtime packaging failed' }
} finally { Pop-Location }
