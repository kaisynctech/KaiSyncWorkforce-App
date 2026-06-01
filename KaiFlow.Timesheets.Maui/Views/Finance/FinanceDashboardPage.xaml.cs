using System.ComponentModel;
using KaiFlow.Timesheets.Controls;
using KaiFlow.Timesheets.ViewModels.Finance;

namespace KaiFlow.Timesheets.Views.Finance;

public partial class FinanceDashboardPage : ContentPage
{
    private readonly FinanceDashboardViewModel _vm;

    private readonly BarSeriesDrawable _revenue = new() { PrimaryColor = Microsoft.Maui.Graphics.Color.FromArgb("#3B82F6") };
    private readonly BarSeriesDrawable _cashflow = new() { Grouped = true, PrimaryColor = Microsoft.Maui.Graphics.Color.FromArgb("#16A34A"), SecondaryColor = Microsoft.Maui.Graphics.Color.FromArgb("#DC2626") };
    private readonly BarSeriesDrawable _vat = new() { PrimaryColor = Microsoft.Maui.Graphics.Color.FromArgb("#8B5CF6") };
    private readonly CategoryBarsDrawable _expenses = new();
    private readonly CategoryBarsDrawable _debtors = new();

    public FinanceDashboardPage(FinanceDashboardViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;

        RevenueChart.Drawable = _revenue;
        CashflowChart.Drawable = _cashflow;
        VatChart.Drawable = _vat;
        ExpenseChart.Drawable = _expenses;
        DebtorsChart.Drawable = _debtors;

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
        if (e.PropertyName == nameof(FinanceDashboardViewModel.Snapshot))
            RenderCharts();
    }

    private void RenderCharts()
    {
        var s = _vm.Snapshot;
        _revenue.Points = s.RevenueTrend;
        _cashflow.Points = s.CashflowTrend;
        _vat.Points = s.VatTrend;
        _expenses.Slices = s.ExpenseCategories;
        _debtors.Slices = s.TopDebtors;

        RevenueChart.Invalidate();
        CashflowChart.Invalidate();
        VatChart.Invalidate();
        ExpenseChart.Invalidate();
        DebtorsChart.Invalidate();
    }
}
