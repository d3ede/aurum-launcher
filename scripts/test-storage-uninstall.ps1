param([Parameter(Mandatory=$true)][string]$SetupPath)
$ErrorActionPreference='Stop'
$storageProject=Split-Path -Parent $PSScriptRoot
$storageSetup=(Resolve-Path -LiteralPath $SetupPath).Path
if((Get-Item -LiteralPath $storageSetup).VersionInfo.ProductName -ne 'Aurum Installer QA') { throw 'Only the isolated QA installer is accepted.' }
$storageTest=[IO.Path]::GetFullPath((Join-Path $storageProject '.test-data/storage-uninstall'))
$storageInstall=[IO.Path]::GetFullPath((Join-Path $storageProject '.test-data/installer-smoke/installed/Launcher'))
$storageState=@{profiles=@();accounts=@();selectedAccount=$null;settings=@{language='ru';theme='light';javaPath='';ramMb=4096;jvmArgs='';resolutionWidth=1280;resolutionHeight=720;showSnapshots=$false}} | ConvertTo-Json -Depth 8
function Invoke-StorageProcess([string]$File,[string]$Arguments,[int]$Expected=0) {
  $storageProcess=Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  if(!$storageProcess.WaitForExit(60000) -or $storageProcess.ExitCode -ne $Expected) { throw ('Unexpected result: '+$File+' '+$Arguments+' exit='+$storageProcess.ExitCode) }
}
Invoke-StorageProcess $storageSetup ('/S /D='+$storageInstall)
$storageExe=Join-Path $storageInstall 'aurum.exe'
$storageManifest=Join-Path $storageInstall 'aurum-data-roots.json'
if(Test-Path -LiteralPath $storageManifest) {
  $storageOld=Get-Content -LiteralPath $storageManifest -Raw | ConvertFrom-Json
  foreach($storageRoot in $storageOld.roots) {
    if(![IO.Path]::GetFullPath($storageRoot).StartsWith((Join-Path $storageProject '.test-data/'),[StringComparison]::OrdinalIgnoreCase)) { throw 'QA manifest references data outside .test-data.' }
  }
}
function New-StorageFixture([string]$Name) {
  $storageRoot=Join-Path $storageTest $Name
  New-Item -ItemType Directory -Force (Join-Path $storageRoot 'instances/World') | Out-Null
  [IO.File]::WriteAllText((Join-Path $storageRoot 'state.json'),$storageState)
  [IO.File]::WriteAllText((Join-Path $storageRoot 'instances/World/level.dat'),'QA world')
  [IO.File]::WriteAllText((Join-Path $storageRoot 'keep.txt'),'Unrelated file')
  Invoke-StorageProcess $storageExe ('--register-data app.aurum.installer.qa "'+$storageRoot+'"')
  return $storageRoot
}
$storageFirst=New-StorageFixture 'first root'
$storageSecond=New-StorageFixture 'custom root'
Invoke-StorageProcess $storageExe '--uninstall-data wrong.identifier' 1
foreach($storageRoot in @($storageFirst,$storageSecond)) {
  if(!(Test-Path -LiteralPath (Join-Path $storageRoot 'instances/World/level.dat'))) { throw 'Mismatched identifier removed data.' }
}
$storageList=Join-Path $storageTest 'roots.txt'
Invoke-StorageProcess $storageExe ('--uninstall-data-list app.aurum.installer.qa "'+$storageList+'"')
$storageRoots=[IO.File]::ReadAllText($storageList,[Text.Encoding]::Unicode)
foreach($storageRoot in @($storageFirst,$storageSecond)) { if(!$storageRoots.Contains($storageRoot)) { throw 'Custom data root missing from uninstall list.' } }
Invoke-StorageProcess $storageExe '--uninstall-data app.aurum.installer.qa'
foreach($storageRoot in @($storageFirst,$storageSecond)) {
  if(Test-Path -LiteralPath (Join-Path $storageRoot 'instances')) { throw 'Explicit removal left owned data.' }
  if(!(Test-Path -LiteralPath (Join-Path $storageRoot 'keep.txt'))) { throw 'Explicit removal deleted unrelated files.' }
}
$storagePreserved=New-StorageFixture 'preserved root'
$storageKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\Aurum Installer QA')
try {
  if(!$storageKey.GetValue('QuietUninstallString') -or $storageKey.GetValue('InstallLocation') -ne $storageInstall) { throw 'Windows uninstall registration is incomplete.' }
} finally { $storageKey.Dispose() }
$storageShortcut=Join-Path ([Environment]::GetFolderPath('Programs')) 'Aurum Installer QA Uninstall.lnk'
if(!(Test-Path -LiteralPath $storageShortcut)) { throw 'Uninstall shortcut is missing.' }
Invoke-StorageProcess (Join-Path $storageInstall 'uninstall.exe') ('/S _?='+$storageInstall)
if(!(Test-Path -LiteralPath (Join-Path $storagePreserved 'instances/World/level.dat'))) { throw 'Silent uninstall removed game data without a choice.' }
if(Test-Path -LiteralPath $storageShortcut) { throw 'Uninstall shortcut was left behind.' }
Write-Output 'Storage uninstall passed: custom roots, identifier guard, explicit owned-data cleanup, unrelated-file preservation, Windows registration, Start shortcut, silent preservation.'
