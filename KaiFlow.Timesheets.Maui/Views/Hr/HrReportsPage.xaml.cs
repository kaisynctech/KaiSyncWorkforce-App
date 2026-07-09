using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrReportsPage : ContentPage
{
    private readonly HrReportsViewModel _vm;

    public HrReportsPage(HrReportsViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await _vm.LoadAsync();
        // Find the HrReportsView and render its charts
        if (Content is HrReportsView view)
            view.RenderCharts();
    }
}
