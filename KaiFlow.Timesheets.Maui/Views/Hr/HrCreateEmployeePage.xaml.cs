using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrCreateEmployeePage : ContentPage
{
    private readonly HrCreateEmployeeViewModel _vm;

    public HrCreateEmployeePage(HrCreateEmployeeViewModel vm)
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
