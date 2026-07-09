using KaiFlow.Timesheets.Controls;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Models.Reporting;

namespace KaiFlow.Timesheets.Services.Reporting;

public interface IFinancialAnalyticsService
{
    Task<FinancialAnalyticsSnapshot> BuildAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default);
}

public sealed class FinancialAnalyticsService : IFinancialAnalyticsService
{
    private static readonly string[] Palette = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6"];

    private readonly IStorageService _storage;

    public FinancialAnalyticsService(IStorageService storage) => _storage = storage;

    public Task<FinancialAnalyticsSnapshot> BuildAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default) =>
        Task.Run(async () =>
        {
            ct.ThrowIfCancellationRequested();
            var dashboard = await _storage.GetFinanceDashboardSnapshotAsync(companyId, filter.From, filter.To);
            var pnl = await _storage.BuildFinanceReportAsync(companyId, "pnl", filter.From, filter.To);
            var cashflow = await _storage.BuildFinanceReportAsync(companyId, "cashflow", filter.From, filter.To);
            var vat = await _storage.BuildFinanceReportAsync(companyId, "vat", filter.From, filter.To);
            var ar = await _storage.BuildFinanceReportAsync(companyId, "ar_aging", filter.From, filter.To);
            var ap = await _storage.BuildFinanceReportAsync(companyId, "ap", filter.From, filter.To);

            var supplier = await _storage.GetSupplierInvoicesAsync(companyId);
            var payouts = await _storage.GetContractorPayoutsAsync(companyId);
            var contractors = await _storage.GetContractorsAsync(companyId);
            bool In(DateOnly d) => d >= filter.From && d <= filter.To;

            var supplierSpend = supplier
                .Where(s => s.StatusRaw != "cancelled" && s.DueDate.HasValue && In(s.DueDate.Value))
                .GroupBy(s => s.SupplierId?.ToString()[..8] ?? "Unknown")
                .OrderByDescending(g => g.Sum(x => x.Subtotal))
                .Take(6)
                .Select((g, i) => new ChartValue(g.Key, (double)g.Sum(x => x.Subtotal), Palette[i % Palette.Length]))
                .ToList();

            var contractorMap = contractors.ToDictionary(c => c.Id, c => c.Name);
            var contractorSpend = payouts
                .Where(p => p.PayoutDate.HasValue && In(p.PayoutDate.Value))
                .GroupBy(p => p.ContractorId.HasValue ? contractorMap.GetValueOrDefault(p.ContractorId.Value, "Contractor") : "Unknown")
                .OrderByDescending(g => g.Sum(x => x.Subtotal))
                .Take(6)
                .Select((g, i) => new ChartValue(g.Key, (double)g.Sum(x => x.Subtotal), Palette[i % Palette.Length]))
                .ToList();

            return new FinancialAnalyticsSnapshot
            {
                Dashboard = dashboard,
                ProfitAndLoss = pnl,
                Cashflow = cashflow,
                VatSummary = vat,
                ArAging = ar,
                ApAging = ap,
                RevenueTrend = dashboard.RevenueTrend.Select(p => new ChartValue(p.Label, (double)p.Value, Palette[0])).ToList(),
                ExpenseTrend = dashboard.ExpenseTrend.Select(p => new ChartValue(p.Label, (double)p.Value, Palette[1])).ToList(),
                SupplierSpend = supplierSpend,
                ContractorSpend = contractorSpend,
            };
        }, ct);
}

public interface IWorkforceAnalyticsService
{
    Task<WorkforceAnalyticsSnapshot> BuildAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default);
}

public sealed class WorkforceAnalyticsService : IWorkforceAnalyticsService
{
    private static readonly string[] Palette = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6"];

    private readonly IStorageService _storage;

    public WorkforceAnalyticsService(IStorageService storage) => _storage = storage;

