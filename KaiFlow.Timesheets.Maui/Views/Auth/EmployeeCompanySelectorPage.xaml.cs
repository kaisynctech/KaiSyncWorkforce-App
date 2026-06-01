using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class EmployeeCompanySelectorPage : ContentPage
{
    private readonly EmployeeCompanySelectorViewModel _vm;

    public EmployeeCompanySelectorPage(EmployeeCompanySelectorViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        _vm.SubscribeAccountRealtime();
        await _vm.LoadAsync();
    }

    protected override void OnDisappearing()
    {
        _vm.UnsubscribeAccountRealtime();
        base.OnDisappearing();
    }
}
