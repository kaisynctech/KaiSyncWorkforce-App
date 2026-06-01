using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class EmployeeLoginPage : ContentPage
{
    public EmployeeLoginPage(EmployeeLoginViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await ((EmployeeLoginViewModel)BindingContext).InitializeAsync();
    }
}
