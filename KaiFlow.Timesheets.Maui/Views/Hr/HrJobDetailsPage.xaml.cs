using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrJobDetailsPage : ContentPage
{
    private readonly HrJobDetailsViewModel _vm;

    public HrJobDetailsPage(HrJobDetailsViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        try
        {
            if (!string.IsNullOrWhiteSpace(_vm.JobId))
                await _vm.LoadAsync();
            else
                _vm.RequestReload();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"HrJobDetailsPage load failed: {ex}");
            await DisplayAlertAsync("Error", "Could not load job details. Please try again.", "OK");
        }
    }
}
