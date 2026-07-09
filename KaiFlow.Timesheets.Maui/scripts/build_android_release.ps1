#Requires -Version 5.1
<#
.SYNOPSIS
  Build a signed KaiSync Workforce Android APK and release manifest.

.DESCRIPTION
  Requires KAIFLOW_KEYSTORE_PATH, KAIFLOW_KEYSTORE_ALIAS, and
  KAIFLOW_KEYSTORE_PASSWORD. The same signing key must be retained for every
  release or Android will reject in-place upgrades.
#>
param(
    [string]$Configuration = "Release",
    [string]$Version = "",
    [int]$Build = 0
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$csproj = Join-Path $root "KaiFlow.Timesheets.Maui.csproj"
$distDir = Join-Path $root "dist"

foreach ($name in @(
    "KAIFLOW_KEYSTORE_PATH",
    "KAIFLOW_KEYSTORE_ALIAS",
    "KAIFLOW_KEYSTORE_PASSWORD"
)) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
        throw "$name is required for a signed Android release."
    }
}

if (-not (Test-Path $env:KAIFLOW_KEYSTORE_PATH)) {
    throw "Android signing keystore not found: $env:KAIFLOW_KEYSTORE_PATH"
}

[xml]$proj = Get-Content $csproj
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = $proj.Project.PropertyGroup.ApplicationDisplayVersion | Select-Object -First 1
}
if ($Build -le 0) {
    $Build = [int]($proj.Project.PropertyGroup.ApplicationVersion | Select-Object -First 1)
}

Write-Host "KaiSync Workforce Android build - v$Version (build $Build)" -ForegroundColor Cyan

dotnet publish $csproj `
    -f net10.0-android `
    -c $Configuration `
    -p:AndroidPackageFormat=apk `
    -p:RunAOTCompilation=false `
    -m:1 `
    -p:UseSharedCompilation=false `
    -nodeReuse:false

if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

$publishDir = Join-Path $root "bin\$Configuration\net10.0-android\publish"
$signedApk = Get-ChildItem $publishDir -File -Filter "*-Signed.apk" |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

if (-not $signedApk) {
    throw "Signed APK not found in $publishDir"
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$releaseApk = Join-Path $distDir "KaiSyncWorkforce-v$Version.apk"
Copy-Item $signedApk.FullName $releaseApk -Force

$hash = Get-FileHash $releaseApk -Algorithm SHA256
$manifest = @{
    version   = $Version
    build     = $Build
    packageId = "com.kaisynctech.kaiflow.timesheets"
    artifact  = $releaseApk
    sizeBytes = (Get-Item $releaseApk).Length
    sha256    = $hash.Hash
    builtAt   = (Get-Date).ToUniversalTime().ToString("o")
}
$manifestPath = Join-Path $distDir "KaiSyncWorkforce-android-build-manifest.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath -Encoding UTF8

Write-Host ""
Write-Host "SUCCESS" -ForegroundColor Green
Write-Host "  APK:      $releaseApk"
Write-Host "  Version:  $Version (build $Build)"
Write-Host "  SHA256:   $($hash.Hash)"
Write-Host "  Manifest: $manifestPath"
