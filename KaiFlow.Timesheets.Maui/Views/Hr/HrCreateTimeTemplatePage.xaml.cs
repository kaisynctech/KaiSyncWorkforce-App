using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrCreateTimeTemplatePage : ContentPage
{
    private readonly HrCreateTimeTemplateViewModel _vm;

    public HrCreateTimeTemplatePage(HrCreateTimeTemplateViewModel vm)
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
