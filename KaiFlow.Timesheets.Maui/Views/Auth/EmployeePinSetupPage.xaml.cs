using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class EmployeePinSetupPage : ContentPage
{
    public EmployeePinSetupPage(EmployeePinSetupViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
