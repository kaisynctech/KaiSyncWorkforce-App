using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class HrRegistrationSuccessPage : ContentPage
{
    public HrRegistrationSuccessPage(HrRegistrationSuccessViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
