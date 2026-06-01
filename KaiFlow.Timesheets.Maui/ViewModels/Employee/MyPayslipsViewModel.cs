using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class MyPayslipsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly IExportService _export;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<PaymentApproval> _payslips = [];

    public MyPayslipsViewModel(IStorageService storage, IExportService export, TimesheetStateService state)
    {
        _storage = storage;
        _export  = export;
        _state   = state;
        Title = "My Payslips";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var list = await _storage.GetMyPayslipsAsync(employee.CompanyId, employee.Id);
            Payslips = new ObservableCollection<PaymentApproval>(list);
        });
    }

    [RelayCommand]
    private async Task DownloadPdfAsync(PaymentApproval payslip)
    {
        var employee = _state.CurrentEmployee;
        if (employee == null) return;

        var companyName = _state.CurrentCompany?.Name ?? "KaiSync";
        var downloadToDevice = await _export.AskExportDeliveryAsync("Payslip PDF");
        if (downloadToDevice == null) return;

        await RunAsync(async () =>
            await _export.ExportPayslipPdfAsync(payslip, employee.FullName, companyName, downloadToDevice: downloadToDevice.Value));
    }
}
