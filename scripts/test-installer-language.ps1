$ErrorActionPreference='Stop'
$installerProject=Split-Path -Parent $PSScriptRoot
$installerTest=Join-Path $installerProject '.test-data/installer-language'
New-Item -ItemType Directory -Path $installerTest -Force | Out-Null
$installerCompiler=Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe'
if(!(Test-Path -LiteralPath $installerCompiler)) { throw 'Build a Tauri NSIS bundle before running this test.' }
$installerCases=@(
  @(1033,1033), @(2057,1033), # English: US, UK
  @(1049,1049), @(1058,1058), # Russian, Ukrainian
  @(1034,1034), @(2058,1034), @(3082,1034), # Spanish: traditional, Mexico, Spain
  @(1031,1031), @(2055,1031), @(3079,1031), # German: Germany, Switzerland, Austria
  @(1036,1036), @(3084,1036), # French: France, Canada
  @(1045,1045), # Polish
  @(1061,1033), @(1041,1033), @(0,1033) # Unsupported/unknown: English fallback
)
$installerHarness=@'
Unicode true
!include MUI2.nsh
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "Ukrainian"
!insertmacro MUI_LANGUAGE "Spanish"
!insertmacro MUI_LANGUAGE "German"
!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "Polish"
!include "__SOURCE__"
OutFile "__EXE__"
SilentInstall silent
RequestExecutionLevel user
Section
  FileOpen $1 "__RESULT__" w
__CASES__
  Call AurumSelectLanguage
  FileWrite $1 "system=$LANGUAGE$\r$\n"
  FileClose $1
SectionEnd
'@
$installerCalls=foreach($installerCase in $installerCases) {
  '  StrCpy $0 '+$installerCase[0]
  '  Call AurumMatchLanguage'
  '  FileWrite $1 "$LANGUAGE$\r$\n"'
}
$installerHarness=$installerHarness.Replace('__SOURCE__',(Join-Path $installerProject 'src-tauri/installer/language-selection.nsh')).Replace('__EXE__',(Join-Path $installerTest 'language-test.exe')).Replace('__RESULT__',(Join-Path $installerTest 'results.txt')).Replace('__CASES__',($installerCalls -join "`r`n"))
[IO.File]::WriteAllText((Join-Path $installerTest 'language-test.nsi'),$installerHarness,[Text.UTF8Encoding]::new($false))
& $installerCompiler /V2 (Join-Path $installerTest 'language-test.nsi')
if($LASTEXITCODE) { throw 'Language test harness compilation failed.' }
$installerTestProcess=Start-Process -FilePath (Join-Path $installerTest 'language-test.exe') -WindowStyle Hidden -Wait -PassThru
if($installerTestProcess.ExitCode) { throw 'Language test harness failed.' }
$installerResults=Get-Content -LiteralPath (Join-Path $installerTest 'results.txt')
for($installerIndex=0;$installerIndex -lt $installerCases.Count;$installerIndex++) {
  if([int]$installerResults[$installerIndex] -ne $installerCases[$installerIndex][1]) {
    throw ('Unexpected installer language for Windows language '+$installerCases[$installerIndex][0])
  }
}
Write-Output ('Installer language selection: '+$installerCases.Count+' cases passed; '+$installerResults[-1])