    public Task<WorkforceAnalyticsSnapshot> BuildAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default) =>
        Task.Run(async () =>
        {
            ct.ThrowIfCancellationRequested();
            var employees = await _storage.GetEmployeesAsync(companyId);
            var punches = await _storage.GetPunchesAsync(companyId, filter.From, filter.To, filter.EmployeeId);
            var leave = await _storage.GetLeaveRequestsAsync(companyId, filter.EmployeeId);
            var absences = await _storage.GetDailyAbsencesRangeAsync(companyId, filter.From, filter.To, filter.EmployeeId);
            var payments = await _storage.GetPaymentsAsync(companyId);
            var templates = await _storage.GetShiftTemplatesAsync(companyId);
            var jobs = await _storage.GetJobsAsync(companyId, filter.EmployeeId);

            var defaultTemplate = templates.FirstOrDefault(t => t.IsDefault) ?? templates.FirstOrDefault();
            var headcount = Math.Max(1, employees.Count);
            var workDays = Math.Max(1, filter.To.DayNumber - filter.From.DayNumber + 1);

            var clockIns = punches.Where(p => p.PunchType == PunchType.In).ToList();
            var uniquePresentDays = clockIns
                .GroupBy(p => (p.EmployeeId, p.DateTime.Date))
                .Count();
            var expectedSlots = headcount * workDays;
            var attendanceRate = expectedSlots > 0 ? (double)uniquePresentDays / expectedSlots * 100 : 0;

            var lateCount = 0;
            if (defaultTemplate is not null)
            {
                var templateMap = employees.ToDictionary(e => e.Id, e =>
                    templates.FirstOrDefault(t => t.Id == e.ShiftTemplateId) ?? defaultTemplate);
                foreach (var grp in clockIns.GroupBy(p => (p.EmployeeId, p.DateTime.Date)))
                {
                    var firstIn = grp.Min(p => p.DateTime);
                    var tmpl = templateMap.GetValueOrDefault(grp.Key.EmployeeId) ?? defaultTemplate;
                    if (firstIn > grp.Key.Date.Add(tmpl!.StartTime.ToTimeSpan()).AddMinutes(5))
                        lateCount++;
                }
            }

            var approvedLeave = leave.Where(l => l.IsApproved && l.EndDate >= filter.From && l.StartDate <= filter.To);
            var leaveDays = approvedLeave.Sum(l => l.TotalDays);

            var windowPayments = payments.Where(p => p.PeriodEnd >= filter.From && p.PeriodStart <= filter.To).ToList();
            var otHours = windowPayments.Sum(p => p.OvertimeHours);

            var absenceDays = absences.Count;
            var absenteeismRate = expectedSlots > 0 ? (double)absenceDays / expectedSlots * 100 : 0;

            var paidHours = defaultTemplate?.PaidHours ?? 8;
            var totalWorked = clockIns.Count * paidHours;
            var capacity = headcount * workDays * paidHours;
            var utilization = capacity > 0 ? totalWorked / capacity * 100 : 0;

            var workload = jobs
                .Where(j => j.IsOpen && j.AssignedEmployeeIds.Count > 0)
                .SelectMany(j => j.AssignedEmployeeIds.Select(eid => (eid, j)))
                .GroupBy(x => x.eid)
                .OrderByDescending(g => g.Count())
                .Take(8)
                .Select((g, i) =>
                {
                    var name = employees.FirstOrDefault(e => e.Id == g.Key)?.FullName ?? g.Key.ToString()[..8];
                    return new ChartValue(name, g.Count(), Palette[i % Palette.Length]);
                })
                .ToList();

            var absenceTrend = new List<ChartValue>();
            var daySpan = Math.Min(14, filter.To.DayNumber - filter.From.DayNumber + 1);
            var trendStart = filter.To.AddDays(-daySpan + 1);
            for (var d = 0; d < daySpan; d++)
            {
                var day = trendStart.AddDays(d);
                absenceTrend.Add(new ChartValue(day.ToString("ddd"),
                    absences.Count(a => a.Date == day)));
            }

            return new WorkforceAnalyticsSnapshot
            {
                AttendanceRate = $"{attendanceRate:N0}%",
                LatenessCount = lateCount.ToString(),
                OvertimeHours = $"{otHours:N1}h",
                LeaveDays = $"{leaveDays:N1}",
                AbsenteeismRate = $"{absenteeismRate:N1}%",
                ShiftUtilization = $"{utilization:N0}%",
                AttendanceTrend = AnalyticsHelpers.BuildDailyTrend(filter, punches, p => p.PunchType == PunchType.In),
                LeaveByType = approvedLeave.GroupBy(l => l.LeaveType)
                    .Select((g, i) => new ChartValue(g.Key, g.Sum(x => x.TotalDays), Palette[i % Palette.Length])).ToList(),
                OvertimeTrend = windowPayments
                    .GroupBy(p => p.PeriodStart.ToString("MMM yy"))
                    .Select((g, i) => new ChartValue(g.Key, g.Sum(x => x.OvertimeHours), Palette[2])).ToList(),
                AbsenteeismTrend = absenceTrend,
                WorkloadByEmployee = workload,
            };
        }, ct);
}

