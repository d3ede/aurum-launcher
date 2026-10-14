param([Parameter(Mandatory=$true)][string]$SetupPath)
$ErrorActionPreference='Stop'
$installerProject=Split-Path -Parent $PSScriptRoot
$installerSetup=(Resolve-Path -LiteralPath $SetupPath).Path
if((Get-Item -LiteralPath $installerSetup).VersionInfo.ProductName -ne 'Aurum Installer QA') {
  throw 'This test only accepts the isolated Aurum Installer QA bundle.'
}
$installerTest=[IO.Path]::GetFullPath((Join-Path $installerProject '.test-data/installer-smoke/installed'))
$installerRegistry='Software\AurumInstallerQA\Aurum Installer QA'
$installerUninstallRegistry='Software\Microsoft\Windows\CurrentVersion\Uninstall\Aurum Installer QA'
$installerDesktop=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Aurum Installer QA.lnk'
$installerStart=Join-Path ([Environment]::GetFolderPath('Programs')) 'Aurum Installer QA.lnk'
$installerShell=New-Object -ComObject WScript.Shell
foreach($installerShortcut in @($installerDesktop,$installerStart)) {
  if(Test-Path -LiteralPath $installerShortcut) {
    if($installerShell.CreateShortcut($installerShortcut).TargetPath -ne (Join-Path $installerTest 'aurum.exe')) {
      throw 'A QA shortcut belongs to another installation; refusing to overwrite it.'
    }
  }
}
$installerOldKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($installerRegistry)
if($installerOldKey) {
  $installerOldPath=$installerOldKey.GetValue('');$installerOldKey.Dispose()
  if($installerOldPath -and $installerOldPath -ne $installerTest) { throw 'An unrelated QA installation exists.' }
}
New-Item -ItemType Directory -Path $installerTest -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $installerTest 'keep.txt'),'Unrelated files must survive uninstall.')
function Set-InstallerChoices([int]$Desktop,[int]$Start) {
  $installerKey=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($installerRegistry)
  try {
    $installerKey.SetValue('',$installerTest)
    $installerKey.SetValue('DesktopShortcut',$Desktop,[Microsoft.Win32.RegistryValueKind]::DWord)
    $installerKey.SetValue('StartMenuShortcut',$Start,[Microsoft.Win32.RegistryValueKind]::DWord)
  } finally { $installerKey.Dispose() }
}
function Invoke-Installer([string]$Flags='/S',[switch]$RestoreRegisteredPath) {
  $installerArguments=if($RestoreRegisteredPath) { $Flags } else { $Flags+' /D='+$installerTest }
  $installerProcess=Start-Process -FilePath $installerSetup -ArgumentList $installerArguments -WindowStyle Hidden -PassThru
  if(!$installerProcess.WaitForExit(60000)) { throw 'QA installer timed out.' }
  if($installerProcess.ExitCode -ne 0) { throw ('QA installer exit code: '+$installerProcess.ExitCode) }
  if(!(Test-Path -LiteralPath (Join-Path $installerTest 'aurum.exe'))) { throw 'Launcher payload was not installed.' }
}
function Assert-InstallerShortcuts([bool]$Desktop,[bool]$Start) {
  if((Test-Path -LiteralPath $installerDesktop) -ne $Desktop) { throw 'Incorrect desktop shortcut choice.' }
  if((Test-Path -LiteralPath $installerStart) -ne $Start) { throw 'Incorrect Start menu shortcut choice.' }
  foreach($installerShortcut in @($installerDesktop,$installerStart)) {
    if((Test-Path -LiteralPath $installerShortcut) -and $installerShell.CreateShortcut($installerShortcut).TargetPath -ne (Join-Path $installerTest 'aurum.exe')) {
      throw 'Incorrect shortcut target.'
    }
  }
}
foreach($installerChoices in @(@(1,0),@(0,1),@(0,0),@(1,1))) {
  Set-InstallerChoices $installerChoices[0] $installerChoices[1]
  Invoke-Installer
  Assert-InstallerShortcuts ([bool]$installerChoices[0]) ([bool]$installerChoices[1])
  Write-Output ('Shortcut choices passed: desktop='+$installerChoices[0]+', start='+$installerChoices[1])
}
Remove-Item -LiteralPath $installerDesktop
Invoke-Installer '/S /UPDATE' -RestoreRegisteredPath
Assert-InstallerShortcuts $false $true
Invoke-Installer '/S /NS'
Assert-InstallerShortcuts $false $true
# Reproduce a preview shortcut while the updater installs into the registered
# directory, without /D. The native regression provides an identifiable QA EXE.
& (Join-Path $PSScriptRoot 'test-installer-shortcuts.ps1')
$installerOldCopy=[IO.Path]::GetFullPath((Join-Path $installerProject '.test-data/installer-smoke/old-preview'))
New-Item -ItemType Directory -Path $installerOldCopy -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $installerProject '.test-data/installer-shortcuts/старый preview/aurum.exe') -Destination (Join-Path $installerOldCopy 'aurum.exe') -Force
foreach($installerShortcut in @($installerDesktop,$installerStart)) {
  $installerLink=$installerShell.CreateShortcut($installerShortcut)
  $installerLink.TargetPath=Join-Path $installerOldCopy 'aurum.exe'
  $installerLink.WorkingDirectory=$installerOldCopy
  $installerLink.IconLocation=(Join-Path $installerOldCopy 'aurum.exe')+',0'
  $installerLink.Save()
}
# Existing links must be repaired independently of stored checkbox values.
Set-InstallerChoices 0 0
Invoke-Installer '/S /UPDATE /NS' -RestoreRegisteredPath
foreach($installerShortcut in @($installerDesktop,$installerStart)) {
  if($installerShell.CreateShortcut($installerShortcut).TargetPath -ne (Join-Path $installerOldCopy 'aurum.exe')) { throw '/NS modified an existing preview shortcut.' }
}
Invoke-Installer '/S /UPDATE' -RestoreRegisteredPath
Assert-InstallerShortcuts $true $true
foreach($installerShortcut in @($installerDesktop,$installerStart)) {
  $installerLink=$installerShell.CreateShortcut($installerShortcut)
  if($installerLink.WorkingDirectory -ne $installerTest -or $installerLink.IconLocation -ne (Join-Path $installerTest 'aurum.exe')+',0') { throw 'Updater left a stale shortcut icon or working directory.' }
}
Write-Output 'Automatic update repaired both preview shortcuts using the registered installation path.'
$installerForeignExe=[IO.Path]::GetFullPath((Join-Path $installerProject '.test-data/installer-shortcuts/foreign/aurum.exe'))
$installerForeignLink=$installerShell.CreateShortcut($installerDesktop)
$installerForeignLink.TargetPath=$installerForeignExe
$installerForeignLink.Save()
Invoke-Installer '/S /UPDATE' -RestoreRegisteredPath
if($installerShell.CreateShortcut($installerDesktop).TargetPath -ne $installerForeignExe) { throw 'Updater changed an unrelated shortcut.' }
# Remove only this owned QA fixture link before testing normal cleanup.
Remove-Item -LiteralPath $installerDesktop
Set-InstallerChoices 0 0
Invoke-Installer
Invoke-Installer '/S /UPDATE'
Assert-InstallerShortcuts $false $false
$installerKey=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($installerRegistry)
try {
  if($installerKey.GetValue('DesktopShortcut') -ne 0 -or $installerKey.GetValue('StartMenuShortcut') -ne 0) { throw 'Updater changed shortcut preferences.' }
  Write-Output ('Saved installer language: '+$installerKey.GetValue('Installer Language'))
} finally { $installerKey.Dispose() }
$installerInstalledBytes=(Get-ChildItem -LiteralPath $installerTest -File | Measure-Object Length -Sum).Sum
$installerUninstaller=Join-Path $installerTest 'uninstall.exe'
$installerUninstallProcess=Start-Process -FilePath $installerUninstaller -ArgumentList ('/S _?='+$installerTest) -WindowStyle Hidden -PassThru
if(!$installerUninstallProcess.WaitForExit(60000) -or $installerUninstallProcess.ExitCode -ne 0) { throw 'QA uninstall failed.' }
if(Test-Path -LiteralPath (Join-Path $installerTest 'aurum.exe')) { throw 'Uninstaller left the launcher payload.' }
if(!(Test-Path -LiteralPath (Join-Path $installerTest 'keep.txt'))) { throw 'Uninstaller removed an unrelated file.' }
Assert-InstallerShortcuts $false $false
if([Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($installerUninstallRegistry)) { throw 'Uninstall registration was left behind.' }
if(Test-Path -LiteralPath $installerUninstaller) { Remove-Item -LiteralPath $installerUninstaller }
[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($installerRegistry,$false)
Write-Output ('Installer smoke test passed: four shortcut combinations, update/no-shortcut modes, uninstall; installed bytes='+$installerInstalledBytes)
