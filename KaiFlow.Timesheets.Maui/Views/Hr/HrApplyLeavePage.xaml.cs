using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrApplyLeavePage : ContentPage
{
    public HrApplyLeavePage(HrApplyLeaveViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
