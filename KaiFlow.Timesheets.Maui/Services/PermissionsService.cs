using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Services;

public class PermissionsService : IPermissionsService
{
    private readonly IStorageService _storage;
    private readonly AppTelemetry _telemetry;
    private Dictionary<string, bool> _permissions = new(StringComparer.OrdinalIgnoreCase);
    private Employee? _employee;

    public bool IsLoaded { get; private set; }

    public PermissionsService(IStorageService storage, AppTelemetry telemetry)
    {
        _storage = storage;
        _telemetry = telemetry;
    }

    public async Task RefreshAsync(Guid companyId, Employee employee)
    {
        _employee = employee;
        IsLoaded = false;

        // Owner short-circuit (preserved): owners always get everything.
        if (employee.AccessLevel == AccessLevel.Owner)
        {
            _permissions = new Dictionary<string, bool>(
                PermissionDefaults.ForAccessLevel("owner"),
                StringComparer.OrdinalIgnoreCase);
            IsLoaded = true;
            return;
        }

        // Always start from the client-side fallback for this access level. This is the
        // anti-lockout baseline: a permission key the server omits (e.g. a newer key, or
        // a drifted/absent company_role_permissions table — risk C2) keeps its role-default
        // instead of silently resolving to "denied".
        var fallback = new Dictionary<string, bool>(
            PermissionDefaults.ForAccessLevel(employee.AccessLevelRaw),
            StringComparer.OrdinalIgnoreCase);

        Dictionary<string, bool>? fromDb = null;
        try
        {
            var db = await _storage.GetMyPermissionsAsync(companyId);
            if (db.Count > 0) fromDb = db;
        }
        catch (Exception ex)
        {
            _telemetry.LogWarning("permissions db load failed", nameof(RefreshAsync),
                new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["access_level"] = employee.AccessLevelRaw ?? "",
                    ["error"] = ex.Message,
                });
        }

        if (fromDb == null)
        {
            // No server permissions available → fallback only (documented drift path).
            _permissions = fallback;
            IsLoaded = true;
            _telemetry.LogEvent("permissions_fallback_used", new Dictionary<string, string>
            {
                ["company_id"] = companyId.ToString(),
                ["access_level"] = employee.AccessLevelRaw ?? "",
                ["reason"] = "db_empty_or_missing",
                ["fallback_keys"] = fallback.Count.ToString(),
            });
            return;
        }

        // Safer merge: fallback baseline, server overlays on top (server wins where it has
        // an explicit value). Keys the server omits retain the role default → no lockout.
        var merged = new Dictionary<string, bool>(fallback, StringComparer.OrdinalIgnoreCase);
        var mismatches = 0;
        var dbOnly = 0;
        foreach (var kv in fromDb)
        {
            if (merged.TryGetValue(kv.Key, out var def))
            {
                if (def != kv.Value) mismatches++;
            }
            else
            {
                dbOnly++;
            }
            merged[kv.Key] = kv.Value;
        }
        var dbMissing = fallback.Keys.Count(k => !fromDb.ContainsKey(k));

        _permissions = merged;
        IsLoaded = true;

        // Surface drift so it can be reconciled server-side without locking anyone out.
        if (mismatches > 0 || dbMissing > 0 || dbOnly > 0)
        {
            _telemetry.LogWarning("permissions_drift_detected", nameof(RefreshAsync),
                new Dictionary<string, string>
                {
                    ["company_id"] = companyId.ToString(),
                    ["access_level"] = employee.AccessLevelRaw ?? "",
                    ["mismatches"] = mismatches.ToString(),
                    ["db_missing_keys"] = dbMissing.ToString(),
                    ["db_only_keys"] = dbOnly.ToString(),
                });
        }
    }

    public bool Can(string permissionKey)
    {
        if (_employee?.AccessLevel == AccessLevel.Owner)
            return true;
        return _permissions.TryGetValue(permissionKey, out var allowed) && allowed;
    }

    public bool CanPunch(Employee e) => true;

    public bool CanManageEmployees(Employee e) =>
        Can(PermissionKeys.EmployeesCreate) || Can(PermissionKeys.EmployeesEdit);

    public bool CanApprovePayments(Employee e) => Can(PermissionKeys.PaymentsApprove);

    public bool CanViewReports(Employee e) =>
        Can(PermissionKeys.ReportsViewOperational) || Can(PermissionKeys.ReportsViewFinancial);

    public bool CanManageJobs(Employee e) =>
        Can(PermissionKeys.JobsCreate) || Can(PermissionKeys.JobsEdit);

    public bool CanManageClients(Employee e) => Can(PermissionKeys.ClientsEdit);

    public bool CanManageInventory(Employee e) => Can(PermissionKeys.InventoryEdit);

    public bool CanViewSuppliers(Employee e) =>
        Can(PermissionKeys.SuppliersView) || Can(PermissionKeys.InventoryView);

    public bool CanManageContractors(Employee e) =>
        Can(PermissionKeys.ContractorsCreate) || Can(PermissionKeys.ContractorsEdit);

    public bool CanAccessSettings(Employee e) => Can(PermissionKeys.SettingsView);
}
