using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrEditEmployeePage : ContentPage
{
    private readonly HrEditEmployeeViewModel _vm;

    public HrEditEmployeePage(HrEditEmployeeViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (!string.IsNullOrWhiteSpace(_vm.EmployeeId))
            await _vm.LoadAsync();
    }
}
