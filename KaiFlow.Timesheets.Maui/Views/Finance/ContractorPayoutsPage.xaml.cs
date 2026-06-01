using KaiFlow.Timesheets.ViewModels.Finance;

namespace KaiFlow.Timesheets.Views.Finance;

public partial class ContractorPayoutsPage : ContentPage
{
    private readonly ContractorPayoutsViewModel _vm;

    public ContractorPayoutsPage(ContractorPayoutsViewModel vm)
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
