using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class EmployeeEmailOtpPage : ContentPage
{
    public EmployeeEmailOtpPage(EmployeeEmailOtpViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
