using KaiFlow.Timesheets.Models;

namespace KaiFlow.Timesheets.Helpers;

/// <summary>
/// Company feature-module keys aligned with the Flutter app's <c>enabled_modules</c> JSONB.
/// </summary>
public static class CompanyModules
{
    public const string Ticketing = "ticketing";
    public const string Clients = "clients";
    public const string Inventory = "inventory";
    public const string Suppliers = "suppliers";
    public const string Attendance = "attendance";
    public const string Reports = "reports";
    public const string Scheduling = "scheduling";
    public const string Payroll = "payroll";
    public const string Paperless = "paperless";
    public const string Incidents = "incidents";
    public const string Employees = "employees";
    public const string Contractors = "contractors";
    public const string PropertyManagement = "property_management";
    public const string AssetCompliance = "asset_compliance";
    public const string MyPa = "my_pa";
    public const string Leave = "leave";
    public const string Messaging = "messaging";
    public const string Settings = "settings";

    /// <summary>Legacy C# key — read as fallback for property management.</summary>
    public const string LegacyProperties = "properties";

    public sealed record Spec(string Key, string Title, string Description, bool DefaultIfMissing = true);

    public static IReadOnlyList<Spec> All { get; } =
    [
        new(Ticketing, "Jobs & Projects", "Field jobs and CRM projects."),
        new(Clients, "Clients", "Client register, details, linked projects and payments."),
        new(Inventory, "Inventory", "Inventory register, stock and usage allocation."),
        new(Suppliers, "Suppliers", "Supplier register, procurement links, and inventory sourcing."),
        new(Attendance, "Attendance", "Clock-ins, sessions, and attendance history."),
        new(Reports, "Reports", "Operational, executive, and compliance reporting."),
        new(Scheduling, "Scheduling", "Recurring shift templates and assignments."),
        new(Payroll, "Payments", "Salary, hourly rates, payment approvals."),
        new(Incidents, "Incidents", "Incident reporting, tracking, and resolution.", true),
        new(Paperless, "Paperless Forms", "Custom forms and digital signatures.", false),
        new(Employees, "Employees", "Employee records, assignments, and access controls."),
        new(Contractors, "Contractors", "External service providers with their own scorecard."),
        new(PropertyManagement, "Property Management", "Sites, units, residents, and per-unit reporting."),
        new(AssetCompliance, "Asset Compliance", "Inspection schedules and certificate expiry tracking."),
        new(MyPa, "My PA", "Personal assistant tasks, reminders, and follow-ups."),
        new(Leave, "Leave", "Employee leave applications, approvals, and payroll-ready export."),
        new(Messaging, "Messaging", "In-app team messaging between employees and management."),
        new(Settings, "Settings", "Company profile, module controls, and system preferences."),
    ];

    public static bool IsEnabled(Company? company, string key, bool? defaultIfMissing = null)
    {
        var spec = All.FirstOrDefault(s => s.Key == key);
        var defaultVal = defaultIfMissing ?? spec?.DefaultIfMissing ?? true;

        if (company?.EnabledModules == null || company.EnabledModules.Count == 0)
            return defaultVal;

        if (key == PropertyManagement)
        {
            if (company.EnabledModules.TryGetValue(PropertyManagement, out var pm)) return pm;
            if (company.EnabledModules.TryGetValue(LegacyProperties, out var legacy)) return legacy;
            return defaultVal;
        }

        if (key == Suppliers)
        {
            if (company.EnabledModules.TryGetValue(Suppliers, out var suppliers)) return suppliers;
            if (company.EnabledModules.TryGetValue(Inventory, out var inventory)) return inventory;
            return defaultVal;
        }

        return company.EnabledModules.TryGetValue(key, out var val) ? val : defaultVal;
    }

    /// <summary>Incidents module — enabled by default; legacy companies may only have paperless flag.</summary>
    public static bool IsIncidentsEnabled(Company? company)
    {
        if (company?.EnabledModules is { Count: > 0 } modules)
        {
            if (modules.TryGetValue(Incidents, out var incidents)) return incidents;
            if (modules.TryGetValue(Paperless, out var paperless)) return paperless;
        }
        return IsEnabled(company, Incidents, defaultIfMissing: true);
    }

    public static void SetEnabled(Company company, string key, bool value)
    {
        company.EnabledModules[key] = value;
        if (key == PropertyManagement)
            company.EnabledModules[LegacyProperties] = value;
    }

    public static void ApplyAll(Company company, IEnumerable<(string Key, bool Enabled)> values)
    {
        foreach (var (key, enabled) in values)
            SetEnabled(company, key, enabled);
    }
}
