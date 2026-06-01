using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrDashboardPage : ContentPage
{
    private readonly HrDashboardViewModel _vm;

    public HrDashboardPage(HrDashboardViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        _vm.SubscribeAccountRealtime();
        await _vm.LoadAsync();
        if (_vm.IsClientsTab)
            await _vm.ReloadClientsAsync();
    }

    protected override void OnDisappearing()
    {
        _vm.UnsubscribeAccountRealtime();
        base.OnDisappearing();
    }
}
