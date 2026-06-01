using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class EmployeeSelfRegisterPage : ContentPage
{
    public EmployeeSelfRegisterPage(EmployeeSelfRegisterViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
