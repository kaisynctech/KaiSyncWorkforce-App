using KaiFlow.Timesheets.ViewModels.Platform;

namespace KaiFlow.Timesheets.Views.Platform;

public partial class SendFeedbackPage : ContentPage
{
    public SendFeedbackPage(SendFeedbackViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