public interface IOperationalAnalyticsService
{
    Task<OperationalAnalyticsSnapshot> BuildAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default);
}

public sealed class OperationalAnalyticsService : IOperationalAnalyticsService
{
    private static readonly string[] Palette = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6"];

    private readonly IStorageService _storage;

    public OperationalAnalyticsService(IStorageService storage) => _storage = storage;

    public Task<OperationalAnalyticsSnapshot> BuildAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default) =>
        Task.Run(async () =>
        {
            ct.ThrowIfCancellationRequested();
            var jobs = await _storage.GetJobsAsync(companyId);
            var incidents = await _storage.GetIncidentsAsync(companyId);
            var usage = await _storage.GetInventoryUsageAsync(companyId);
            var sites = await _storage.GetSitesAsync(companyId);
            var deals = await _storage.GetClientDealsAsync(companyId);
            var contractors = await _storage.GetContractorsAsync(companyId);

            var completed = jobs.Count(j => j.Status == JobStatus.Completed);
            var total = jobs.Count(j => j.Status != JobStatus.Cancelled);
            var completionRate = total > 0 ? (double)completed / total * 100 : 0;

            var openIncidents = incidents.Count(i => !i.IsClosed);
            var slaBreaches = incidents.Count(i => !i.IsClosed && (DateTime.UtcNow - i.CreatedAt).TotalDays > 3);

            var windowUsage = usage.Where(u => u.UsedAt.Date >= filter.From.ToDateTime(TimeOnly.MinValue)
                && u.UsedAt.Date <= filter.To.ToDateTime(TimeOnly.MaxValue)).ToList();

            var onTrack = deals.Count(d => d.ProgressPercent >= 50 || d.StatusRaw is "completed" or "won");
            var projectTotal = Math.Max(1, deals.Count);

            return new OperationalAnalyticsSnapshot
            {
                JobCompletionRate = $"{completionRate:N0}%",
                OpenIncidents = openIncidents.ToString(),
                SlaBreaches = slaBreaches.ToString(),
                InventoryConsumption = windowUsage.Sum(u => u.QuantityUsed).ToString("N1"),
                ActiveSites = sites.Count.ToString(),
                ProjectOnTrack = $"{onTrack}/{projectTotal}",
                JobsByStatus = jobs.GroupBy(j => j.Status)
                    .Select((g, i) => new ChartValue(g.Key.ToString(), g.Count(), Palette[i % Palette.Length])).ToList(),
                IncidentSeverity = incidents.GroupBy(i => i.SeverityRaw)
                    .Select((g, i) => new ChartValue(g.Key, g.Count(), Palette[i % Palette.Length])).ToList(),
                ContractorRatings = contractors.Where(c => c.IsActive).Take(6)
                    .Select((c, i) => new ChartValue(c.Name, jobs.Count(j => j.ContractorId == c.Id), Palette[i % Palette.Length])).ToList(),
                InventoryUsageTrend = windowUsage
                    .GroupBy(u => u.UsedAt.ToString("ddd"))
                    .Select((g, i) => new ChartValue(g.Key, g.Sum(x => x.QuantityUsed), Palette[i % Palette.Length])).ToList(),
                ProjectTimeline = deals.Take(8)
                    .Select((d, i) => new ChartValue(d.Title.Length > 12 ? d.Title[..10] + "…" : d.Title, d.ProgressPercent, Palette[i % Palette.Length])).ToList(),
                SiteActivityHeat = sites.Take(7)
                    .Select((s, i) => new ChartValue(s.Name.Length > 10 ? s.Name[..8] + "…" : s.Name,
                        jobs.Count(j => j.SiteId == s.Id), Palette[i % Palette.Length])).ToList(),
            };
        }, ct);
}

