param([Parameter(Mandatory=$true)][string]$SetupPath)
$ErrorActionPreference='Stop'
$installerProject=Split-Path -Parent $PSScriptRoot
$installerSetup=(Resolve-Path -LiteralPath $SetupPath).Path
if((Get-Item -LiteralPath $installerSetup).VersionInfo.ProductName -ne 'Aurum Installer QA') {
  throw 'This test only accepts the isolated Aurum Installer QA bundle.'
}
$installerTest=Join-Path $installerProject '.test-data/installer-smoke/installed'
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
function Invoke-Installer([string]$Flags='/S') {
  $installerProcess=Start-Process -FilePath $installerSetup -ArgumentList ($Flags+' /D='+$installerTest) -WindowStyle Hidden -PassThru
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
Invoke-Installer '/S /UPDATE'
Assert-InstallerShortcuts $false $true
Invoke-Installer '/S /NS'
Assert-InstallerShortcuts $false $true
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
