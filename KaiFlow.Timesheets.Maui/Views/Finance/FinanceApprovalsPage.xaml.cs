using KaiFlow.Timesheets.ViewModels.Finance;

namespace KaiFlow.Timesheets.Views.Finance;

public partial class FinanceApprovalsPage : ContentPage
{
    private readonly FinanceApprovalsViewModel _vm;

    public FinanceApprovalsPage(FinanceApprovalsViewModel vm)
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
