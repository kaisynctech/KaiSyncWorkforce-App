using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrSettingsPage : ContentPage
{
    private readonly HrSettingsViewModel _vm;

    public HrSettingsPage(HrSettingsViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await _vm.LoadAsync();
    }
}
