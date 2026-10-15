param(
  [string]$ExecutablePath,
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$previewProject = Split-Path -Parent $PSScriptRoot
if (!$ExecutablePath) { $ExecutablePath = Join-Path $previewProject 'target\release\aurum.exe' }
$previewExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
if ([IO.Path]::GetFileName($previewExecutable) -ne 'aurum.exe') { throw 'Expected an Aurum executable.' }
if (!$PrepareOnly -and @(Get-Process -Name aurum -ErrorAction SilentlyContinue).Count) {
  throw 'Close the running Aurum window first. The single-instance guard would otherwise focus that window instead of opening the isolated preview.'
}
$previewName = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$previewRoot = Join-Path $previewProject ('.test-data\previews\' + $previewName)
$previewData = Join-Path $previewRoot 'data'
$previewBrowser = Join-Path $previewRoot 'webview'
New-Item -ItemType Directory -Path $previewData, $previewBrowser -Force | Out-Null
$previewStart = New-Object System.Diagnostics.ProcessStartInfo
$previewStart.FileName = $previewExecutable
$previewStart.WorkingDirectory = $previewProject
$previewStart.UseShellExecute = $false
$previewStart.CreateNoWindow = $true
# These changes belong only to the child process, never the user's environment.
$previewStart.EnvironmentVariables['AURUM_DATA_DIR'] = $previewData
$previewStart.EnvironmentVariables.Remove('AUREN_DATA_DIR')
$previewStart.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = $previewBrowser
$previewStart.EnvironmentVariables.Remove('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS')
$previewStart.EnvironmentVariables.Remove('WEBVIEW2_PIPE_FOR_SCRIPT_DEBUGGER')
$previewStart.EnvironmentVariables.Remove('WEBVIEW2_WAIT_FOR_SCRIPT_DEBUGGER')
if ($PrepareOnly) {
  [pscustomobject]@{ Executable = $previewExecutable; DataDirectory = $previewData; BrowserDirectory = $previewBrowser }
  return
}
$previewProcess = [Diagnostics.Process]::Start($previewStart)
if (!$previewProcess) { throw 'Could not start Aurum preview.' }
[pscustomobject]@{ ProcessId = $previewProcess.Id; Executable = $previewExecutable; DataDirectory = $previewData; BrowserDirectory = $previewBrowser }
