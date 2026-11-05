# Derive tintable masks from the original identifying logos; keep their shapes.
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'src/assets/loaders'
foreach ($brand in @('forge')) {
  $original = [Drawing.Bitmap]::FromFile((Join-Path $assetDirectory ($brand+'.png')))
  $mask = New-Object Drawing.Bitmap($original.Width, $original.Height)
  $background = $original.GetPixel(0,0)
  for ($y=0; $y -lt $original.Height; $y++) {
    for ($x=0; $x -lt $original.Width; $x++) {
      $pixel = $original.GetPixel($x,$y)
      $distance = [Math]::Max([Math]::Abs([int]$pixel.R-$background.R),[Math]::Max([Math]::Abs([int]$pixel.G-$background.G),[Math]::Abs([int]$pixel.B-$background.B)))
      $alpha = if ($brand -eq 'forge') { [Math]::Min(255,[Math]::Max(0,($distance-8)*255/180)) } else { if ($distance -lt 18) { 0 } else { $pixel.A } }
      $mask.SetPixel($x,$y,[Drawing.Color]::FromArgb([int]$alpha,255,255,255))
    }
  }
  $mask.Save((Join-Path $assetDirectory ($brand+'-mask.png')),[Drawing.Imaging.ImageFormat]::Png)
  $mask.Dispose(); $original.Dispose()
}
