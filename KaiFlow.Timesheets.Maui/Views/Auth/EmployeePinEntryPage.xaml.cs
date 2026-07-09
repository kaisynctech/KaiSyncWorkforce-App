using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class EmployeePinEntryPage : ContentPage
{
    public EmployeePinEntryPage(EmployeePinEntryViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }

    protected override async void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);
        await ((EmployeePinEntryViewModel)BindingContext).LoadStoredCredentialsAsync();
    }
}
