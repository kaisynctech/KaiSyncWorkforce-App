using KaiFlow.Timesheets.Controls;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Models.Reporting;

namespace KaiFlow.Timesheets.Services.Reporting;

public interface IExecutiveAnalyticsService
{
    Task<ExecutiveSnapshot> BuildAsync(
        Guid companyId,
        ReportFilterCriteria filter,
        int offlineQueueCount,
        string realtimeStatus,
        CancellationToken cancellationToken = default);
}

public sealed class ExecutiveAnalyticsService : IExecutiveAnalyticsService
{
    private static readonly string[] Palette =
        ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6"];

    private readonly IStorageService _storage;

    public ExecutiveAnalyticsService(IStorageService storage) => _storage = storage;

    public Task<ExecutiveSnapshot> BuildAsync(
        Guid companyId,
        ReportFilterCriteria filter,
        int offlineQueueCount,
        string realtimeStatus,
        CancellationToken cancellationToken = default) =>
        Task.Run(async () =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            var monthStart = new DateOnly(DateTime.Today.Year, DateTime.Today.Month, 1);
            var today = DateOnly.FromDateTime(DateTime.Today);

            var financeTask = _storage.GetFinanceDashboardSnapshotAsync(companyId, monthStart, today);
            var employeesTask = _storage.GetEmployeesAsync(companyId);
            var jobsTask = _storage.GetJobsAsync(companyId);
            var incidentsTask = _storage.GetIncidentsAsync(companyId);
            var inventoryTask = _storage.GetInventoryItemsAsync(companyId);
            var usageTask = _storage.GetInventoryUsageAsync(companyId);
            var punchesTask = _storage.GetPunchesAsync(companyId, filter.From, filter.To, filter.EmployeeId);
            var leaveTask = _storage.GetLeaveRequestsAsync(companyId, filter.EmployeeId);
            var paymentsTask = _storage.GetPaymentsAsync(companyId);
            var dealsTask = _storage.GetClientDealsAsync(companyId);
            var sitesTask = _storage.GetSitesAsync(companyId);
            var contractorsTask = _storage.GetContractorsAsync(companyId);
            var eventsTask = _storage.GetAppEventsAsync(companyId, DateTime.UtcNow.AddDays(-7), DateTime.UtcNow);
            var templatesTask = _storage.GetShiftTemplatesAsync(companyId);

            await Task.WhenAll(
                financeTask, employeesTask, jobsTask, incidentsTask, inventoryTask, usageTask,
                punchesTask, leaveTask, paymentsTask, dealsTask, sitesTask, contractorsTask,
                eventsTask, templatesTask);

            var finance = await financeTask;
            var employees = await employeesTask;
            var jobs = await jobsTask;
            var incidents = await incidentsTask;
            var inventory = await inventoryTask;
            var usage = await usageTask;
            var punches = await punchesTask;
            var leave = await leaveTask;
            var payments = await paymentsTask;
            var deals = await dealsTask;
            var sites = await sitesTask;
            var contractors = await contractorsTask;
            var events = await eventsTask;
            var templates = await templatesTask;

            var defaultTemplate = templates.FirstOrDefault(t => t.IsDefault) ?? templates.FirstOrDefault();
            var templateMap = employees
                .Where(e => e.ShiftTemplateId.HasValue)
                .ToDictionary(e => e.Id, e => templates.FirstOrDefault(t => t.Id == e.ShiftTemplateId) ?? defaultTemplate);

            var todayPunches = punches.Where(p => p.PunchType == PunchType.In && p.DateTime.Date == DateTime.Today).ToList();
            var presentIds = todayPunches.Select(p => p.EmployeeId).Distinct().ToHashSet();
            var onLeaveToday = leave.Count(l => l.IsApproved && l.StartDate <= today && l.EndDate >= today);

            var lateCount = 0;
            if (defaultTemplate is not null)
            {
                foreach (var grp in todayPunches.GroupBy(p => p.EmployeeId))
                {
                    var firstIn = grp.Min(p => p.DateTime);
                    var tmpl = templateMap.GetValueOrDefault(grp.Key) ?? defaultTemplate;
                    var expected = DateTime.Today.Add(tmpl!.StartTime.ToTimeSpan()).AddMinutes(5);
                    if (firstIn > expected) lateCount++;
                }
            }

            var windowPayments = payments.Where(p => p.PeriodEnd >= filter.From && p.PeriodStart <= filter.To).ToList();
            var otHours = windowPayments.Sum(p => p.OvertimeHours);

            var completedJobs = jobs.Count(j => j.Status == JobStatus.Completed);
            var totalJobs = jobs.Count(j => j.Status != JobStatus.Cancelled);
            var completionRate = totalJobs > 0 ? (double)completedJobs / totalJobs * 100 : 0;

            var projectProfit = deals
                .Where(d => d.OfferAmount > 0)
                .Select(d => d.OfferAmount - jobs.Where(j => j.ClientId == d.ClientId).Sum(j => (double)j.ActualCost))
                .DefaultIfEmpty(0)
                .Average();

            var activeContractors = contractors.Count(c => c.IsActive);
            var contractorJobs = jobs.Count(j => j.ContractorId.HasValue && j.IsOpen);

            var windowUsage = usage.Where(u => u.UsedAt >= filter.From.ToDateTime(TimeOnly.MinValue)
                && u.UsedAt <= filter.To.ToDateTime(TimeOnly.MaxValue)).ToList();

            var eventCount = events.Count;
            var errorCount = events.Count(e => e.Level == "error");
            var errorRate = eventCount > 0 ? (double)errorCount / eventCount * 100 : 0;
            var activeUsers = events.Where(e => e.AuthUserId.HasValue).Select(e => e.AuthUserId!.Value).Distinct().Count();
            var modules = events.Select(e => e.Screen.Split('/').FirstOrDefault() ?? e.Screen)
                .Where(m => !string.IsNullOrWhiteSpace(m)).Distinct().Count();

            var attendanceTrend = AnalyticsHelpers.BuildDailyTrend(filter, punches, p => p.PunchType == PunchType.In);
            var revenueTrend = finance.RevenueTrend
                .Select(p => new ChartValue(p.Label, (double)p.Value, Palette[0]))
                .ToList();
            var cashflowTrend = finance.CashflowTrend
                .Select(p => new ChartValue(p.Label, (double)p.Value, Palette[2]))
                .ToList();

            return new ExecutiveSnapshot
            {
                RevenueThisMonth = finance.RevenueDisplay,
                OutstandingInvoices = finance.OutstandingDisplay,
                AccountsReceivable = finance.OutstandingDisplay,
                AccountsPayable = $"R{finance.TotalPayables:N2}",
                PayrollCosts = finance.PayrollDisplay,
                VatDue = finance.VatDueDisplay,
                NetCashflow = finance.NetCashflowDisplay,
                ProfitEstimate = finance.ProfitDisplay,

                Headcount = employees.Count.ToString(),
                EmployeesPresentToday = presentIds.Count.ToString(),
                LateArrivals = lateCount.ToString(),
                LeaveToday = onLeaveToday.ToString(),
                OpenIncidents = incidents.Count(i => !i.IsClosed).ToString(),
                ActiveJobs = jobs.Count(j => j.IsOpen).ToString(),
                OvertimeHours = $"{otHours:N1}h",

                JobCompletionRate = $"{completionRate:N0}%",
                ProjectProfitability = $"R{projectProfit:N0}",
                InventoryUsage = windowUsage.Sum(u => u.QuantityUsed).ToString("N1"),
                ContractorPerformance = activeContractors > 0 ? $"{contractorJobs} active jobs" : "—",
                SiteActivity = $"{sites.Count} sites",
                InventoryValue = $"R{inventory.Sum(i => i.QuantityOnHand * i.UnitCost):N0}",

                ActiveUsers = activeUsers.ToString(),
                OfflineQueueCount = offlineQueueCount.ToString(),
                RealtimeStatus = realtimeStatus,
                ErrorRate = $"{errorRate:N1}%",
                FeatureAdoption = $"{modules} modules",

                AttendanceTrend = attendanceTrend,
                JobsByStatus = jobs.GroupBy(j => j.Status)
                    .OrderByDescending(g => g.Count())
                    .Select((g, i) => new ChartValue(g.Key.ToString(), g.Count(), Palette[i % Palette.Length]))
                    .ToList(),
                RevenueTrend = revenueTrend,
                CashflowTrend = cashflowTrend,
            };
        }, cancellationToken);
}

