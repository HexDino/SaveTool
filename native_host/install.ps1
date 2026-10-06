# Install yt-dlp native messaging host for Chrome
# Run this in PowerShell (no Administrator needed - it registers for the current user)

param(
    [Parameter(Mandatory=$true)]
    [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'

$RegPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.socialdownloader.ytdlp'
$HostDir = $PSScriptRoot
$ManifestFile = Join-Path $HostDir 'com.socialdownloader.ytdlp.json'
$BatchFile = Join-Path $HostDir 'yt_dlp_host.bat'
$HostScript = Join-Path $HostDir 'yt_dlp_host.py'
$PythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source

if (-not $PythonExe) {
    Write-Host 'ERROR: Python not found in PATH' -ForegroundColor Red
    exit 1
}

# Generate the batch wrapper (Chrome on Windows cannot pass script arguments,
# so the manifest must point at a .bat that invokes python with the script)
$BatContent = "@echo off`r`n`"$PythonExe`" -u `"$HostScript`" %*`r`n"
Set-Content -Path $BatchFile -Value $BatContent -Encoding ASCII

$ManifestContent = @{
    name = 'com.socialdownloader.ytdlp'
    description = 'yt-dlp native host for Social Media Downloader extension'
    path = $BatchFile
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 5

$ManifestContent | Set-Content -Path $ManifestFile -Encoding UTF8

New-Item -Path $RegPath -Force | Out-Null
Set-ItemProperty -Path $RegPath -Name '(Default)' -Value $ManifestFile

Write-Host 'Native messaging host installed successfully!' -ForegroundColor Green
Write-Host "Extension ID: $ExtensionId"
Write-Host "Python: $PythonExe"
Write-Host "Batch wrapper: $BatchFile"
Write-Host "Registry path: $RegPath"
Write-Host "Manifest: $ManifestFile"
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Yellow
Write-Host '1. Reload your extension in chrome://extensions/'
Write-Host '2. Try downloading a video from YouTube, TikTok, Twitter/X, or Threads'
