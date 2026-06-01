using KaiFlow.Timesheets.ViewModels.ContractorPortal;

namespace KaiFlow.Timesheets.Views.ContractorPortal;

public partial class ContractorPortalJobDetailPage : ContentPage
{
    private readonly ContractorPortalJobDetailViewModel _vm;

    public ContractorPortalJobDetailPage(ContractorPortalJobDetailViewModel vm)
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
