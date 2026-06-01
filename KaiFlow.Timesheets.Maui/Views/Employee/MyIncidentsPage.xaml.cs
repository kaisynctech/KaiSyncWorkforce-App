using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class MyIncidentsPage : ContentPage
{
    private readonly MyIncidentsViewModel _vm;

    public MyIncidentsPage(MyIncidentsViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await _vm.LoadAsync();
    }

    protected override void OnDisappearing()
    {
        base.OnDisappearing();
        if (BindingContext is IDisposable disposable)
            disposable.Dispose();
    }
}
