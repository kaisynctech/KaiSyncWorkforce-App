using KaiFlow.Timesheets.ViewModels.Production;

namespace KaiFlow.Timesheets.Views.Production;

public partial class UpdatePage : ContentPage
{
    private readonly UpdateViewModel _vm;

    public UpdatePage(UpdateViewModel vm)
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