public interface ITelemetryAnalyticsService
{
    Task<TelemetryAnalyticsSnapshot> BuildAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default);
}

public sealed class TelemetryAnalyticsService : ITelemetryAnalyticsService
{
    private static readonly string[] Palette = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6", "#64748B"];

    private readonly IStorageService _storage;

    public TelemetryAnalyticsService(IStorageService storage) => _storage = storage;

    public Task<TelemetryAnalyticsSnapshot> BuildAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default) =>
        Task.Run(async () =>
        {
            ct.ThrowIfCancellationRequested();
            var from = filter.From.ToDateTime(TimeOnly.MinValue);
            var to = filter.To.ToDateTime(TimeOnly.MaxValue);
            var events = await _storage.GetAppEventsAsync(companyId, from, to);

            static bool Contains(AppEvent e, string token) =>
                e.Action.Contains(token, StringComparison.OrdinalIgnoreCase)
                || e.Screen.Contains(token, StringComparison.OrdinalIgnoreCase);

            var logins = events.Count(e => Contains(e, "login") || Contains(e, "sign_in"));
            var modules = events.Select(e => e.Screen.Split('/').FirstOrDefault() ?? e.Screen)
                .Where(s => s.Length > 0).Distinct().Count();
            var offline = events.Count(e => Contains(e, "offline"));
            var realtime = events.Count(e => Contains(e, "realtime"));
            var exports = events.Count(e => Contains(e, "export"));
            var finance = events.Count(e => Contains(e, "finance"));
            var portal = events.Count(e => Contains(e, "portal"));

            return new TelemetryAnalyticsSnapshot
            {
                EventsTotal = events.Count.ToString(),
                ErrorsTotal = events.Count(e => e.Level == "error").ToString(),
                WarningsTotal = events.Count(e => e.Level == "warning").ToString(),
                LoginActivity = logins.ToString(),
                ModuleUsage = modules.ToString(),
                OfflineReplay = offline.ToString(),
                ReconnectEvents = realtime.ToString(),
                ExportUsage = exports.ToString(),
                FinanceActivity = finance.ToString(),
                PortalUsage = portal.ToString(),
                TopEvents = events.GroupBy(e => e.Action).OrderByDescending(g => g.Count()).Take(8)
                    .Select((g, i) => new ChartValue(g.Key.Length > 22 ? g.Key[..20] + "…" : g.Key, g.Count(), Palette[i % Palette.Length])).ToList(),
                ErrorTrend = AnalyticsHelpers.BuildDailyEventTrend(events, 7, e => e.Level == "error"),
                ModuleAdoption = events.GroupBy(e => e.Screen.Split('/').FirstOrDefault() ?? "app").OrderByDescending(g => g.Count()).Take(8)
                    .Select((g, i) => new ChartValue(g.Key, g.Count(), Palette[i % Palette.Length])).ToList(),
                LoginTrend = AnalyticsHelpers.BuildDailyEventTrend(events, 7, e => Contains(e, "login") || Contains(e, "sign_in")),
            };
        }, ct);
}

public interface IDomainAnalyticsService
{
    Task<PayrollAnalyticsSnapshot> BuildPayrollAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default);
    Task<IncidentsAnalyticsSnapshot> BuildIncidentsAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default);
    Task<InventoryAnalyticsSnapshot> BuildInventoryAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default);
    Task<ContractorsAnalyticsSnapshot> BuildContractorsAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default);
    Task<PropertyAnalyticsSnapshot> BuildPropertyAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default);
}

public sealed class DomainAnalyticsService : IDomainAnalyticsService
{
    private static readonly string[] Palette = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6"];

    private readonly IStorageService _storage;

    public DomainAnalyticsService(IStorageService storage) => _storage = storage;

