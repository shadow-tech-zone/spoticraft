# Desktop par "Bloomee Web" shortcut banata hai.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$path = Join-Path $desktop 'Bloomee Web.lnk'
$lnk = $shell.CreateShortcut($path)
$lnk.TargetPath = Join-Path $root 'Start-Bloomee.bat'
$lnk.WorkingDirectory = $root
$lnk.Description = 'Bloomee Web - local music player'
$nodeExe = Join-Path $root 'runtime\node\node.exe'
if (Test-Path $nodeExe) { $lnk.IconLocation = "$nodeExe,0" }
$lnk.Save()
Write-Host "Desktop shortcut ban gaya: $path"
