using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class HrRegisterVerifyCodePage : ContentPage
{
    public HrRegisterVerifyCodePage(HrRegisterVerifyCodeViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
