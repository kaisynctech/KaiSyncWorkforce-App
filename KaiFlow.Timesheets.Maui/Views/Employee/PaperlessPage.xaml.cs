using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class PaperlessPage : ContentPage
{
    private readonly PaperlessViewModel _vm;

    public PaperlessPage(PaperlessViewModel vm)
    {
        InitializeComponent();
        _vm = vm;
        BindingContext = vm;
    }

    protected override async void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);
        await _vm.LoadAsync();
    }
}
