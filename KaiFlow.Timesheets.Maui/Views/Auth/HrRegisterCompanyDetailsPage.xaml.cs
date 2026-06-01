using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class HrRegisterCompanyDetailsPage : ContentPage
{
    public HrRegisterCompanyDetailsPage(HrRegisterCompanyDetailsViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }

    private void OnOwnerRoleClicked(object sender, EventArgs e)
        => ((HrRegisterCompanyDetailsViewModel)BindingContext).IsOwner = true;

    private void OnHrAdminRoleClicked(object sender, EventArgs e)
        => ((HrRegisterCompanyDetailsViewModel)BindingContext).IsHrAdmin = true;
}
