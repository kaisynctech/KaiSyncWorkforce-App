using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Platform;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrSettingsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;
    private readonly ILocationService _location;
    private readonly IFeatureAccessService _features;

    [ObservableProperty] private Company? _company;
    [ObservableProperty] private ObservableCollection<ModuleToggleItem> _moduleToggles = [];
    [ObservableProperty] private int _annualLeaveDays = 15;
    [ObservableProperty] private int _sickLeaveDays = 10;
    [ObservableProperty] private ObservableCollection<Branch> _branches = [];
    [ObservableProperty] private ObservableCollection<Employee> _hrStaff = [];

    [ObservableProperty] private bool _enforceBranchSignInRadius;
    [ObservableProperty] private double _branchSignInRadiusMeters = 500;

    public bool IsOwner => _state.IsOwner;
    public bool IsOwnerOrAdmin => _state.IsOwnerOrAdmin;

    public bool IsPayrollModuleEnabled =>
        ModuleToggles.FirstOrDefault(m => m.Key == CompanyModules.Payroll)?.IsEnabled == true;

    public string CurrentPlanLabel
    {
        get
        {
            var sub = _features.CurrentSubscription;
            if (sub is not null)
                return $"{sub.PlanName}  •  {sub.StatusLabel}  •  {sub.CurrentEmployeeCount}/{sub.EmployeeLimit} employees";

            return Company?.PlanCode switch
            {
                "basic" => "Basic  •  R700/month  •  Up to 20 users",
                "pro" => "Pro  •  R1,000/month  •  Up to 80 users",
                "premium" => "Premium  •  R1,500/month  •  Up to 250 users",
                "free_trial" => "Free Trial  •  2 months free  •  Up to 20 users",
                "starter" => "Starter",
                "enterprise" => "Enterprise",
                _ => "Starter (free)"
            };
        }
    }

    public bool HasActiveSubscription =>
        _features.CurrentSubscription?.IsActive == true || Company?.SubscriptionActive == true;

    public bool IsStarterPlan => CurrentPlanCode is "starter" or "" or "basic";
    public bool IsProPlan => CurrentPlanCode is "pro";
    public bool IsEnterprisePlan => CurrentPlanCode is "enterprise" or "premium";

    private string CurrentPlanCode =>
        _features.CurrentSubscription?.PlanCode ?? Company?.PlanCode ?? "";

    public bool IsBasicPlan => IsStarterPlan;
    public bool IsPremiumPlan => IsEnterprisePlan;

    public HrSettingsViewModel(IStorageService storage, TimesheetStateService state, ILocationService location, IFeatureAccessService features)
    {
        _storage = storage;
        _state = state;
        _location = location;
        _features = features;
        Title = "Settings";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var companyId = _state.CurrentEmployee!.CompanyId;
            Company = await _storage.GetCurrentCompanyAsync(companyId) ?? _state.CurrentCompany;
            if (Company == null) return;

            _state.SetCompany(Company);

            await _features.RefreshAsync(companyId);

            ModuleToggles = new ObservableCollection<ModuleToggleItem>(
                CompanyModules.All.Select(spec =>
                {
                    var entitled = _features.IsModuleEntitledByPlan(spec.Key);
                    return new ModuleToggleItem
                    {
                        Key = spec.Key,
                        Title = spec.Title,
                        Description = entitled
                            ? spec.Description
                            : $"{spec.Description} (not included in your plan)",
                        IsEnabled = entitled && CompanyModules.IsEnabled(Company, spec.Key, spec.DefaultIfMissing),
                        IsPlanEntitled = entitled,
                    };
                }));
            OnPropertyChanged(nameof(CurrentPlanLabel));
            OnPropertyChanged(nameof(HasActiveSubscription));

            var s = Company.CustomSettings;
            if (s.TryGetValue("annual_leave_days", out var ald) && int.TryParse(ald?.ToString(), out var aldInt)) AnnualLeaveDays = aldInt;
            if (s.TryGetValue("sick_leave_days", out var sld) && int.TryParse(sld?.ToString(), out var sldInt)) SickLeaveDays = sldInt;

            EnforceBranchSignInRadius = Company.EnforceBranchSignInRadius;
            BranchSignInRadiusMeters = Company.BranchSignInRadiusMeters;

            try
            {
                var branches = await _storage.GetBranchesAsync(Company.Id);
                Branches = new ObservableCollection<Branch>(branches);
            }
            catch { /* branches table not yet in DB */ }

            try
            {
                var allEmps = await _storage.GetEmployeesAsync(Company.Id);
                HrStaff = new ObservableCollection<Employee>(
                    allEmps.Where(e => e.AccessLevelRaw is "admin" or "hr_admin" or "owner" or "manager")
                           .OrderBy(e => e.AccessLevelRaw).ThenBy(e => e.FullName).ToList());
            }
            catch { /* ignore */ }
        });
    }

    [RelayCommand]
    private async Task GoToPayrollSettingsAsync()
        => await ShellNavigation.GoToAsync(nameof(HrPayrollSettingsPage));

    [RelayCommand]
    private async Task GoToSendFeedbackAsync()
        => await ShellNavigation.GoToAsync(nameof(Views.Platform.SendFeedbackPage));

    [RelayCommand]
    private async Task CopyCodeAsync()
    {
        if (Company?.Code is string code)
            await Clipboard.SetTextAsync(code);
        await Shell.Current.DisplayAlert("Copied", "Company code copied to clipboard.", "OK");
    }

    [RelayCommand]
    private async Task SignOutAsync()
    {
        await _storage.SignOutAsync();
        _state.Clear();
        await ShellNavigation.GoToAsync("//IdEntry");
    }

    [RelayCommand]
    private async Task SaveLocationRulesAsync()
    {
        if (Company == null) return;
        await RunAsync(async () =>
        {
            Company.SetDispatchFlag("enforce_branch_sign_in_radius", EnforceBranchSignInRadius);
            Company.SetDispatchNumber("branch_sign_in_radius_m", Company.NormalizeBranchRadius(BranchSignInRadiusMeters));

            var updated = await _storage.UpdateCompanyAsync(Company);
            Company = updated;
            _state.SetCompany(updated);
            await Shell.Current.DisplayAlert("Saved", "Location rules saved.", "OK");
        });
    }

    [RelayCommand]
    private void SetBranchSignInRadius(string meters)
    {
        if (double.TryParse(meters, out var value))
            BranchSignInRadiusMeters = Company.NormalizeBranchRadius(value);
    }

    [RelayCommand]
    private void EnableAllModules()
    {
        foreach (var toggle in ModuleToggles.Where(t => t.IsPlanEntitled))
            toggle.IsEnabled = true;
    }

    [RelayCommand]
    private void DisableAllModules()
    {
        foreach (var toggle in ModuleToggles)
            toggle.IsEnabled = false;
    }

    [RelayCommand]
    private async Task SaveModulesAsync()
    {
        if (Company == null) return;
        await RunAsync(async () =>
        {
            CompanyModules.ApplyAll(Company,
                ModuleToggles.Select(m => (m.Key, m.IsPlanEntitled && m.IsEnabled)));

            var updated = await _storage.UpdateCompanyAsync(Company);
            Company = updated;
            _state.SetCompany(updated);
            OnPropertyChanged(nameof(IsPayrollModuleEnabled));
            await Shell.Current.DisplayAlert("Saved", "Module settings saved.", "OK");
        });
    }

    [RelayCommand]
    private async Task SavePoliciesAsync()
    {
        if (Company == null) return;
        await RunAsync(async () =>
        {
            Company.CustomSettings["annual_leave_days"] = AnnualLeaveDays;
            Company.CustomSettings["sick_leave_days"] = SickLeaveDays;

            var updated = await _storage.UpdateCompanyAsync(Company);
            _state.SetCompany(updated);
            await Shell.Current.DisplayAlert("Saved", "Leave policies saved.", "OK");
        });
    }

    [RelayCommand]
    private async Task ChangePasswordAsync()
    {
        var newPass = await Shell.Current.DisplayPromptAsync(
            "Change Password", "Enter new password (min 8 chars):", "Change", "Cancel", "");
        if (string.IsNullOrWhiteSpace(newPass) || newPass.Length < 8)
        {
            if (newPass != null)
                await Shell.Current.DisplayAlert("Too Short", "Password must be at least 8 characters.", "OK");
            return;
        }
        var confirm = await Shell.Current.DisplayPromptAsync(
            "Confirm Password", "Re-enter new password:", "Confirm", "Cancel", "");
        if (confirm != newPass)
        {
            await Shell.Current.DisplayAlert("Mismatch", "Passwords do not match.", "OK");
            return;
        }
        await RunAsync(async () =>
        {
            await _storage.ChangePasswordAsync(newPass);
            await Shell.Current.DisplayAlert("Updated", "Password changed successfully.", "OK");
        });
    }

    [RelayCommand]
    private async Task TransferOwnershipAsync()
    {
        if (Company == null) return;
        var companyId = Company.Id;
        var employees = await _storage.GetEmployeesAsync(companyId);
        var candidates = employees.Where(e => e.AccessLevelRaw is "admin" or "hr_admin" or "manager").ToList();
        if (!candidates.Any())
        {
            await Shell.Current.DisplayAlert("No Candidates", "No admin or manager employees found to transfer to.", "OK");
            return;
        }

        var names = candidates.Select(e => e.FullName).ToArray();
        var chosen = await Shell.Current.DisplayActionSheet("Transfer ownership to:", "Cancel", null, names);
        if (string.IsNullOrEmpty(chosen) || chosen == "Cancel") return;

        var target = candidates.FirstOrDefault(e => e.FullName == chosen);
        if (target == null) return;

        var confirm = await Shell.Current.DisplayAlert(
            "Transfer Ownership",
            $"Transfer company ownership to {target.FullName}?\n\nA confirmation code will be sent to your email address. You will lose owner access after confirming.",
            "Send Code", "Cancel");
        if (!confirm) return;

        var code = new Random().Next(100000, 999999).ToString("D6");
        var ownerEmail = _state.CurrentEmployee?.Email ?? "";

        try
        {
            var message = new EmailMessage
            {
                Subject = "KaiFlow: Confirm Ownership Transfer",
                Body = $"Your confirmation code for transferring ownership of {Company.Name} to {target.FullName}:\n\n{code}\n\nIf you did not request this, ignore this email.",
                To = [ownerEmail]
            };
            await Email.Default.ComposeAsync(message);
        }
        catch
        {
            // Email client unavailable — show the code in-app
            await Shell.Current.DisplayAlert("Confirmation Code",
                $"Your confirmation code is:\n\n{code}\n\nKeep this code — you'll need it to confirm the transfer.",
                "OK");
        }

        var entered = await Shell.Current.DisplayPromptAsync(
            "Confirm Transfer",
            $"Enter the 6-digit code sent to {ownerEmail}:",
            "Confirm", "Cancel",
            placeholder: "------",
            keyboard: Keyboard.Numeric,
            maxLength: 6);

        if (entered?.Trim() != code)
        {
            if (entered != null)
                await Shell.Current.DisplayAlert("Incorrect Code", "The code you entered does not match. Transfer cancelled.", "OK");
            return;
        }

        await RunAsync(async () =>
        {
            await _storage.TransferOwnershipAsync(companyId, target.Id);
            _state.Clear();
            await ShellNavigation.GoToAsync("//IdEntry");
        });
    }

    [RelayCommand]
    private async Task AddBranchAsync()
    {
        if (Company == null) return;
        var name = await Shell.Current.DisplayPromptAsync("Add Branch", "Branch name:", "Next", "Cancel", "");
        if (string.IsNullOrWhiteSpace(name)) return;

        var address = await Shell.Current.DisplayPromptAsync(
            "Branch Location",
            "Enter the branch address for sign-in geofencing (optional — skip to allow sign-in from anywhere):",
            "Find Location", "Skip", "");

        double? lat = null, lon = null;
        string? resolvedAddress = null;

        if (!string.IsNullOrWhiteSpace(address))
        {
            var hits = await _location.ForwardGeocodeAsync(address.Trim());
            if (hits.Count == 0)
            {
                await Shell.Current.DisplayAlert("Not Found",
                    $"Could not locate \"{address}\". The branch will be saved without a sign-in location.", "OK");
            }
            else
            {
                var top = hits[0];
                lat = top.Latitude;
                lon = top.Longitude;
                resolvedAddress = top.Address;
                await RunAsync(async () =>
                {
                    var branch = new Branch
                    {
                        Name         = name.Trim(),
                        Address      = resolvedAddress,
                        Latitude     = lat,
                        Longitude    = lon,
                        RadiusMeters = 0,
                        CompanyId    = Company!.Id
                    };
                    try { var created = await _storage.CreateBranchAsync(branch); Branches.Add(created); }
                    catch { await Shell.Current.DisplayAlert("Error", "Could not save branch.", "OK"); }
                });
                return;
            }
        }

        await RunAsync(async () =>
        {
            var branch = new Branch
            {
                Name         = name.Trim(),
                Address      = resolvedAddress,
                Latitude     = lat,
                Longitude    = lon,
                RadiusMeters = 0,
                CompanyId    = Company!.Id
            };
            try { var created = await _storage.CreateBranchAsync(branch); Branches.Add(created); }
            catch { await Shell.Current.DisplayAlert("Error", "Could not save branch.", "OK"); }
        });
    }

    [RelayCommand]
    private async Task EditBranchAsync(Branch branch)
    {
        var name = await Shell.Current.DisplayPromptAsync("Edit Branch", "Branch name:", "Save", "Cancel", branch.Name);
        if (string.IsNullOrWhiteSpace(name)) return;

        double? lat = branch.Latitude;
        double? lon = branch.Longitude;
        string? resolvedAddress = branch.Address;
        var hasLocation = lat.HasValue && lon.HasValue;
        var promptForAddress = !hasLocation;

        if (hasLocation)
        {
            var locationAction = await Shell.Current.DisplayActionSheet(
                "Branch location", "Cancel", null, "Update address", "Remove location");
            if (locationAction == null || locationAction == "Cancel") return;
            if (locationAction == "Remove location")
            {
                lat = null;
                lon = null;
                resolvedAddress = null;
            }
            else
            {
                promptForAddress = true;
            }
        }

        if (promptForAddress)
        {
            var locationHint = hasLocation
                ? $"Current: {branch.Address ?? $"{branch.Latitude:F4}, {branch.Longitude:F4}"}"
                : "No location set yet";
            var address = await Shell.Current.DisplayPromptAsync(
                "Branch Location",
                $"Enter address for branch sign-in location.\n{locationHint}\n(Optional — skip to keep unchanged):",
                "Find Location", "Skip", "");
            if (!string.IsNullOrWhiteSpace(address))
            {
                var hits = await _location.ForwardGeocodeAsync(address.Trim());
                if (hits.Count == 0)
                    await Shell.Current.DisplayAlert("Not Found", $"Could not locate \"{address}\".", "OK");
                else
                {
                    lat = hits[0].Latitude;
                    lon = hits[0].Longitude;
                    resolvedAddress = hits[0].Address;
                }
            }
        }

        await RunAsync(async () =>
        {
            branch.Name = name.Trim();
            branch.Address = resolvedAddress;
            branch.Latitude = lat;
            branch.Longitude = lon;
            branch.RadiusMeters = 0;
            try { await _storage.UpdateBranchAsync(branch); OnPropertyChanged(nameof(Branches)); }
            catch { await Shell.Current.DisplayAlert("Error", "Could not save branch.", "OK"); }
        });
    }

    [RelayCommand]
    private async Task DeleteBranchAsync(Branch branch)
    {
        var confirm = await Shell.Current.DisplayAlert("Delete Branch", $"Delete '{branch.Name}'?", "Delete", "Cancel");
        if (!confirm) return;
        await RunAsync(async () =>
        {
            try
            {
                await _storage.DeleteBranchAsync(branch.Id);
                Branches.Remove(branch);
            }
            catch { /* branches table not yet in DB */ }
        });
    }

    partial void OnCompanyChanged(Company? value)
    {
        OnPropertyChanged(nameof(CurrentPlanLabel));
        OnPropertyChanged(nameof(HasActiveSubscription));
        OnPropertyChanged(nameof(IsBasicPlan));
        OnPropertyChanged(nameof(IsProPlan));
        OnPropertyChanged(nameof(IsPremiumPlan));
    }

    [RelayCommand]
    private async Task UpgradePlanAsync(string planCode)
    {
        if (Company == null || !IsOwnerOrAdmin) return;
        await Shell.Current.DisplayAlert(
            "Plan changes",
            "Plan upgrades and downgrades are managed through KaiFlow billing. " +
            "Contact support@kaiflow.com or your account manager to change your subscription.",
            "OK");
    }

    [RelayCommand]
    private async Task RequestPlanChangeAsync()
        => await UpgradePlanAsync("");

    [RelayCommand]
    private async Task EditCompanyDetailsAsync()
    {
        if (Company == null) return;
        var name = await Shell.Current.DisplayPromptAsync("Company Details", "Company name:", "Next", "Cancel", Company.Name);
        if (name == null) return;
        var email = await Shell.Current.DisplayPromptAsync("Company Details", "Contact email:", "Next", "Skip", Company.ContactEmail ?? "", keyboard: Keyboard.Email);
        var phone = await Shell.Current.DisplayPromptAsync("Company Details", "Contact phone:", "Next", "Skip", Company.ContactPhone ?? "", keyboard: Keyboard.Telephone);
        var address = await Shell.Current.DisplayPromptAsync("Company Details", "Address:", "Save", "Skip", Company.Address ?? "");
        if (address == null) return;

        await RunAsync(async () =>
        {
            Company.Name = name.Trim();
            Company.ContactEmail = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
            Company.ContactPhone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
            Company.Address = string.IsNullOrWhiteSpace(address) ? null : address.Trim();

            var updated = await _storage.UpdateCompanyAsync(Company);
            _state.SetCompany(updated);
            Company = updated;
            await Shell.Current.DisplayAlert("Saved", "Company details updated.", "OK");
        });
    }
}
