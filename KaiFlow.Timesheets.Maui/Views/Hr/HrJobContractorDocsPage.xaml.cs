using KaiFlow.Timesheets.ViewModels.Hr;

namespace KaiFlow.Timesheets.Views.Hr;

public partial class HrJobContractorDocsPage : ContentPage
{
    private readonly HrJobContractorDocsViewModel _vm;

    public HrJobContractorDocsPage(HrJobContractorDocsViewModel vm)
    {
        InitializeComponent();
        BindingContext = _vm = vm;
    }
}
