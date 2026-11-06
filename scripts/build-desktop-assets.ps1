$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE) { throw 'Frontend build failed' }
  & (Join-Path $PSScriptRoot 'build-social.ps1')
  if ($LASTEXITCODE) { throw 'Social sidecar build failed' }
} finally { Pop-Location }
