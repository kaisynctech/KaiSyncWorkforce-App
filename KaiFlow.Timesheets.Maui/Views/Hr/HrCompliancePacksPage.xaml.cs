using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrCompliancePacksPage : ContentPage
{
    private readonly HrCompliancePacksViewModel _vm;

    public HrCompliancePacksPage(HrCompliancePacksViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await _vm.LoadAsync();
    }
}
