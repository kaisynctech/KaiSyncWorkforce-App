using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class EmployeeRegistrationStatusPage : ContentPage
{
    public EmployeeRegistrationStatusPage(EmployeeRegistrationStatusViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
