using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class MyPaSectionPage : ContentPage
{
    private readonly MyPaSectionViewModel _vm;

    public MyPaSectionPage(MyPaSectionViewModel vm)
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
