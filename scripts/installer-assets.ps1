$ErrorActionPreference='Stop'
$installerRoot=Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'build-installer-ui.ps1')
Add-Type -AssemblyName System.Drawing
$installerBitmap=[Drawing.Bitmap]::new(336,704)
$installerGraphics=[Drawing.Graphics]::FromImage($installerBitmap)
$installerGraphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
$installerGraphics.Clear([Drawing.ColorTranslator]::FromHtml('#CDD2C7'))
$installerPen=[Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#A6AE99'),1.2)
for($i=0;$i -lt 12;$i++) {
  $installerGraphics.DrawBezier($installerPen,[single](-60+$i*15),[single]360,[single](390-$i*7),[single](250+$i*9),[single](-60+$i*13),[single](630-$i*8),[single](410+$i*6),[single](730-$i*10))
}
$installerLogo=[Drawing.Image]::FromFile((Join-Path $installerRoot 'src-tauri/icons/icon.png'))
$installerGraphics.DrawImage($installerLogo,36,42,82,82)
$installerInk=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#2D392F'))
$installerMuted=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml('#64705F'))
$installerFont=[Drawing.Font]::new('Segoe UI',27,[Drawing.FontStyle]::Bold)
$installerSmall=[Drawing.Font]::new('Segoe UI',12)
$installerGraphics.DrawString('Aurum',$installerFont,$installerInk,32,146)
$installerGraphics.DrawString('Launcher',$installerSmall,$installerMuted,36,198)
$installerVersion=(Get-Content (Join-Path $installerRoot 'package.json') -Raw | ConvertFrom-Json).version
$installerGraphics.DrawString(('v'+$installerVersion+'  ·  Windows x64'),$installerSmall,$installerInk,36,645)
$installerBitmap.Save((Join-Path $installerRoot 'src-tauri/installer/sidebar.bmp'),[Drawing.Imaging.ImageFormat]::Bmp)
foreach($installerDisposable in @($installerGraphics,$installerBitmap,$installerPen,$installerLogo,$installerInk,$installerMuted,$installerFont,$installerSmall)) { $installerDisposable.Dispose() }
