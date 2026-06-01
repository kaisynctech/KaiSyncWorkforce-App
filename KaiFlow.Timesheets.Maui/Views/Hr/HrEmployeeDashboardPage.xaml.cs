using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrEmployeeDashboardPage : ContentPage
{
    private readonly HrEmployeeDashboardViewModel _vm;

    public HrEmployeeDashboardPage(HrEmployeeDashboardViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        // QueryProperty may apply after OnAppearing; OnEmployeeIdChanged also calls LoadAsync.
        if (!string.IsNullOrWhiteSpace(_vm.EmployeeId))
            await _vm.LoadAsync();
    }
}
