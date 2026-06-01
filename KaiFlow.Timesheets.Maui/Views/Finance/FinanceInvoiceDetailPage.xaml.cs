using KaiFlow.Timesheets.ViewModels.Finance;

namespace KaiFlow.Timesheets.Views.Finance;

public partial class FinanceInvoiceDetailPage : ContentPage
{
    public FinanceInvoiceDetailPage(FinanceInvoiceDetailViewModel vm)
    {
        InitializeComponent();
        BindingContext = vm;
    }
}
