#Requires -Version 5.1
<#
.SYNOPSIS
  Build KaiFlow Windows Release publish output and KaiFlowSetup.exe installer.

.EXAMPLE
  .\scripts\build_windows_installer.ps1
  .\scripts\build_windows_installer.ps1 -Version 1.0.1 -Build 2
#>
param(
    [string]$Configuration = "Release",
    [string]$Version = "",
    [int]$Build = 0,
    [string]$Iscc = "",
    [switch]$SkipPublish
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$csproj = Join-Path $root "KaiFlow.Timesheets.Maui.csproj"
$publishDir = Join-Path $root "publish\windows"
$distDir = Join-Path $root "dist"
$iss = Join-Path $root "installers\KaiFlowSetup.iss"

# Read version from csproj if not supplied
if ([string]::IsNullOrWhiteSpace($Version)) {
    [xml]$proj = Get-Content $csproj
    $Version = $proj.Project.PropertyGroup.ApplicationDisplayVersion | Select-Object -First 1
}
if ($Build -le 0) {
    [xml]$proj = Get-Content $csproj
    $Build = [int]($proj.Project.PropertyGroup.ApplicationVersion | Select-Object -First 1)
}

Write-Host "KaiFlow Windows build — v$Version (build $Build)" -ForegroundColor Cyan

if (-not $SkipPublish) {
    Write-Host "Publishing MAUI Windows (win-x64)..." -ForegroundColor Yellow
    dotnet publish $csproj `
        -f net10.0-windows10.0.19041.0 `
        -c $Configuration `
        -r win-x64 `
        --self-contained false `
        -p:PublishSingleFile=false `
        -o $publishDir

    $exe = Join-Path $publishDir "KaiFlow.Timesheets.Maui.exe"
    if (-not (Test-Path $exe)) {
        throw "Publish failed — executable not found: $exe"
    }
    Write-Host "Publish OK: $exe" -ForegroundColor Green
}

if ([string]::IsNullOrWhiteSpace($Iscc)) {
    $isccCmd = Get-Command iscc -ErrorAction SilentlyContinue
    if ($isccCmd) { $Iscc = $isccCmd.Source }
    else {
        foreach ($fallback in @(
            "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
            "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
            "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
        )) {
            if (Test-Path $fallback) { $Iscc = $fallback; break }
        }
    }
}

if ([string]::IsNullOrWhiteSpace($Iscc) -or -not (Test-Path $Iscc)) {
    Write-Warning "Inno Setup not found. Publish folder is ready at: $publishDir"
    Write-Warning "Install Inno Setup 6 from https://jrsoftware.org/isinfo.php then re-run."
    exit 0
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null

Write-Host "Compiling KaiFlowSetup.exe..." -ForegroundColor Yellow
& $Iscc $iss "/DPublishDir=$publishDir" "/DMyAppVersion=$Version" "/DMyAppBuild=$Build"

$setup = Join-Path $distDir "KaiFlowSetup.exe"
if (-not (Test-Path $setup)) {
    throw "Installer build failed — $setup not found."
}

$hash = Get-FileHash $setup -Algorithm SHA256
Write-Host ""
Write-Host "SUCCESS" -ForegroundColor Green
Write-Host "  Installer: $setup"
Write-Host "  Version:   $Version (build $Build)"
Write-Host "  SHA256:    $($hash.Hash)"
Write-Host ""
Write-Host "Next: upload to Supabase Storage — see docs/deployment/release-hosting.md"
