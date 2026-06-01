using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.ClientPortal;

namespace KaiFlow.Timesheets.Views.ClientPortal;

public partial class ClientPortalPage : ContentPage
{
    private readonly ClientPortalViewModel _vm;

    public ClientPortalPage(ClientPortalViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (ClientPortalSessionStore.IsSigningOut)
            return;
        await _vm.LoadAsync();
    }
}
