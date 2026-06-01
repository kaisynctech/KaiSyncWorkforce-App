using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class RoleSelectionPage : ContentPage
{
    public RoleSelectionPage(RoleSelectionViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
