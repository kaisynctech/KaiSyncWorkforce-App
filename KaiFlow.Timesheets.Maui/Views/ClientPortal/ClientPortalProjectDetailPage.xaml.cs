using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.ClientPortal;

namespace KaiFlow.Timesheets.Views.ClientPortal;

public partial class ClientPortalProjectDetailPage : ContentPage
{
    private readonly ClientPortalProjectDetailViewModel _vm;

    public ClientPortalProjectDetailPage(ClientPortalProjectDetailViewModel vm)
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
