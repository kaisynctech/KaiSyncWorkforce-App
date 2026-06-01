using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrShiftTemplatesPage : ContentPage
{
    public HrShiftTemplatesPage(HrShiftTemplatesViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await ((HrShiftTemplatesViewModel)BindingContext).LoadAsync();
    }
}
