using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrContractorDetailsPage : ContentPage
{
    private readonly HrContractorDetailsViewModel _vm;

    public HrContractorDetailsPage(HrContractorDetailsViewModel vm)
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
