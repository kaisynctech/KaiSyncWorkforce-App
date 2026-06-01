using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrWorkTeamsPage : ContentPage
{
    private readonly HrWorkTeamsViewModel _vm;

    public HrWorkTeamsPage(HrWorkTeamsViewModel vm)
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
