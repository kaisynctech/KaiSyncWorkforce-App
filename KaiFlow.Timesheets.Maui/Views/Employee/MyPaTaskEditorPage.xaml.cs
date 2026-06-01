using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class MyPaTaskEditorPage : ContentPage
{
    private readonly MyPaTaskEditorViewModel _vm;

    public MyPaTaskEditorPage(MyPaTaskEditorViewModel vm)
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
