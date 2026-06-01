using KaiFlow.Timesheets.ViewModels.Finance;

namespace KaiFlow.Timesheets.Views.Finance;

public partial class FinanceVatPage : ContentPage
{
    private readonly FinanceVatViewModel _vm;

    public FinanceVatPage(FinanceVatViewModel vm)
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
