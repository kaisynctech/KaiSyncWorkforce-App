using KaiFlow.Timesheets.ViewModels.ContractorPortal;

namespace KaiFlow.Timesheets.Views.ContractorPortal;

public partial class ContractorPortalPage : ContentPage
{
    private readonly ContractorPortalViewModel _vm;

    public ContractorPortalPage(ContractorPortalViewModel vm)
    {
        InitializeComponent();
        _vm = vm;
        BindingContext = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await _vm.LoadAsync();
    }
}
