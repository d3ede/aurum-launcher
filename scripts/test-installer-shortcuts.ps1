$ErrorActionPreference='Stop'
$installerProject=Split-Path -Parent $PSScriptRoot
$installerTest=[IO.Path]::GetFullPath((Join-Path $installerProject '.test-data/installer-shortcuts'))
New-Item -ItemType Directory -Path $installerTest -Force | Out-Null
$installerCompiler=Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe'
if(!(Test-Path -LiteralPath $installerCompiler)) { throw 'Build a Tauri NSIS bundle before running this test.' }
function New-ShortcutFixture([string]$Folder,[string]$Product) {
  New-Item -ItemType Directory -Path $Folder -Force | Out-Null
  $fixture=@'
Unicode true
OutFile "__EXE__"
SilentInstall silent
RequestExecutionLevel user
VIProductVersion "0.3.6.0"
VIAddVersionKey "ProductName" "__PRODUCT__"
VIAddVersionKey "FileVersion" "0.3.6"
VIAddVersionKey "FileDescription" "Installer shortcut regression fixture"
VIAddVersionKey "LegalCopyright" "Aurum test fixture"
Section
SectionEnd
'@
  $fixture=$fixture.Replace('__EXE__',(Join-Path $Folder 'aurum.exe')).Replace('__PRODUCT__',$Product)
  $fixtureSource=Join-Path $Folder 'fixture.nsi'
  [IO.File]::WriteAllText($fixtureSource,$fixture,[Text.UTF8Encoding]::new($false))
  & $installerCompiler /V2 /INPUTCHARSET UTF8 $fixtureSource
  if($LASTEXITCODE) { throw 'Shortcut fixture compilation failed.' }
}
$installerOld=Join-Path $installerTest 'старый preview'
$installerNew=Join-Path $installerTest 'installed'
$installerForeign=Join-Path $installerTest 'foreign'
New-ShortcutFixture $installerOld 'Aurum Installer QA'
New-ShortcutFixture $installerNew 'Aurum Installer QA'
New-ShortcutFixture $installerForeign 'Unrelated Application'
Copy-Item -LiteralPath (Join-Path $installerOld 'aurum.exe') -Destination (Join-Path $installerOld 'other.exe') -Force
$installerTarget=Join-Path $installerNew 'aurum.exe'
$installerMissing=Join-Path $installerTest 'deleted-copy'
New-Item -ItemType Directory -Path $installerMissing -Force | Out-Null
$installerMissingTarget=Join-Path $installerMissing 'aurum.exe'
Copy-Item -LiteralPath (Join-Path $installerOld 'aurum.exe') -Destination $installerMissingTarget -Force
$installerCustom=Join-Path $installerTest 'custom'
New-Item -ItemType Directory -Path $installerCustom -Force | Out-Null
$installerCases=@(
  @('old', (Join-Path $installerOld 'aurum.exe'), 1),
  @('current', $installerTarget, 1),
  @('foreign', (Join-Path $installerForeign 'aurum.exe'), 0),
  @('wrong-name', (Join-Path $installerOld 'other.exe'), 0),
  @('missing-target', $installerMissingTarget, 0),
  @('custom', (Join-Path $installerOld 'aurum.exe'), 1),
  @('missing-link', '', 0)
)
# Exercise Tauri's actual Windows resource format when a launcher build exists.
# Copy the EXE into the fixture area; it is inspected, never executed.
$installerRealPayload=Join-Path $installerProject 'target/release/aurum.exe'
if((Test-Path -LiteralPath $installerRealPayload) -and (Get-Item -LiteralPath $installerRealPayload).VersionInfo.ProductName -eq 'Aurum Launcher') {
  $installerRealPreview=Join-Path $installerTest 'real-preview'
  New-Item -ItemType Directory -Path $installerRealPreview -Force | Out-Null
  Copy-Item -LiteralPath $installerRealPayload -Destination (Join-Path $installerRealPreview 'aurum.exe') -Force
  $installerCases+= ,@('real-launcher', (Join-Path $installerRealPreview 'aurum.exe'), 1, 'Aurum Launcher')
}
$installerShell=New-Object -ComObject WScript.Shell
$installerBefore=@{}
foreach($installerCase in $installerCases) {
  $linkPath=Join-Path $installerTest ($installerCase[0]+'.lnk')
  if($installerCase[0] -eq 'missing-link') {
    if(Test-Path -LiteralPath $linkPath) { Remove-Item -LiteralPath $linkPath }
    continue
  }
  $link=$installerShell.CreateShortcut($linkPath)
  try { $link.TargetPath=$installerCase[1] }
  catch { throw ('Unable to create shortcut fixture '+$installerCase[0]+': '+$_.Exception.Message) }
  $link.Arguments='--test "argument with spaces"'
  $link.Description='Keep this description'
  $link.Hotkey='CTRL+ALT+F9'
  $link.WindowStyle=7
  $link.WorkingDirectory=Split-Path -Parent $installerCase[1]
  $link.IconLocation=$installerCase[1]+',0'
  if($installerCase[0] -eq 'custom') {
    $link.WorkingDirectory=$installerCustom
    $link.IconLocation=(Join-Path $installerForeign 'aurum.exe')+',0'
  }
  $link.Save()
  $installerBefore[$installerCase[0]]= $installerShell.CreateShortcut($linkPath)
}
# Some Windows Shell versions require an existing destination when creating a
# link. Delete this owned payload afterwards to test an orphaned shortcut.
Remove-Item -LiteralPath $installerMissingTarget
$installerHarness=@'
Unicode true
!addplugindir "__PLUGINS__"
OutFile "__EXE__"
SilentInstall silent
RequestExecutionLevel user
Section
  FileOpen $R0 "__RESULT__" w
