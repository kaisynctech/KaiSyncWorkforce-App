using KaiFlow.Timesheets.Services;
namespace KaiFlow.Timesheets.Views.Auth;

public partial class HrEmailVerifiedPage : ContentPage
{
    public HrEmailVerifiedPage()
    {
        InitializeComponent();
    }

    private async void OnContinueClicked(object sender, EventArgs e)
    {
        await ShellNavigation.GoToAsync(nameof(HrRegisterCompanyDetailsPage));
    }
}
