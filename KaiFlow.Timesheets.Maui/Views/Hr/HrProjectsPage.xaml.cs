using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrProjectsPage : ContentPage
{
    private readonly HrJobsViewModel _vm;

    public HrProjectsPage(HrJobsViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        _vm.PrepareAsProjectsList();
        await _vm.LoadAsync();
    }
}