__CASES__
  FileClose $R0
SectionEnd
'@
$installerCalls=foreach($installerCase in $installerCases) {
  $linkPath=Join-Path $installerTest ($installerCase[0]+'.lnk')
  $product=if($installerCase.Count -gt 3) { $installerCase[3] } else { 'Aurum Installer QA' }
  '  AurumUI::RepairShortcut /NOUNLOAD "'+$linkPath+'" "'+$installerTarget+'" "'+$product+'"'
  '  Pop $0'
  '  FileWrite $R0 "$0$\r$\n"'
}
$installerHarness=$installerHarness.Replace('__PLUGINS__',(Join-Path $installerProject 'target/installer-plugins')).Replace('__EXE__',(Join-Path $installerTest 'shortcut-test.exe')).Replace('__RESULT__',(Join-Path $installerTest 'results.txt')).Replace('__CASES__',($installerCalls -join "`r`n"))
[IO.File]::WriteAllText((Join-Path $installerTest 'shortcut-test.nsi'),$installerHarness,[Text.UTF8Encoding]::new($false))
& $installerCompiler /V2 /INPUTCHARSET UTF8 (Join-Path $installerTest 'shortcut-test.nsi')
if($LASTEXITCODE) { throw 'Shortcut harness compilation failed.' }
$installerProcess=Start-Process -FilePath (Join-Path $installerTest 'shortcut-test.exe') -WindowStyle Hidden -PassThru
if(!$installerProcess.WaitForExit(30000) -or $installerProcess.ExitCode) { throw 'Shortcut harness failed.' }
$installerResults=Get-Content -LiteralPath (Join-Path $installerTest 'results.txt')
if($installerResults.Count -ne $installerCases.Count) { throw 'Incomplete shortcut results.' }
for($installerIndex=0;$installerIndex -lt $installerCases.Count;$installerIndex++) {
  $case=$installerCases[$installerIndex]
  $name=$case[0]
  if($installerResults[$installerIndex] -ne $case[2].ToString()) { throw ('Unexpected repair result: '+$name) }
  $linkPath=Join-Path $installerTest ($name+'.lnk')
  if($name -eq 'missing-link') {
    if(Test-Path -LiteralPath $linkPath) { throw 'Update recreated a deleted shortcut.' }
    continue
  }
  $link=$installerShell.CreateShortcut($linkPath)
  $expected=if($case[2]) { $installerTarget } else { $case[1] }
  if($link.TargetPath -ne $expected) { throw ('Incorrect shortcut target: '+$name) }
  $before=$installerBefore[$name]
  foreach($property in @('Arguments','Description','Hotkey','WindowStyle')) {
    if($link.$property -ne $before.$property) { throw ('Shortcut lost '+$property+': '+$name) }
  }
  $expectedWorking=if($case[2] -and $name -ne 'custom') { $installerNew } else { $before.WorkingDirectory }
  $expectedIcon=if($case[2] -and $name -ne 'custom') { $installerTarget+',0' } else { $before.IconLocation }
  if($link.WorkingDirectory -ne $expectedWorking -or $link.IconLocation -ne $expectedIcon) { throw ('Incorrect shortcut working directory or icon: '+$name) }
}
Write-Output ('Installer shortcuts: '+$installerCases.Count+' cases passed; targets, icons, metadata and deleted shortcuts verified.')
