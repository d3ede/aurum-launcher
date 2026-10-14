$ErrorActionPreference='Stop'
$installerProject=Split-Path -Parent $PSScriptRoot
$installerTest=Join-Path $installerProject '.test-data/installer-path'
New-Item -ItemType Directory -Path $installerTest -Force | Out-Null
$installerCompiler=Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe'
if(!(Test-Path -LiteralPath $installerCompiler)) { throw 'Build a Tauri NSIS bundle before running this test.' }
$installerCases=@(
  @('D:','D:\Aurum Launcher'),
  @('D:\','D:\Aurum Launcher'),
  @('D:\\','D:\Aurum Launcher'),
  @('D:/','D:\Aurum Launcher'),
  @('D:\.','D:\Aurum Launcher'),
  @('D:\Games\..','D:\Aurum Launcher'),
  @('D:\Games','D:\Games'),
  @('D:\Games\Aurum Launcher','D:\Games\Aurum Launcher'),
  @('D:\Игры\Аурум','D:\Игры\Аурум'),
  @('D:/Games','D:\Games'),
  @('D:\Games\..\Custom','D:\Custom'),
  @('\\server\share','\\server\share\Aurum Launcher'),
  @('\\server\share\','\\server\share\Aurum Launcher'),
  @('\\server\share\Games','\\server\share\Games'),
  @('\\server\share\Games\..','\\server\share\Aurum Launcher'),
  @('',''),
  @('Games','Games')
)
$installerHarness=@'
Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!define PRODUCTNAME "Aurum Launcher"
!include "__SOURCE__"
OutFile "__EXE__"
SilentInstall silent
RequestExecutionLevel user
Section
  FileOpen $R0 "__RESULT__" w
  FileWriteWord $R0 0xFEFF
__CASES__
  FileClose $R0
SectionEnd
'@
$installerCalls=foreach($installerCase in $installerCases) {
  '  StrCpy $0 "'+$installerCase[0]+'"'
  '  Call AurumNormalizeInstallPath'
  '  FileWriteUTF16LE $R0 "$0$\r$\n"'
  # A second call verifies normalization never duplicates the product folder.
  '  Call AurumNormalizeInstallPath'
  '  FileWriteUTF16LE $R0 "$0$\r$\n"'
}
$installerHarness=$installerHarness.Replace('__SOURCE__',(Join-Path $installerProject 'src-tauri/installer/install-path.nsh')).Replace('__EXE__',(Join-Path $installerTest 'path-test.exe')).Replace('__RESULT__',(Join-Path $installerTest 'results.txt')).Replace('__CASES__',($installerCalls -join "`r`n"))
[IO.File]::WriteAllText((Join-Path $installerTest 'path-test.nsi'),$installerHarness,[Text.UTF8Encoding]::new($false))
& $installerCompiler /V2 /INPUTCHARSET UTF8 (Join-Path $installerTest 'path-test.nsi')
if($LASTEXITCODE) { throw 'Path test harness compilation failed.' }
$installerTestProcess=Start-Process -FilePath (Join-Path $installerTest 'path-test.exe') -WindowStyle Hidden -Wait -PassThru
if($installerTestProcess.ExitCode) { throw 'Path test harness failed.' }
$installerResults=Get-Content -LiteralPath (Join-Path $installerTest 'results.txt') -Encoding Unicode
if($installerResults.Count -ne $installerCases.Count*2) { throw 'Incomplete path-test results.' }
for($installerIndex=0;$installerIndex -lt $installerCases.Count;$installerIndex++) {
  foreach($installerPass in @(0,1)) {
    if($installerResults[$installerIndex*2+$installerPass] -cne $installerCases[$installerIndex][1]) {
      throw ('Unexpected path for "'+$installerCases[$installerIndex][0]+'": "'+$installerResults[$installerIndex*2+$installerPass]+'"')
    }
  }
}
Write-Output ('Installer paths: '+$installerCases.Count+' cases and repeated normalization passed.')
