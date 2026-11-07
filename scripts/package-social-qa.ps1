$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$releaseRoot=Join-Path $projectRoot 'target/release'
$required=@('aurum.exe','aurum-social-lab.exe','aurum-social-worker.exe','aurum-social-firewall.exe')
foreach($file in $required) { if(!(Test-Path -LiteralPath (Join-Path $releaseRoot $file))) { throw "Build the release desktop and lab first: $file is missing" } }
$runtimeManifest=Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri/social-runtime/manifest.json') -Raw | ConvertFrom-Json
foreach($file in @('aurum-social-worker.exe','aurum-social-firewall.exe')) {
  $expected=($runtimeManifest.files | Where-Object { $_.name -eq $file }).sha256
  if((Get-FileHash -LiteralPath (Join-Path $releaseRoot $file)).Hash.ToLowerInvariant() -ne $expected) { throw 'Rebuild the desktop after updating its sidecars' }
}
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$name='aurum-social-test-'+$version+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss')
$destination=Join-Path $projectRoot "target/$name"
New-Item -ItemType Directory -Path $destination | Out-Null
foreach($folder in @('social','lab')) { New-Item -ItemType Directory -Path (Join-Path $destination $folder) | Out-Null }
Copy-Item -LiteralPath (Join-Path $releaseRoot 'aurum.exe') -Destination $destination
foreach($file in @('aurum-social-worker.exe','aurum-social-firewall.exe')) {
  Copy-Item -LiteralPath (Join-Path $releaseRoot $file) -Destination (Join-Path $destination 'social')
  Copy-Item -LiteralPath (Join-Path $releaseRoot $file) -Destination (Join-Path $destination 'lab')
}
Copy-Item -LiteralPath (Join-Path $releaseRoot 'aurum-social-lab.exe') -Destination (Join-Path $destination 'lab')
foreach($file in @('LICENSE','NOTICE','docs/SOCIAL.md','docs/SOCIAL-TESTS.md','docs/SOCIAL-TWO-PC.md')) { Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $destination }
if(Test-Path -LiteralPath (Join-Path $releaseRoot 'licenses')) { Copy-Item -LiteralPath (Join-Path $releaseRoot 'licenses') -Destination $destination -Recurse }
$start=@'
$ErrorActionPreference='Stop'
if(Get-Process -Name aurum -ErrorAction SilentlyContinue) { throw 'Close other Aurum windows before starting the isolated test build.' }
$env:AURUM_DATA_DIR=Join-Path $PSScriptRoot '.test-data/launcher'
Start-Process -FilePath (Join-Path $PSScriptRoot 'aurum.exe') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
'@
[IO.File]::WriteAllText((Join-Path $destination 'start-test.ps1'),$start,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $destination 'NOT-READY.txt'),"Unreleased local test build. NOT READY. No two-network Minecraft gameplay proof yet.`r`nStart with start-test.ps1 to keep data separate. Read SOCIAL-TWO-PC.md.`r`nDo not copy generated .test-data or identity files to the second computer.`r`n",[Text.UTF8Encoding]::new($false))
$hashes=Get-ChildItem -LiteralPath $destination -File -Recurse | Sort-Object FullName | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+$_.FullName.Substring($destination.Length+1).Replace('\','/') }
[IO.File]::WriteAllLines((Join-Path $destination 'SHA256SUMS.txt'),$hashes,[Text.UTF8Encoding]::new($false))
$archive=$destination+'.zip'
Compress-Archive -LiteralPath $destination -DestinationPath $archive
Write-Output $archive