internal static class AnalyticsHelpers
{
    public static List<ChartValue> BuildDailyTrend(
        ReportFilterCriteria filter,
        IReadOnlyList<TimePunch> punches,
        Func<TimePunch, bool> predicate)
    {
        var days = Math.Min(14, filter.To.DayNumber - filter.From.DayNumber + 1);
        if (days <= 0) days = 7;
        var start = filter.To.AddDays(-days + 1);
        var result = new List<ChartValue>();
        for (var d = 0; d < days; d++)
        {
            var day = start.AddDays(d);
            var dt = day.ToDateTime(TimeOnly.MinValue);
            result.Add(new ChartValue(day.ToString("ddd"),
                punches.Count(p => predicate(p) && p.DateTime.Date == dt.Date)));
        }
        return result;
    }

    public static List<ChartValue> BuildDailyEventTrend(IReadOnlyList<AppEvent> events, int days, Func<AppEvent, bool> predicate)
    {
        var result = new List<ChartValue>();
        for (var d = 0; d < days; d++)
        {
            var day = DateTime.UtcNow.Date.AddDays(-days + 1 + d);
            result.Add(new ChartValue(day.ToString("ddd"),
                events.Count(e => predicate(e) && e.CreatedAt.Date == day)));
        }
        return result;
    }
}
