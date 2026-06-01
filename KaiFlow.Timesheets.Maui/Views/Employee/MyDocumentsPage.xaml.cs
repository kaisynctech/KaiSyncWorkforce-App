using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class MyDocumentsPage : ContentPage
{
    private readonly MyDocumentsViewModel _vm;

    public MyDocumentsPage(MyDocumentsViewModel vm)
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
