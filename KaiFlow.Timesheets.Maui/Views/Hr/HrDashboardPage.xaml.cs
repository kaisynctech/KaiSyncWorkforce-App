using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrDashboardPage : ContentPage
{
    private readonly HrDashboardViewModel _vm;
    private readonly NavigationStateService _navService;

    public HrDashboardPage(HrDashboardViewModel vm, NavigationStateService navService)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
        _navService = navService;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        // Register tab-swap callback: sidebar GoToXxx tab commands update ActiveTab in-place.
        _navService.SetDashboardTabCallback = tab => _vm.ActiveTab = tab;
        // Do NOT reset ActiveModule here. When returning from a detail page (e.g. contractor
        // edit), ActiveModule still holds the workspace the user came from (e.g. Contractors).
        // ResumeAsync() reads it and restores the correct tab. Only explicit sidebar navigation
        // or Overview tap should update ActiveModule to a different value.
        _vm.SubscribeAccountRealtime();
        await _vm.LoadAsync();
        if (_vm.IsClientsTab)
            await _vm.ReloadClientsAsync();
    }

    protected override void OnDisappearing()
    {
        // Clear the callback so module pages don't accidentally call into a stale reference.
        _navService.SetDashboardTabCallback = null;
        _vm.UnsubscribeAccountRealtime();
        base.OnDisappearing();
    }
}
