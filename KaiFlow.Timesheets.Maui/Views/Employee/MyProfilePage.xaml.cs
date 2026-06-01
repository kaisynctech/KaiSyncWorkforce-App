using KaiFlow.Timesheets.ViewModels.Employees;

namespace KaiFlow.Timesheets.Views.Employee;

public partial class MyProfilePage : ContentPage
{
    private readonly MyProfileViewModel _vm;

    public MyProfilePage(MyProfileViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        try
        {
            await _vm.LoadAsync();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"MyProfilePage load failed: {ex}");
            await DisplayAlert("Error", "Could not load your profile. Please try again.", "OK");
        }
    }
}
