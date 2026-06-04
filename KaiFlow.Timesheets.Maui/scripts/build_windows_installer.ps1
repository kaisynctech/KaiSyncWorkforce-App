#Requires -Version 5.1
<#
.SYNOPSIS
  Build KaiSync Workforce Windows Release publish output and KaiSyncWorkforceSetup.exe installer.

.EXAMPLE
  .\scripts\build_windows_installer.ps1
  .\scripts\build_windows_installer.ps1 -Version 1.0.1 -Build 2
  .\scripts\build_windows_installer.ps1 -SkipPublish
  .\scripts\build_windows_installer.ps1 -InstallInnoSetup
#>
param(
    [string]$Configuration = "Release",
    [string]$Version = "",
    [int]$Build = 0,
    [string]$Iscc = "",
    [switch]$SkipPublish,
    [switch]$InstallInnoSetup
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$csproj = Join-Path $root "KaiFlow.Timesheets.Maui.csproj"
$publishDir = Join-Path $root "publish\windows"
$distDir = Join-Path $root "dist"
$iss = Join-Path $root "installers\KaiFlowSetup.iss"  # filename unchanged — internal only

function Resolve-InnoSetupCompiler {
    param([string]$ExplicitPath)

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath) -and (Test-Path $ExplicitPath)) {
        return $ExplicitPath
    }

    $isccCmd = Get-Command iscc -ErrorAction SilentlyContinue
    if ($isccCmd) { return $isccCmd.Source }

    foreach ($fallback in @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    )) {
        if (Test-Path $fallback) { return $fallback }
    }

    return $null
}

function Install-InnoSetup {
    Write-Host "Installing Inno Setup 6 via winget..." -ForegroundColor Yellow
    winget install --id JRSoftware.InnoSetup -e --accept-source-agreements --accept-package-agreements | Out-Host
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    [xml]$proj = Get-Content $csproj
    $Version = $proj.Project.PropertyGroup.ApplicationDisplayVersion | Select-Object -First 1
}
if ($Build -le 0) {
    [xml]$proj = Get-Content $csproj
    $Build = [int]($proj.Project.PropertyGroup.ApplicationVersion | Select-Object -First 1)
}

Write-Host "KaiSync Workforce Windows build - v$Version (build $Build)" -ForegroundColor Cyan

if (-not $SkipPublish) {
    Write-Host "Publishing MAUI Windows (win-x64)..." -ForegroundColor Yellow
    dotnet publish $csproj `
        -f net10.0-windows10.0.19041.0 `
        -c $Configuration `
        --self-contained false `
        -p:PublishSingleFile=false `
        -o $publishDir

    if ($LASTEXITCODE -ne 0) {
        throw "dotnet publish failed with exit code $LASTEXITCODE"
    }

    $exe = Join-Path $publishDir "KaiFlow.Timesheets.Maui.exe"
    if (-not (Test-Path $exe)) {
        throw "Publish failed - executable not found: $exe"
    }
    Write-Host "Publish OK: $exe" -ForegroundColor Green
}

$Iscc = Resolve-InnoSetupCompiler -ExplicitPath $Iscc
if (-not $Iscc -and $InstallInnoSetup) {
    Install-InnoSetup
    $Iscc = Resolve-InnoSetupCompiler -ExplicitPath ""
}

if (-not $Iscc) {
    throw "Inno Setup 6 (ISCC.exe) not found. Install from https://jrsoftware.org/isinfo.php or re-run with -InstallInnoSetup."
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null

Write-Host "Compiling KaiSyncWorkforceSetup.exe with: $Iscc" -ForegroundColor Yellow
& $Iscc $iss "/DPublishDir=$publishDir" "/DMyAppVersion=$Version" "/DMyAppBuild=$Build"

$setup = Join-Path $distDir "KaiSyncWorkforceSetup.exe"
if (-not (Test-Path $setup)) {
    throw "Installer build failed - file not found: $setup"
}

$versioned = Join-Path $distDir "KaiSyncWorkforceSetup-v$Version.exe"
Copy-Item $setup $versioned -Force

$hash = Get-FileHash $setup -Algorithm SHA256
$sizeMb = [math]::Round((Get-Item $setup).Length / 1MB, 2)

Write-Host ""
Write-Host "SUCCESS" -ForegroundColor Green
Write-Host "  Installer:       $setup"
Write-Host "  Versioned copy:  $versioned"
Write-Host "  Version:         $Version (build $Build)"
Write-Host "  Size:            $sizeMb MB"
Write-Host "  SHA256:          $($hash.Hash)"
Write-Host ""
Write-Host "Next: upload dist/KaiSyncWorkforceSetup.exe to GitHub Release and update app_versions.download_url_windows"

$manifest = @{
    version       = $Version
    build         = $Build
    installerPath = $setup
    versionedPath = $versioned
    publishDir    = $publishDir
    sizeBytes     = (Get-Item $setup).Length
    sha256        = $hash.Hash
    builtAt       = (Get-Date).ToUniversalTime().ToString("o")
    installDir    = "${env:ProgramFiles}\KaiSync Workforce"
}
$manifestPath = Join-Path $distDir "KaiSyncWorkforceSetup-build-manifest.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath -Encoding UTF8
Write-Host "  Manifest:        $manifestPath"
