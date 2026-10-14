param([switch]$Test)
$ErrorActionPreference='Stop'
$installerProject=Split-Path -Parent $PSScriptRoot
$installerOutput=Join-Path $installerProject 'target/installer-plugins'
New-Item -ItemType Directory -Path $installerOutput -Force | Out-Null
$installerSource=Join-Path $installerProject 'src-tauri/installer/aurum-ui.cpp'
$installerDefinition=Join-Path $installerProject 'src-tauri/installer/aurum-ui.def'
$installerDll=Join-Path $installerOutput 'AurumUI.dll'
$installerClang=Get-ChildItem -Path (Join-Path $installerProject '.tools/mingw/*/bin/i686-w64-mingw32-clang.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
if($installerClang) {
  & $installerClang.FullName -shared -Os -fno-exceptions -fno-rtti -Wall -Wextra -Wno-unused-parameter $installerSource $installerDefinition -o $installerDll -lcomctl32 -lgdi32 -luser32 -ldwmapi -lgdiplus
  if($LASTEXITCODE) { throw 'Installer UI compilation failed.' }
} else {
  $installerVsWhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
  if(-not (Test-Path -LiteralPath $installerVsWhere)) { throw 'Install Visual Studio C++ Build Tools to compile the installer presentation plugin.' }
  $installerVs=(& $installerVsWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
  if(!$installerVs) { throw 'Visual Studio x86 C++ tools were not found.' }
  $installerDev=Join-Path $installerVs 'Common7/Tools/VsDevCmd.bat'
  $installerCommand='call "'+$installerDev+'" -no_logo -arch=x86 -host_arch=x64 && cl /nologo /LD /O1 /W4 /GR- /MT "'+$installerSource+'" /Fo"'+(Join-Path $installerOutput 'aurum-ui.obj')+'" /link /DEF:"'+$installerDefinition+'" /OUT:"'+$installerDll+'" /IMPLIB:"'+(Join-Path $installerOutput 'AurumUI.lib')+'" comctl32.lib gdi32.lib user32.lib dwmapi.lib gdiplus.lib'
  & $env:ComSpec /d /s /c $installerCommand
  if($LASTEXITCODE) { throw 'Installer UI compilation failed.' }
}
if($Test) {
  $installerTestOutput=Join-Path $installerProject '.test-data/installer-render'
  New-Item -ItemType Directory -Path $installerTestOutput -Force | Out-Null
  $installerTestSource=Join-Path $installerProject 'src-tauri/installer/tests/close-button.cpp'
  $installerTestExe=Join-Path $installerTestOutput 'close-button-test.exe'
  if($installerClang) {
    & $installerClang.FullName -Os -fno-exceptions -fno-rtti -Wall -Wextra -Wno-unused-parameter $installerTestSource -o $installerTestExe -lcomctl32 -lgdi32 -luser32 -ldwmapi -lgdiplus
  } else {
    $installerTestCommand='call "'+$installerDev+'" -no_logo -arch=x86 -host_arch=x64 && cl /nologo /O1 /W4 /GR- /MT "'+$installerTestSource+'" /Fo"'+(Join-Path $installerTestOutput 'close-button.obj')+'" /link /OUT:"'+$installerTestExe+'" comctl32.lib gdi32.lib user32.lib dwmapi.lib gdiplus.lib'
    & $env:ComSpec /d /s /c $installerTestCommand
  }
  if($LASTEXITCODE) { throw 'Installer rendering test compilation failed.' }
  & $installerTestExe
  if($LASTEXITCODE) { throw 'Installer rendering regression test failed.' }
}
