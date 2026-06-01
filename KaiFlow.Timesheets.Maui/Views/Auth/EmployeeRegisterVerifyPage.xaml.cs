using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class EmployeeRegisterVerifyPage : ContentPage
{
    public EmployeeRegisterVerifyPage(EmployeeRegisterVerifyViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
