# Removes corrupted build/VS cache folders that cause "Illegal characters in path" / project load failed.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "Stopping KaiFlow.Timesheets.Maui if running..."
Get-Process -Name "KaiFlow.Timesheets.Maui" -ErrorAction SilentlyContinue | Stop-Process -Force

$toRemove = @(
    Join-Path $root "bin"
    Join-Path $root "obj"
    Join-Path $root ".vs"
    Join-Path (Split-Path $root -Parent) "KaiFlow.Timesheets.Tests\bin"
    Join-Path (Split-Path $root -Parent) "KaiFlow.Timesheets.Tests\obj"
)

foreach ($path in $toRemove) {
    if (Test-Path $path) {
        Write-Host "Removing $path"
        try {
            Remove-Item $path -Recurse -Force -ErrorAction Stop
        }
        catch {
            Write-Warning "Could not remove $path (close Visual Studio first): $_"
        }
    }
}

Write-Host ""
Write-Host "Done. Close Visual Studio completely, then reopen:"
Write-Host "  KaiFlow.Timesheets.Maui\KaiFlow.Timesheets.Maui.sln"
Write-Host "Toolbar: Debug | Any CPU | Windows Machine"
