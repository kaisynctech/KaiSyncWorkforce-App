using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class EmployeeContractorAdminPage : ContentPage
{
    private readonly EmployeeContractorAdminViewModel _vm;

    public EmployeeContractorAdminPage(EmployeeContractorAdminViewModel vm)
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
