using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;

namespace KaiFlow.Timesheets.ViewModels.Base;

public abstract partial class BaseViewModel : ObservableObject
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsNotBusy))]
    private bool _isBusy;

    [ObservableProperty]
    private string? _errorMessage;

    [ObservableProperty]
    private string _title = "";

    public bool IsNotBusy => !IsBusy;

    [RelayCommand]
    public async Task NavigateBackAsync()
        => await ShellNavigation.GoBackOrDashboardAsync();

    [RelayCommand]
    public async Task NavigateToDashboardAsync()
        => await ShellNavigation.GoToMainDashboardAsync();

    protected async Task RunAsync(Func<Task> action, string? busyTitle = null)
    {
        if (IsBusy) return;
        IsBusy = true;
        ErrorMessage = null;
        if (busyTitle != null) Title = busyTitle;
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    protected async Task<T?> RunAsync<T>(Func<Task<T>> action)
    {
        if (IsBusy) return default;
        IsBusy = true;
        ErrorMessage = null;
        try
        {
            return await action();
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
            return default;
        }
        finally
        {
            IsBusy = false;
        }
    }
}
