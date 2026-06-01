using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class FormFillPage : ContentPage
{
    private readonly FormFillViewModel _vm;

    public FormFillPage(FormFillViewModel vm)
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
