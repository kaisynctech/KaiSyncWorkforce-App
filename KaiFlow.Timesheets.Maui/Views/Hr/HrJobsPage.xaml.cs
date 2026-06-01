using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrJobsPage : ContentPage
{
    private readonly HrJobsViewModel _vm;

    public HrJobsPage(HrJobsViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        _vm.PrepareAsJobsList();
        await _vm.LoadAsync();
    }
}
