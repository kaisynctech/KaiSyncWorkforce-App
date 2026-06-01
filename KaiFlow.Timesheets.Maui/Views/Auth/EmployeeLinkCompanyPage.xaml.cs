using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class EmployeeLinkCompanyPage : ContentPage
{
    public EmployeeLinkCompanyPage(EmployeeLinkCompanyViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
