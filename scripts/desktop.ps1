param([ValidateSet('dev','build')][string]$Mode = 'dev',[switch]$DebugBuild,[switch]$NoBundle)
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:CARGO_HOME = Join-Path $projectRoot '.tools\cargo'
$env:RUSTUP_HOME = Join-Path $projectRoot '.tools\rustup'
$mingw = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.tools\mingw') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if ($mingw) { $env:PATH = (Join-Path $mingw.FullName 'bin') + ';' + $env:PATH }
$gcc = Join-Path $projectRoot '.tools\gcc\mingw64\bin'
if (Test-Path -LiteralPath $gcc) { $env:PATH = $gcc + ';' + $env:PATH }
if ($mingw -and (Test-Path -LiteralPath $gcc)) {
  $env:PATH = (Join-Path $mingw.FullName 'bin') + ';' + $env:PATH
  $env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = Join-Path $mingw.FullName 'bin\x86_64-w64-mingw32-gcc.exe'
  $gccLib = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.tools\gcc\mingw64\lib\gcc\x86_64-w64-mingw32') -Directory | Select-Object -First 1
  $env:CARGO_ENCODED_RUSTFLAGS = '-L' + [char]31 + ('native=' + $gccLib.FullName) + [char]31 + '-L' + [char]31 + ('native=' + (Join-Path $projectRoot '.tools\gcc\mingw64\lib'))
  $env:CC = Join-Path $mingw.FullName 'bin\x86_64-w64-mingw32-clang.exe'
  $env:AR = Join-Path $mingw.FullName 'bin\llvm-ar.exe'
}
$env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
Set-Location -LiteralPath $projectRoot
$tauriArguments=@('run','tauri','--',$Mode)
if ($DebugBuild) { $tauriArguments += '--debug' }
if ($NoBundle) { $tauriArguments += '--no-bundle' }
& npm.cmd @tauriArguments
$desktopExitCode=$LASTEXITCODE
if ($Mode -eq 'build' -and $desktopExitCode -eq 0) {
  $desktopTarget=if ($env:CARGO_TARGET_DIR) { [IO.Path]::GetFullPath($env:CARGO_TARGET_DIR,$projectRoot) } else { Join-Path $projectRoot 'target' }
  $desktopProfile=if ($DebugBuild) { 'debug' } else { 'release' }
  $desktopExe=Join-Path $desktopTarget ($desktopProfile+'\aurum.exe')
  if (Test-Path -LiteralPath $desktopExe) { & (Join-Path $PSScriptRoot 'refresh-icon.ps1') -ExecutablePath $desktopExe }
}
exit $desktopExitCode
