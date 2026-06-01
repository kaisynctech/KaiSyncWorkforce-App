using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class MyProfileViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _firstName  = "";
    [ObservableProperty] private string _lastName   = "";
    [ObservableProperty] private string _email      = "";
    [ObservableProperty] private string _phone      = "";
    [ObservableProperty] private string _idNumber   = "";
    [ObservableProperty] private string _bankAccount    = "";
    [ObservableProperty] private string _bankName       = "";
    [ObservableProperty] private string _bankBranchCode = "";
    [ObservableProperty] private string _position    = "";
    [ObservableProperty] private string _employmentType = "";
    [ObservableProperty] private bool   _isSaved;

    public string BankingScopeLabel =>
        $"Banking details for {_state.CurrentCompany?.Name ?? "this company"}";

    public MyProfileViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "My Profile";
    }

    public async Task LoadAsync()
    {
        var emp = _state.CurrentEmployee;
        if (emp == null) return;

        var full = await _storage.GetEmployeeForCompanyAsync(emp.CompanyId);
        if (full != null)
        {
            _state.SetEmployee(full);
            emp = full;
        }

        ApplyEmployee(emp);
        OnPropertyChanged(nameof(BankingScopeLabel));
    }

    private void ApplyEmployee(Employee emp)
    {
        FirstName       = emp.Name;
        LastName        = emp.Surname;
        Email           = emp.Email ?? "";
        Phone           = emp.Phone ?? "";
        IdNumber        = emp.IdNumber ?? "";
        BankAccount     = emp.BankAccount ?? "";
        BankName        = emp.BankName ?? "";
        BankBranchCode  = emp.BankBranchCode ?? "";
        Position        = emp.Position ?? "";
        EmploymentType  = emp.EmploymentTypeDisplay;
        IsSaved = false;
    }

    [RelayCommand]
    private async Task SaveAsync()
    {
        var emp = _state.CurrentEmployee;
        if (emp == null) return;

        await RunAsync(async () =>
        {
            var updated = await _storage.UpdateMyProfileAsync(
                emp.Id, emp.CompanyId,
                string.IsNullOrWhiteSpace(FirstName)       ? null : FirstName.Trim(),
                string.IsNullOrWhiteSpace(LastName)        ? null : LastName.Trim(),
                string.IsNullOrWhiteSpace(Phone)           ? null : Phone.Trim(),
                string.IsNullOrWhiteSpace(IdNumber)        ? null : IdNumber.Trim(),
                string.IsNullOrWhiteSpace(BankAccount)     ? null : BankAccount.Trim(),
                string.IsNullOrWhiteSpace(BankName)        ? null : BankName.Trim(),
                string.IsNullOrWhiteSpace(BankBranchCode)  ? null : BankBranchCode.Trim());

            if (updated != null)
            {
                _state.SetEmployee(updated);
                ApplyEmployee(updated);
            }

            IsSaved = true;
            await Shell.Current.DisplayAlert("Saved", "Your profile has been updated.", "OK");
        });
    }
}
