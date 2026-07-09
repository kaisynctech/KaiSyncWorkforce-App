# Dependency Security Remediation

**Date:** 2026-06-01

## Before

| Package | Version | Issue |
|---------|---------|-------|
| `System.IO.Packaging` | 8.0.0 | High CVE (GHSA-f32c-w444-8ppv, GHSA-qj66-m88j-hmgj) |
| `Microsoft.Maui.Controls` | 10.0.60 | Current |
| `Supabase` | 1.1.1 | Current |
| `ClosedXML` | 0.102.2 | Transitive dependency on System.IO.Packaging |

## After

| Package | Version | Notes |
|---------|---------|-------|
| `System.IO.Packaging` | **9.0.0** | Direct reference pins patched version for ClosedXML |
| All others | unchanged | No breaking upgrades required |

## Validation

- `dotnet build KaiFlow.Timesheets.Maui.csproj -f net10.0-windows10.0.19041.0` — **0 errors**
- Finance, Payroll, Reporting project references compile transitively

## Rollback

```xml
<PackageReference Include="System.IO.Packaging" Version="8.0.0" />
```

Then `dotnet restore && dotnet build`.

## Residual items (not changed)

- Geoapify key in source — rotate key and move to env (separate task)
- `Newtonsoft.Json` 13.0.3 — no critical CVE at audit time; monitor
