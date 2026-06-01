using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class EmployeeThreadChatPage : ContentPage
{
    private readonly EmployeeThreadChatViewModel _vm;

    public EmployeeThreadChatPage(EmployeeThreadChatViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await _vm.LoadThreadsAsync();
    }
}
