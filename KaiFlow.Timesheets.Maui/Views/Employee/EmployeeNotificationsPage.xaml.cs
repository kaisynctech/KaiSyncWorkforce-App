using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class EmployeeNotificationsPage : ContentPage
{
    private readonly EmployeeNotificationsViewModel _vm;

    public EmployeeNotificationsPage(EmployeeNotificationsViewModel vm)
    {
        InitializeComponent();
        _vm = vm;
        BindingContext = vm;
    }

    protected override async void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);
        _vm.SubscribeAccountRealtime();
        await _vm.LoadAsync();
    }

    protected override void OnNavigatedFrom(NavigatedFromEventArgs args)
    {
        _vm.UnsubscribeAccountRealtime();
        base.OnNavigatedFrom(args);
    }
}
