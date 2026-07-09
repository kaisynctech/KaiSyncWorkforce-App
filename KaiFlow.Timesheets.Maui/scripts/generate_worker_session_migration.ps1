# Generates worker session enforcement migration by patching latest employee_* RPC definitions.
$ErrorActionPreference = "Stop"
$migrationsDir = (Resolve-Path (Join-Path $PSScriptRoot "..\supabase\migrations")).Path
$outFile = Join-Path $migrationsDir "20260601120000_worker_session_enforcement_rpcs.sql"

$exclude = @(
    "employee_resolve_by_code",
    "employee_sign_in_with_code",
    "employee_refresh_code_session",
    "employee_revoke_code_session",
    "employee_validate_session",
    "employee_get_my_memberships_by_code",
    "employee_self_register"
)

$extra = @("sync_operational_pa_tasks", "upsert_employee_pa_settings", "enqueue_pa_task_notifications")

$files = Get-ChildItem $migrationsDir -Filter "*.sql" | Sort-Object Name
$latest = @{}

foreach ($f in $files) {
    $text = Get-Content $f.FullName -Raw
    $pattern = '(?is)(create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)\s*\([^;]*?\$\$.*?;\s*)'
    foreach ($m in [regex]::Matches($text, $pattern)) {
        $name = $m.Groups[2].Value
        if (($name -like "employee_*") -or ($extra -contains $name)) {
            if ($exclude -contains $name) { continue }
            $latest[$name] = $m.Groups[1].Value
        }
    }
}

function Inject-SessionGuard {
    param([string]$Def)
    if ($Def -match 'p_session_token') { return $Def }

    $Def = [regex]::Replace($Def, '(?is)(\)\s*returns)', ",`n  p_session_token text DEFAULT NULL`n)` + '$1')

    if ($Def -match 'p_company_id') {
        $guard = '  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);'
    } else {
        $guard = '  PERFORM public._assert_worker_access_by_employee(p_employee_id, p_session_token);'
    }

    $match = [regex]::Match($Def, '(?is)as\s+\$\$\s*(declare|begin)')
    if (-not $match.Success) { return $Def }
    $insertAt = $match.Index + $match.Length
    $nl = [Environment]::NewLine
    return $Def.Insert($insertAt, $nl + $guard)
}

$lines = @("-- AUTO-GENERATED worker session enforcement migration", "SET search_path = public;", "")
foreach ($name in ($latest.Keys | Sort-Object)) {
    $lines += (Inject-SessionGuard -Def $latest[$name])
    $lines += ""
}

[System.IO.File]::WriteAllText($outFile, ($lines -join [Environment]::NewLine))
Write-Output ('Wrote ' + $latest.Count + ' functions')
