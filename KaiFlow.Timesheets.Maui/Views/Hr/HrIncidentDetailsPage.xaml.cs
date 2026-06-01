using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrIncidentDetailsPage : ContentPage
{
    private readonly HrIncidentDetailsViewModel _vm;

    public HrIncidentDetailsPage(HrIncidentDetailsViewModel vm)
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
