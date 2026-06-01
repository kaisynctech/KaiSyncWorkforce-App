using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class HrRegisterPage : ContentPage
{
    public HrRegisterPage(HrRegisterViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
