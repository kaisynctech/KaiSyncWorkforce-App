using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrPayrollSettingsPage : ContentPage
{
    public HrPayrollSettingsPage(HrPayrollSettingsViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (BindingContext is HrPayrollSettingsViewModel vm)
            await vm.LoadAsync();
    }
}
