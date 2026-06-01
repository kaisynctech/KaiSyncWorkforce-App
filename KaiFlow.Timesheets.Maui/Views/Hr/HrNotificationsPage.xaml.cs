using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrNotificationsPage : ContentPage
{
    private readonly HrNotificationsViewModel _vm;

    public HrNotificationsPage(HrNotificationsViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        _vm.SubscribeAccountRealtime();
        await _vm.LoadAsync();
    }

    protected override void OnDisappearing()
    {
        _vm.UnsubscribeAccountRealtime();
        base.OnDisappearing();
    }
}
