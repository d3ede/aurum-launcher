param([Parameter(Mandatory=$true)][int]$LauncherProcessId)
$ErrorActionPreference='Stop'
if (-not ('AurumWindowGeometry' -as [type])) {
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AurumWindowGeometry {
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential)] public struct Monitor {public uint Size; public Rect Bounds,Work; public uint Flags;}
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr w,out Rect r);
 [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr w,uint flags);
 [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m,ref Monitor info);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr w);
}
'@
}
$launcher=Get-Process -Id $LauncherProcessId
$expectedPath=Join-Path (Split-Path -Parent $PSScriptRoot) 'target\release\aurum.exe'
if ($launcher.Path -ne $expectedPath) { throw 'Проверка предназначена только для release Aurum из этого проекта.' }
for ($attempt=0; $attempt -lt 50; $attempt++) {
  $launcher.Refresh()
  if ($launcher.MainWindowTitle -eq 'Aurum Launcher' -and $launcher.MainWindowHandle -ne [IntPtr]::Zero -and [AurumWindowGeometry]::IsWindowVisible($launcher.MainWindowHandle)) { break }
  Start-Sleep -Milliseconds 100
}
$handle=$launcher.MainWindowHandle
$rect=New-Object AurumWindowGeometry+Rect
$monitor=New-Object AurumWindowGeometry+Monitor
$monitor.Size=[System.Runtime.InteropServices.Marshal]::SizeOf($monitor)
if (-not [AurumWindowGeometry]::GetWindowRect($handle,[ref]$rect)) { throw 'Нет координат окна.' }
if (-not [AurumWindowGeometry]::GetMonitorInfo([AurumWindowGeometry]::MonitorFromWindow($handle,2),[ref]$monitor)) { throw 'Нет рабочей области монитора.' }
$centered=([Math]::Abs(($rect.Left+$rect.Right)-($monitor.Work.Left+$monitor.Work.Right)) -le 2 -and [Math]::Abs(($rect.Top+$rect.Bottom)-($monitor.Work.Top+$monitor.Work.Bottom)) -le 2)
$visible=[AurumWindowGeometry]::IsWindowVisible($handle)
[pscustomobject]@{Title=$launcher.MainWindowTitle;Window=@($rect.Left,$rect.Top,$rect.Right,$rect.Bottom);WorkArea=@($monitor.Work.Left,$monitor.Work.Top,$monitor.Work.Right,$monitor.Work.Bottom);Centered=$centered;Visible=$visible;Responding=$launcher.Responding} | ConvertTo-Json -Compress
if (-not $centered -or -not $visible -or -not $launcher.Responding) { throw 'Окно должно быть видимым, отвечать и находиться по центру рабочей области.' }
