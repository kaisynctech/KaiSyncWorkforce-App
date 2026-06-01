using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrSimpleThreadChatPage : ContentPage
{
    private readonly HrSimpleThreadChatViewModel _vm;

    public HrSimpleThreadChatPage(HrSimpleThreadChatViewModel vm)
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
