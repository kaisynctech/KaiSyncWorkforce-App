using System.ComponentModel;
using KaiFlow.Timesheets.Controls;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.ViewModels.Hr;
using Microsoft.Maui.Graphics;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrReportsPage : ContentPage
{
    private readonly HrReportsViewModel _vm;

    private readonly LineSeriesDrawable _execRevenue = new() { LineColor = Color.FromArgb("#3B82F6"), FillArea = true };
    private readonly LineSeriesDrawable _execAttendance = new() { LineColor = Color.FromArgb("#22C55E"), FillArea = true };
    private readonly LineSeriesDrawable _finRevenue = new() { LineColor = Color.FromArgb("#3B82F6"), FillArea = true };
    private readonly CategoryBarsDrawable _finSupplier = new();
    private readonly LineSeriesDrawable _payrollTrend = new() { LineColor = Color.FromArgb("#8B5CF6"), FillArea = true };
    private readonly LineSeriesDrawable _workAtt = new() { LineColor = Color.FromArgb("#22C55E"), FillArea = true };
    private readonly DonutChartDrawable _workLeave = new();
    private readonly DonutChartDrawable _opsJobs = new();
    private readonly CategoryBarsDrawable _opsProject = new();
    private readonly CategoryBarsDrawable _incSeverity = new();
    private readonly CategoryBarsDrawable _invTop = new();
    private readonly LineSeriesDrawable _conPayout = new() { LineColor = Color.FromArgb("#F59E0B"), FillArea = true };
    private readonly CategoryBarsDrawable _propOcc = new();
    private readonly CategoryBarsDrawable _telTop = new();
    private readonly LineSeriesDrawable _telError = new() { LineColor = Color.FromArgb("#EF4444"), FillArea = true };

    public HrReportsPage(HrReportsViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;

        ExecRevenueChart.Drawable = _execRevenue;
        ExecAttendanceChart.Drawable = _execAttendance;
        FinRevenueChart.Drawable = _finRevenue;
        FinSupplierChart.Drawable = _finSupplier;
        PayrollTrendChart.Drawable = _payrollTrend;
        WorkforceAttChart.Drawable = _workAtt;
        WorkforceLeaveChart.Drawable = _workLeave;
        OpsJobsChart.Drawable = _opsJobs;
        OpsProjectChart.Drawable = _opsProject;
        IncSeverityChart.Drawable = _incSeverity;
        InvTopChart.Drawable = _invTop;
        ConPayoutChart.Drawable = _conPayout;
        PropOccChart.Drawable = _propOcc;
        TelTopChart.Drawable = _telTop;
        TelErrorChart.Drawable = _telError;

        _vm.PropertyChanged += OnVmPropertyChanged;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await _vm.LoadAsync();
        RenderCharts();
    }

    private void OnVmPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(HrReportsViewModel.ChartRevision))
            RenderCharts();
    }

    private void RenderCharts()
    {
        _execRevenue.Points = _vm.Executive.RevenueTrend;
        _execAttendance.Points = _vm.Executive.AttendanceTrend;

        _finRevenue.Points = _vm.FinancialSnapshot.RevenueTrend;
        _finSupplier.Slices = ToSlices(_vm.FinancialSnapshot.SupplierSpend);

        _payrollTrend.Points = _vm.PayrollSnapshot.PayrollTrend;

        _workAtt.Points = _vm.WorkforceSnapshot.AttendanceTrend;
        BindDonut(_workLeave, _vm.WorkforceSnapshot.LeaveByType, "days");

        BindDonut(_opsJobs, _vm.OperationalSnapshot.JobsByStatus, "jobs");
        _opsProject.Slices = ToSlices(_vm.OperationalSnapshot.ProjectTimeline);

        _incSeverity.Slices = ToSlices(_vm.IncidentsSnapshot.BySeverity);
        _invTop.Slices = ToSlices(_vm.InventorySnapshot.TopConsumed);

        _conPayout.Points = _vm.ContractorsSnapshot.PayoutTrend;
        _propOcc.Slices = ToSlices(_vm.PropertySnapshot.SiteOccupancy);

        _telTop.Slices = ToSlices(_vm.TelemetrySnapshot.TopEvents);
        _telError.Points = _vm.TelemetrySnapshot.ErrorTrend;

        InvalidateAll();
    }

    private static void BindDonut(DonutChartDrawable chart, IReadOnlyList<ChartValue> slices, string sub)
    {
        chart.Slices = slices;
        var total = slices.Sum(s => s.Value);
        chart.CenterText = ((int)total).ToString();
        chart.CenterSubText = sub;
    }

    private static List<FinanceCategorySlice> ToSlices(IReadOnlyList<ChartValue> values) =>
        values.Select(v => new FinanceCategorySlice
        {
            Label = v.Label,
            Value = (decimal)v.Value,
            Color = v.ColorHex ?? "#3B82F6",
        }).ToList();

    private void InvalidateAll()
    {
        ExecRevenueChart.Invalidate();
        ExecAttendanceChart.Invalidate();
        FinRevenueChart.Invalidate();
        FinSupplierChart.Invalidate();
        PayrollTrendChart.Invalidate();
        WorkforceAttChart.Invalidate();
        WorkforceLeaveChart.Invalidate();
        OpsJobsChart.Invalidate();
        OpsProjectChart.Invalidate();
        IncSeverityChart.Invalidate();
        InvTopChart.Invalidate();
        ConPayoutChart.Invalidate();
        PropOccChart.Invalidate();
        TelTopChart.Invalidate();
        TelErrorChart.Invalidate();
    }
}
