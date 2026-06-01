using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Platform;
using KaiFlow.Timesheets.ViewModels.Base;

namespace KaiFlow.Timesheets.ViewModels.Platform;

public partial class SendFeedbackViewModel : BaseViewModel
{
    private readonly IFeedbackService _feedback;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _category = "Suggestion";
    [ObservableProperty] private string _message = "";
    [ObservableProperty] private string _priority = "normal";

    public IList<string> Categories { get; } = ["Bug", "Suggestion", "Feature Request", "Support"];

    public SendFeedbackViewModel(IFeedbackService feedback, TimesheetStateService state)
    {
        _feedback = feedback;
        _state = state;
        Title = "Send Feedback";
    }

    [RelayCommand]
    private async Task SubmitAsync()
    {
        if (string.IsNullOrWhiteSpace(Message))
        {
            ErrorMessage = "Please enter your feedback message.";
            return;
        }

        var companyId = _state.CurrentCompany?.Id ?? _state.CurrentEmployee?.CompanyId;
        if (!companyId.HasValue)
        {
            ErrorMessage = "Company context required.";
            return;
        }

        await RunAsync(async () =>
        {
            await _feedback.SubmitFeedbackAsync(companyId.Value, Category, Message.Trim(), Priority);
            await Shell.Current.DisplayAlert("Thank you", "Your feedback has been sent to the KaiFlow team.", "OK");
            await ShellNavigation.GoBackOrDashboardAsync();
        });
    }
}
