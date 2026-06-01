using KaiFlow.Timesheets.ViewModels.Platform;

namespace KaiFlow.Timesheets.Views.Platform;

public partial class TenantOnboardingPage : ContentPage
{
    private readonly TenantOnboardingViewModel _vm;

    public TenantOnboardingPage(TenantOnboardingViewModel vm)
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
