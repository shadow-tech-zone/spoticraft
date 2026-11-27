# Bloomee Web - Windows launcher
# Backend + website aap ke PC par local chalta hai (default port 8000).
# YouTube Music streams is liye chalte hain: requests kisi datacenter se
# nahi, aap ke ghar ki IP se jati hain (Bloomee app ki tarah).
# Pehli dafa Node.js na mile to portable Node isi folder me download ho jata hai.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$port = 8000
if ($env:BLOOMEE_PORT) { $port = [int]$env:BLOOMEE_PORT }
$url = "http://localhost:$port"

function Find-Node {
    $portable = Join-Path $root 'runtime\node\node.exe'
    if (Test-Path $portable) { return $portable }
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Install-PortableNode {
    Write-Host ''
    Write-Host 'Node.js nahi mila. Portable Node download ho raha hai (sirf pehli dafa, ~30 MB)...' -ForegroundColor Yellow
    $arch = 'x64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
    $rel = $index | Where-Object { $_.lts -and ($_.files -contains "win-$arch-zip") } | Select-Object -First 1
    if (-not $rel) { throw 'Node.js ki release list nahi mili. Internet connection check karein.' }
    $ver = $rel.version
    $zipName = "node-$ver-win-$arch.zip"
    $runtimeDir = Join-Path $root 'runtime'
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    $zipPath = Join-Path $runtimeDir $zipName
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$ver/$zipName" -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $runtimeDir -Force
    Remove-Item $zipPath -Force
    $target = Join-Path $runtimeDir 'node'
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    Rename-Item -Path (Join-Path $runtimeDir "node-$ver-win-$arch") -NewName 'node'
    $exe = Join-Path $target 'node.exe'
    if (-not (Test-Path $exe)) { throw 'Portable Node install nahi ho saka.' }
    Write-Host "Node.js $ver tayyar hai." -ForegroundColor Green
    return $exe
}

function Test-PortBusy([int]$p) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect('127.0.0.1', $p)
        $c.Close()
        return $true
    } catch { return $false }
}

Write-Host '==========================================='
Write-Host '  Bloomee Web - local player'
Write-Host '==========================================='

$node = Find-Node
if (-not $node) { $node = Install-PortableNode }

$verOut = & $node --version
$major = 0
if ($verOut -match '^v(\d+)\.') { $major = [int]$Matches[1] }
if ($major -lt 18) {
    Write-Host "Node.js $verOut purana hai (v18+ chahiye). https://nodejs.org se naya LTS install karein." -ForegroundColor Red
    exit 1
}

if (Test-PortBusy $port) {
    Write-Host "Port $port pehle se busy hai - lagta hai Bloomee pehle se chal raha hai. Browser khol raha hoon..." -ForegroundColor Yellow
    Start-Process $url
    exit 0
}

$env:PORT = "$port"
Write-Host "Server start ho raha hai: $url"
$server = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -PassThru -NoNewWindow

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    if ($server.HasExited) { break }
    if (Test-PortBusy $port) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) {
    Write-Host 'Server start nahi ho saka. Upar wala error dekhein.' -ForegroundColor Red
    exit 1
}

Start-Process $url
Write-Host ''
Write-Host 'Bloomee chal raha hai. Band karne ke liye is window ko band kar dein.' -ForegroundColor Green
Write-Host '(Ye window khuli rakhein - yahi aap ka local server hai.)'
try {
    while (-not $server.HasExited) { Start-Sleep -Seconds 1 }
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
