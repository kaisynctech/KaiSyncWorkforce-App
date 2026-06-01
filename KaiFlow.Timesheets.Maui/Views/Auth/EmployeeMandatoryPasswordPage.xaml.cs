using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class EmployeeMandatoryPasswordPage : ContentPage
{
    public EmployeeMandatoryPasswordPage(EmployeeMandatoryPasswordViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
