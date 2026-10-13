param([string]$ExecutablePath)
$ErrorActionPreference='Stop'
if (!$ExecutablePath) {
  $ExecutablePath=Join-Path (Split-Path -Parent $PSScriptRoot) 'target\release\aurum.exe'
}
$launcher=Get-Item -LiteralPath $ExecutablePath
if ($launcher.Extension -ne '.exe') { throw 'Expected the launcher EXE.' }
if (-not ('AurumShellIcon' -as [type])) {
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AurumShellIcon {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern void SHChangeNotify(uint eventId, uint flags, string item1, string item2);
}
'@
}
# SHCNE_UPDATEITEM / SHCNE_UPDATEDIR, SHCNF_PATHW | SHCNF_FLUSH.
[AurumShellIcon]::SHChangeNotify(0x00002000,0x00001005,$launcher.FullName,$null)
[AurumShellIcon]::SHChangeNotify(0x00001000,0x00001005,$launcher.DirectoryName,$null)
Write-Output ('Explorer icon refreshed: ' + $launcher.FullName)
