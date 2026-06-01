using KaiFlow.Timesheets.ViewModels.Finance;

namespace KaiFlow.Timesheets.Views.Finance;

public partial class SupplierInvoicesPage : ContentPage
{
    private readonly SupplierInvoicesViewModel _vm;

    public SupplierInvoicesPage(SupplierInvoicesViewModel vm)
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
