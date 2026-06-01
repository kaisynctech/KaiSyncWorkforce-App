using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class EmployeeDashboardPage : ContentPage
{
    private readonly EmployeeDashboardViewModel _vm;

    public EmployeeDashboardPage(EmployeeDashboardViewModel vm)
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