    public Task<PayrollAnalyticsSnapshot> BuildPayrollAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default) =>
        Task.Run(async () =>
        {
            var payments = (await _storage.GetPaymentsAsync(companyId))
                .Where(p => p.PeriodEnd >= filter.From && p.PeriodStart <= filter.To).ToList();
            var gross = payments.Sum(p => p.GrossPay);
            var net = payments.Sum(p => p.NetPay);
            var ot = payments.Sum(p => p.OvertimePay);
            return new PayrollAnalyticsSnapshot
            {
                TotalGross = $"R{gross:N2}",
                TotalNet = $"R{net:N2}",
                OvertimeCost = $"R{ot:N2}",
                EmployeeCount = payments.Select(p => p.EmployeeId).Distinct().Count().ToString(),
                AvgNetPay = payments.Count > 0 ? $"R{net / payments.Count:N2}" : "—",
                PayrollTrend = payments.GroupBy(p => p.PeriodStart.ToString("MMM yy"))
                    .Select((g, i) => new ChartValue(g.Key, g.Sum(x => x.NetPay), Palette[i % Palette.Length])).ToList(),
                PayrollComponents =
                [
                    new ChartStack { Label = "Regular", Segments = [new ChartSegment { Label = "Regular", Value = payments.Sum(p => p.RegularPay), ColorHex = Palette[0] }] },
                    new ChartStack { Label = "OT", Segments = [new ChartSegment { Label = "OT", Value = ot, ColorHex = Palette[2] }] },
                ],
            };
        }, ct);

    public Task<IncidentsAnalyticsSnapshot> BuildIncidentsAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default) =>
        Task.Run(async () =>
        {
            var incidents = (await _storage.GetIncidentsAsync(companyId))
                .Where(i => DateOnly.FromDateTime(i.CreatedAt) >= filter.From && DateOnly.FromDateTime(i.CreatedAt) <= filter.To).ToList();
            var closed = incidents.Where(i => i.IsClosed).ToList();
            var avgDays = closed.Count > 0
                ? closed.Average(i => (i.UpdatedAt - i.CreatedAt).TotalDays)
                : 0;
            return new IncidentsAnalyticsSnapshot
            {
                OpenCount = incidents.Count(i => !i.IsClosed).ToString(),
                ClosedCount = closed.Count.ToString(),
                AvgResolutionDays = $"{avgDays:N1}d",
                BySeverity = incidents.GroupBy(i => i.SeverityRaw)
                    .Select((g, i) => new ChartValue(g.Key, g.Count(), Palette[i % Palette.Length])).ToList(),
                Trend = incidents.GroupBy(i => i.CreatedAt.ToString("MMM"))
                    .Select((g, i) => new ChartValue(g.Key, g.Count(), Palette[i % Palette.Length])).ToList(),
            };
        }, ct);

    public Task<InventoryAnalyticsSnapshot> BuildInventoryAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default) =>
        Task.Run(async () =>
        {
            var items = await _storage.GetInventoryItemsAsync(companyId);
            var itemMap = items.ToDictionary(i => i.Id, i => i.Name);
            var usage = (await _storage.GetInventoryUsageAsync(companyId))
                .Where(u => u.UsedAt >= filter.From.ToDateTime(TimeOnly.MinValue) && u.UsedAt <= filter.To.ToDateTime(TimeOnly.MaxValue)).ToList();
            return new InventoryAnalyticsSnapshot
            {
                TotalValue = $"R{items.Sum(i => i.QuantityOnHand * i.UnitCost):N2}",
                ItemsTracked = items.Count.ToString(),
                UsageEvents = usage.Count.ToString(),
                TopConsumed = usage.GroupBy(u => itemMap.GetValueOrDefault(u.InventoryItemId, "Item")).OrderByDescending(g => g.Sum(x => x.QuantityUsed)).Take(6)
                    .Select((g, i) => new ChartValue(g.Key, g.Sum(x => x.QuantityUsed), Palette[i % Palette.Length])).ToList(),
                ValueByCategory = items.GroupBy(i => i.Supplier ?? "General").OrderByDescending(g => g.Sum(x => x.QuantityOnHand * x.UnitCost)).Take(6)
                    .Select((g, i) => new ChartValue(g.Key, g.Sum(x => x.QuantityOnHand * x.UnitCost), Palette[i % Palette.Length])).ToList(),
            };
        }, ct);

    public Task<ContractorsAnalyticsSnapshot> BuildContractorsAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default) =>
        Task.Run(async () =>
        {
            var contractors    = await _storage.GetContractorsAsync(companyId);
            var allPayouts     = await _storage.GetContractorPayoutsAsync(companyId);
            var allAssignments = await _storage.GetAllJobContractorsAsync(companyId);

            var periodPayouts = allPayouts
                .Where(p => p.PayoutDate.HasValue && p.PayoutDate.Value >= filter.From && p.PayoutDate.Value <= filter.To)
                .ToList();

            var pendingTotal = allPayouts
                .Where(p => p.PayoutStatusRaw is "pending" or "approved")
                .Sum(p => (double)p.NetPayable);

            var jobCountById = allAssignments
                .GroupBy(a => a.ContractorId)
                .ToDictionary(g => g.Key, g => g.Count());

            var performanceTable = contractors
                .Where(c => c.IsActive)
                .OrderBy(c => c.Name)
                .Select(c =>
                {
                    var cp      = allPayouts.Where(p => p.ContractorId == c.Id).ToList();
                    var agreed  = allAssignments.Where(a => a.ContractorId == c.Id).Sum(a => a.AgreedAmount);
                    var paid    = cp.Where(p => p.PayoutStatusRaw == "paid").Sum(p => p.TotalAmount);
                    var pending = cp.Where(p => p.PayoutStatusRaw is "pending" or "approved").Sum(p => p.TotalAmount);
                    var variance = agreed > 0 ? agreed - paid : 0;
                    return new ContractorPerformanceRow
                    {
                        Name           = c.Name,
                        Code           = c.ContractorCode ?? "",
                        JobCount       = jobCountById.TryGetValue(c.Id, out var jc) ? jc : 0,
                        TotalAgreed    = agreed  > 0 ? $"R{agreed:N2}"  : "—",
                        TotalPaid      = paid    > 0 ? $"R{paid:N2}"    : "—",
                        Variance       = agreed  > 0 ? (variance > 0 ? $"Balance R{variance:N2}" : variance < 0 ? $"Over R{Math.Abs(variance):N2}" : "Settled ✓") : "—",
                        VarianceColor  = variance < 0 ? "#EF4444" : variance == 0 && agreed > 0 ? "#22C55E" : "#F59E0B",
                        PendingPayouts = pending > 0 ? $"R{pending:N2}" : "—",
                    };
                })
                .ToList();

            return new ContractorsAnalyticsSnapshot
            {
                ActiveContractors = contractors.Count(c => c.IsActive).ToString(),
                PendingPayouts    = $"R{pendingTotal:N2}",
                TotalPaid         = $"R{periodPayouts.Where(p => p.PayoutStatusRaw == "paid").Sum(p => p.NetPayable):N2}",
                PayoutTrend       = periodPayouts
                    .GroupBy(p => p.PayoutDate!.Value.ToString("MMM"))
                    .Select((g, i) => new ChartValue(g.Key, (double)g.Sum(x => x.NetPayable), Palette[i % Palette.Length]))
                    .ToList(),
                PerformanceScores = contractors.Where(c => c.IsActive).Take(6)
                    .Select((c, i) => new ChartValue(c.Name, allPayouts.Count(p => p.ContractorId == c.Id), Palette[i % Palette.Length]))
                    .ToList(),
                PerformanceTable  = performanceTable,
            };
        }, ct);

    public Task<PropertyAnalyticsSnapshot> BuildPropertyAsync(Guid companyId, ReportFilterCriteria filter, CancellationToken ct = default) =>
        Task.Run(async () =>
        {
            var sites = await _storage.GetSitesAsync(companyId);
            var assets = await _storage.GetAssetsAsync(companyId);
            var unitCount = 0;
            var residentCount = 0;
            var occupancy = new List<ChartValue>();
            var idx = 0;
            foreach (var site in sites.Take(6))
            {
                var units = await _storage.GetUnitsAsync(site.Id);
                var residents = await _storage.GetResidentsAsync(site.Id);
                unitCount += units.Count;
                residentCount += residents.Count;
                var pct = units.Count > 0 ? (double)residents.Count / units.Count * 100 : 0;
                var label = site.Name.Length > 12 ? site.Name[..10] + "…" : site.Name;
                occupancy.Add(new ChartValue(label, pct, Palette[idx++ % Palette.Length]));
            }
            return new PropertyAnalyticsSnapshot
            {
                SiteCount = sites.Count.ToString(),
                UnitCount = unitCount.ToString(),
                ResidentCount = residentCount.ToString(),
                AssetCount = assets.Count.ToString(),
                SiteOccupancy = occupancy,
            };
        }, ct);
}
