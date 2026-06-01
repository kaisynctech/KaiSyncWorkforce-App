using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrIncidentsPage : ContentPage
{
    private readonly HrIncidentsViewModel _vm;

    public HrIncidentsPage(HrIncidentsViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await _vm.LoadAsync();
    }

    private async void OnShowOpenOnlyTapped(object sender, EventArgs e)
    {
        _vm.ShowOpenOnly = true;
        await _vm.LoadAsync();
    }

    private async void OnShowAllTapped(object sender, EventArgs e)
    {
        _vm.ShowOpenOnly = false;
        await _vm.LoadAsync();
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        if (BindingContext is IDisposable disposable)
            disposable.Dispose();
    }
}
