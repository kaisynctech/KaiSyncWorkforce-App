using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrProjectDetailPage : ContentPage
{
    private readonly HrProjectDetailViewModel _vm;

    public HrProjectDetailPage(HrProjectDetailViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        _vm.RequestReload();
    }
}
