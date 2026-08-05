# Pre/post deploy RPC & schema probe. Usage: .\pre_deploy_probe.ps1 [-Label pre|post]
param([string]$Label = "probe")

$base = "https://vcivtjwreybaxgtdhtou.supabase.co"
$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjaXZ0andyZXliYXhndGRodG91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDAzNTAsImV4cCI6MjA4ODg3NjM1MH0.zgeJXXiO1QReTu2S2StvGy32LK6PjOk-FTS2DUrq5Jg"
$headers = @{ "apikey" = $key; "Authorization" = "Bearer $key"; "Content-Type" = "application/json" }
$outDir = Join-Path $PSScriptRoot "..\snapshots\20260528-pre-parity-deploy"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$log = Join-Path $outDir "${Label}_deploy_probe.txt"
"" | Set-Content $log

function Log($msg) { Add-Content $log $msg; Write-Host $msg }

Log "=== KaiFlow deploy probe ($Label) $(Get-Date -Format o) ==="

$tables = @("time_punches","message_threads","app_messages","jobs","employees","leave_requests","inventory_items")
foreach ($t in $tables) {
  try {
    $r = Invoke-WebRequest -Uri "$base/rest/v1/$t`?select=id&limit=0" -Headers $headers -Method GET -UseBasicParsing
    Log "TABLE OK  $t $($r.StatusCode)"
  } catch {
    Log "TABLE ERR $t $($_.Exception.Response.StatusCode.value__)"
  }
}

$dummy = "00000000-0000-0000-0000-000000000001"
$emp = "00000000-0000-0000-0000-000000000002"
$rpcs = @(
  @{ n = "employee_insert_punch"; b = "{`"p_company_id`":`"$dummy`",`"p_employee_id`":`"$emp`",`"p_type`":`"in`",`"p_date_time`":`"2026-05-28T10:00:00Z`",`"p_punched_by_manager_id`":null}" },
  @{ n = "employee_get_my_punches"; b = "{`"p_company_id`":`"$dummy`",`"p_employee_id`":`"$emp`",`"p_from`":`"2026-05-01`",`"p_to`":`"2026-05-28`"}" },
  @{ n = "employee_get_last_punch"; b = "{`"p_employee_id`":`"$emp`"}" },
  @{ n = "employee_get_jobs_for_employee"; b = "{`"p_company_id`":`"$dummy`",`"p_employee_id`":`"$emp`"}" },
  @{ n = "employee_get_message_threads_for_worker"; b = "{`"p_company_id`":`"$dummy`",`"p_employee_id`":`"$emp`"}" },
  @{ n = "employee_get_inventory_items"; b = "{`"p_company_id`":`"$dummy`"}" },
  @{ n = "employee_get_leave_requests"; b = "{`"p_company_id`":`"$dummy`",`"p_employee_id`":`"$emp`"}" },
  @{ n = "employee_get_pa_tasks"; b = "{`"p_company_id`":`"$dummy`",`"p_employee_id`":`"$emp`"}" }
)

foreach ($rpc in $rpcs) {
  try {
    $r = Invoke-WebRequest -Uri "$base/rest/v1/rpc/$($rpc.n)" -Headers $headers -Method POST -Body $rpc.b -UseBasicParsing
    Log "RPC OK  $($rpc.n) $($r.StatusCode)"
  } catch {
    $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
    $body = $reader.ReadToEnd()
    if ($body -match '"code":"([^"]+)"') { $c = $matches[1] } else { $c = $_.Exception.Response.StatusCode.value__ }
    Log "RPC $($rpc.n) => $c :: $($body.Substring(0,[Math]::Min(180,$body.Length)))"
  }
}

Log "=== end ==="
Write-Host "Wrote $log"
