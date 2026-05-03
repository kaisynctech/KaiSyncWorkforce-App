param(
  [string]$Flutter = "C:\src\flutter\bin\flutter.bat",
  [string]$Iscc = ""
)

$ErrorActionPreference = "Stop"

Write-Host "Building Windows release..."
& $Flutter build windows --release

if (-not (Test-Path "build\windows\x64\runner\Release\timesheets.exe")) {
  throw "Windows release executable not found."
}

if ([string]::IsNullOrWhiteSpace($Iscc)) {
  $isccCmd = Get-Command iscc -ErrorAction SilentlyContinue
  if ($isccCmd) {
    $Iscc = $isccCmd.Source
  } else {
    $fallbacks = @(
      "C:\Program Files\Inno Setup 6\ISCC.exe",
      "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
      "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    )
    foreach ($fallback in $fallbacks) {
      if (Test-Path $fallback) {
        $Iscc = $fallback
        break
      }
    }
  }
}

if ([string]::IsNullOrWhiteSpace($Iscc) -or -not (Test-Path $Iscc)) {
  throw "Inno Setup compiler not found. Install Inno Setup 6, then re-run this script."
}

Write-Host "Compiling installer with Inno Setup..."
& $Iscc "installers\windows_installer.iss"

if (-not (Test-Path "dist\KaiSync-Workforce-Setup.exe")) {
  throw "Installer build failed: dist\KaiSync-Workforce-Setup.exe not found."
}

Write-Host "Installer ready: dist\KaiSync-Workforce-Setup.exe"
