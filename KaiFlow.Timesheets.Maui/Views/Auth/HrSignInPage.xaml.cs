using KaiFlow.Timesheets.ViewModels.Auth;

namespace KaiFlow.Timesheets.Views.Auth;

public partial class HrSignInPage : ContentPage
{
    public HrSignInPage(HrSignInViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await ((HrSignInViewModel)BindingContext).InitializeAsync();
    }
}
