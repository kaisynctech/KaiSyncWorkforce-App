#Requires -Version 5.1
<#
.SYNOPSIS
  Silent install, upgrade, and uninstall smoke test for KaiSyncWorkforceSetup.exe.

.EXAMPLE
  .\scripts\verify_windows_installer.ps1
  .\scripts\verify_windows_installer.ps1 -InstallerPath dist\KaiSyncWorkforceSetup.exe
#>
param(
    [string]$InstallerPath = "",
    [string]$InstallDir = "${env:ProgramFiles}\KaiSync Workforce"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $InstallerPath = Join-Path $root "dist\KaiSyncWorkforceSetup.exe"
}
$InstallerPath = (Resolve-Path $InstallerPath).Path
$logRoot = Join-Path $root "dist\verify-logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Get-Uninstaller {
    param([string]$Dir)
    $unins = Join-Path $Dir "unins000.exe"
    if (Test-Path $unins) { return $unins }
    return $null
}

function Test-InstallArtifacts {
    param([string]$Dir)
    $exe = Join-Path $Dir "KaiFlow.Timesheets.Maui.exe"
    if (-not (Test-Path $exe)) { throw "Missing installed executable: $exe" }

    $startMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\KaiSync Workforce"
    $lnk = Join-Path $startMenu "KaiSync Workforce.lnk"
    if (-not (Test-Path $lnk)) { throw "Missing Start Menu shortcut: $lnk" }

    $desktop = [Environment]::GetFolderPath("CommonDesktopDirectory")
    $desktopLnk = Join-Path $desktop "KaiSync Workforce.lnk"
    if (-not (Test-Path $desktopLnk)) { throw "Missing desktop shortcut: $desktopLnk" }

    Write-Host "  OK artifacts in $Dir" -ForegroundColor Green
}

Write-Host "KaiSync Workforce installer verification" -ForegroundColor Cyan
Write-Host "  Installer: $InstallerPath"

# Clean prior test install
$unins = Get-Uninstaller -Dir $InstallDir
if ($unins) {
    Write-Host "Removing previous install..." -ForegroundColor Yellow
    & $unins /VERYSILENT /SUPPRESSMSGBOXES /NORESTART | Out-Null
    Start-Sleep -Seconds 3
}

# Fresh install
$freshLog = Join-Path $logRoot "install-fresh.log"
Write-Host "Fresh silent install..." -ForegroundColor Yellow
$p = Start-Process -FilePath $InstallerPath -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=`"$freshLog`"") -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Fresh install failed with exit code $($p.ExitCode). Log: $freshLog" }
Test-InstallArtifacts -Dir $InstallDir

# Upgrade (re-run same installer)
$upgradeLog = Join-Path $logRoot "install-upgrade.log"
Write-Host "Upgrade silent install (same version)..." -ForegroundColor Yellow
$p2 = Start-Process -FilePath $InstallerPath -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=`"$upgradeLog`"") -Wait -PassThru
if ($p2.ExitCode -ne 0) { throw "Upgrade install failed with exit code $($p2.ExitCode). Log: $upgradeLog" }
Test-InstallArtifacts -Dir $InstallDir

# Uninstall
$unins = Get-Uninstaller -Dir $InstallDir
if (-not $unins) { throw "Uninstaller not found after install." }
$uninstallLog = Join-Path $logRoot "uninstall.log"
Write-Host "Silent uninstall..." -ForegroundColor Yellow
$p3 = Start-Process -FilePath $unins -ArgumentList @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/LOG=`"$uninstallLog`"") -Wait -PassThru
if ($p3.ExitCode -ne 0) { throw "Uninstall failed with exit code $($p3.ExitCode). Log: $uninstallLog" }
Start-Sleep -Seconds 2
if (Test-Path (Join-Path $InstallDir "KaiFlow.Timesheets.Maui.exe")) {
    throw "Application files still present after uninstall: $InstallDir"
}

Write-Host ""
Write-Host "VERIFICATION PASSED" -ForegroundColor Green
Write-Host "  Fresh install:  $freshLog"
Write-Host "  Upgrade install: $upgradeLog"
Write-Host "  Uninstall:      $uninstallLog"
