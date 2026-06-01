using KaiFlow.Timesheets.Controls;
using KaiFlow.Timesheets.ViewModels.Platform;
using Microsoft.Maui.Graphics;

namespace KaiFlow.Timesheets.Views.Platform;

public partial class PlatformDashboardPage : ContentPage
{
    private readonly PlatformDashboardViewModel _vm;
    private readonly LineSeriesDrawable _companyGrowth = new() { LineColor = Color.FromArgb("#3B82F6"), FillArea = true };
    private readonly LineSeriesDrawable _revenue = new() { LineColor = Color.FromArgb("#22C55E"), FillArea = true };
    private readonly LineSeriesDrawable _activeUsers = new() { LineColor = Color.FromArgb("#8B5CF6"), FillArea = true };
    private readonly LineSeriesDrawable _errors = new() { LineColor = Color.FromArgb("#EF4444"), FillArea = true };

    public PlatformDashboardPage(PlatformDashboardViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
        CompanyGrowthChart.Drawable = _companyGrowth;
        RevenueChart.Drawable = _revenue;
        ActiveUsersChart.Drawable = _activeUsers;
        ErrorChart.Drawable = _errors;
        _vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(PlatformDashboardViewModel.Dashboard))
                BindCharts();
        };
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await _vm.LoadAsync();
        BindCharts();
    }

    private void BindCharts()
    {
        var t = _vm.Dashboard.Trends;
        _companyGrowth.Points = t.CompanyGrowth;
        _revenue.Points = t.RevenueGrowth;
        _activeUsers.Points = t.ActiveUsersTrend;
        _errors.Points = t.ErrorTrend;
        CompanyGrowthChart.Invalidate();
        RevenueChart.Invalidate();
        ActiveUsersChart.Invalidate();
        ErrorChart.Invalidate();
    }
}
