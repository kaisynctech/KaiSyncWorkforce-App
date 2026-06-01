using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrEmployeesPage : ContentPage
{
    private readonly HrEmployeesViewModel _vm;

    public HrEmployeesPage(HrEmployeesViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        _vm.SubscribeRealtime();
        await _vm.LoadAsync();
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        _vm.UnsubscribeRealtime();
    }
}
