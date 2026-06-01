# Launch KaiFlow on Windows (use this if Visual Studio does not open a window).
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Get-Process -Name "KaiFlow.Timesheets.Maui" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Building Windows app..."
dotnet build "$root\KaiFlow.Timesheets.Maui.csproj" -f net10.0-windows10.0.19041.0 -c Debug

$exe = "$root\bin\Debug\net10.0-windows10.0.19041.0\win-x64\KaiFlow.Timesheets.Maui.exe"
if (-not (Test-Path $exe)) {
    Write-Error "Exe not found: $exe"
}

Write-Host "Starting $exe"
Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe)
