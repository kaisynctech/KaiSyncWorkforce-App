using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class EmployeeJobRequestPage : ContentPage
{
    private readonly EmployeeJobRequestViewModel _vm;

    public EmployeeJobRequestPage(EmployeeJobRequestViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);
        await _vm.LoadAsync();
    }
}
