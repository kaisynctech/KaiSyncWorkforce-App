using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrImportEmployeesPage : ContentPage
{
    public HrImportEmployeesPage(HrImportEmployeesViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (BindingContext is HrImportEmployeesViewModel vm)
            await vm.LoadAsync();
    }
}
