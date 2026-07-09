using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Models.Production;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.Services.Platform;
using KaiFlow.Timesheets.Services.Production;
using KaiFlow.Timesheets.ViewModels.Base;
using KaiFlow.Timesheets.Views.Auth;
using KaiFlow.Timesheets.Views.Hr;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public partial class HrSettingsViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly StepUpVerificationService _stepUp;
    private readonly TimesheetStateService _state;
    private readonly ILocationService _location;
    private readonly IFeatureAccessService _features;
    private readonly IBackupService _backup;

    [ObservableProperty] private Company? _company;
    [ObservableProperty] private ObservableCollection<ModuleToggleItem> _moduleToggles = [];
    [ObservableProperty] private int _annualLeaveDays = 15;
    [ObservableProperty] private int _sickLeaveDays = 10;
    [ObservableProperty] private ObservableCollection<Branch> _branches = [];
    [ObservableProperty] private ObservableCollection<Employee> _hrStaff = [];

    [ObservableProperty] private bool _enforceBranchSignInRadius;
    [ObservableProperty] private double _branchSignInRadiusMeters = 500;
    [ObservableProperty] private ObservableCollection<CompanyBackupRecord> _snapshots = [];
    [ObservableProperty] private bool _isSnapshotBusy;
    [ObservableProperty] private ObservableCollection<CompanyExportJobRecord> _exports = [];
    [ObservableProperty] private bool _isExportBusy;
    [ObservableProperty] private string? _exportDownloadUrl;
    [ObservableProperty] private DateTime? _exportExpiresAt;
    [ObservableProperty] private string _exportStatus = "idle";

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

    public HrSettingsViewModel(IStorageService storage, TimesheetStateService state, ILocationService location, IFeatureAccessService features, StepUpVerificationService stepUp, IBackupService backup)
    {
        _storage = storage;
        _state = state;
        _location = location;
        _features = features;
        _stepUp = stepUp;
        _backup = backup;
        Title = "Settings";
    }

    public bool HasExportDownloadUrl => !string.IsNullOrEmpty(ExportDownloadUrl) && ExportExpiresAt > DateTime.UtcNow;
    public string ExportExpiryDisplay => ExportExpiresAt.HasValue
        ? $"Link expires {ExportExpiresAt.Value.ToLocalTime():dd MMM yyyy HH:mm}"
        : "";
    public bool IsExportIdle => ExportStatus == "idle";
    public bool IsExportProcessing => ExportStatus == "processing";
    public bool IsExportCompleted => ExportStatus == "completed" && HasExportDownloadUrl;
    public bool IsExportFailed => ExportStatus == "failed";

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

            try
            {
                var snaps = await _backup.ListBackupsAsync(Company.Id, 10);
                Snapshots = new ObservableCollection<CompanyBackupRecord>(snaps);
            }
            catch { /* ignore */ }

            try
            {
                var exportJobs = await _backup.GetExportJobsAsync(Company.Id, 5);
                Exports = new ObservableCollection<CompanyExportJobRecord>(exportJobs);
                var latest = Exports.FirstOrDefault(e => e.IsCompleted);
                if (latest != null)
                {
                    ExportDownloadUrl = latest.DownloadUrl;
                    ExportExpiresAt = latest.ExpiresAt;
                    ExportStatus = latest.IsExpired ? "idle" : "completed";
                    OnPropertyChanged(nameof(HasExportDownloadUrl));
                    OnPropertyChanged(nameof(ExportExpiryDisplay));
                    OnPropertyChanged(nameof(IsExportCompleted));
                    OnPropertyChanged(nameof(IsExportIdle));
                }
            }
            catch { /* ignore */ }
        });
    }

    [RelayCommand]
    private async Task TakeSnapshotAsync()
    {
        var companyId = _state.CurrentEmployee!.CompanyId;
        IsSnapshotBusy = true;
        try
        {
            var snap = await _backup.CreateManualBackupAsync(companyId);
            Snapshots.Insert(0, snap);
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlert("Error", ex.Message, "OK");
        }
        finally
        {
            IsSnapshotBusy = false;
        }
    }

    [RelayCommand]
    private async Task RequestExportAsync()
    {
        var companyId = _state.CurrentEmployee!.CompanyId;
        var confirmed = await Shell.Current.DisplayAlert(
            "Data Export",
            "This will export all your company data to a downloadable file. The link will expire after 24 hours.\n\n⚠ The export includes sensitive data (payroll, banking, ID numbers). Keep it secure.",
            "Generate Export", "Cancel");
        if (!confirmed) return;

        ExportStatus = "processing";
        IsExportBusy = true;
        ExportDownloadUrl = null;
        OnPropertyChanged(nameof(IsExportIdle));
        OnPropertyChanged(nameof(IsExportProcessing));
        OnPropertyChanged(nameof(IsExportCompleted));
        OnPropertyChanged(nameof(HasExportDownloadUrl));
        try
        {
            var result = await _backup.RequestExportAsync(companyId);
            ExportDownloadUrl = result.DownloadUrl;
            ExportExpiresAt = result.ExpiresAt;
            ExportStatus = "completed";
            var fresh = await _backup.GetExportJobsAsync(companyId, 5);
            Exports = new ObservableCollection<CompanyExportJobRecord>(fresh);
        }
        catch (Exception ex)
        {
            ExportStatus = "failed";
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsExportBusy = false;
            OnPropertyChanged(nameof(IsExportIdle));
            OnPropertyChanged(nameof(IsExportProcessing));
            OnPropertyChanged(nameof(IsExportCompleted));
            OnPropertyChanged(nameof(IsExportFailed));
            OnPropertyChanged(nameof(HasExportDownloadUrl));
            OnPropertyChanged(nameof(ExportExpiryDisplay));
        }
    }

    [RelayCommand]
    private async Task DownloadExportAsync()
    {
        if (string.IsNullOrEmpty(ExportDownloadUrl)) return;
        try { await Launcher.OpenAsync(new Uri(ExportDownloadUrl)); }
        catch (Exception ex) { await Shell.Current.DisplayAlert("Error", ex.Message, "OK"); }
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
        var eligible = employees
            .Where(e => e.AccessLevelRaw is "hr" or "manager" && e.IsActive && e.UserId != null)
            .ToList();
        if (!eligible.Any())
        {
            await Shell.Current.DisplayAlert("No Eligible Employees",
                "Ownership can only be transferred to an active HR or manager. Promote an employee to HR first, then initiate the transfer.",
                "OK");
            return;
        }

        var names = eligible.Select(e => e.FullName).ToArray();
        var selected = await Shell.Current.DisplayActionSheet("Select New Owner", "Cancel", null, names);
        if (selected is null or "Cancel") return;

        var target = eligible.FirstOrDefault(e => e.FullName == selected);
        if (target == null) return;

        var confirmInitiate = await Shell.Current.DisplayAlert("Transfer Ownership",
            $"You are about to transfer company ownership to {target.FullName}.\n\nYou will be demoted to HR immediately after the transfer. This action cannot be undone.\n\nYou'll need to confirm with a code shown on this screen.",
            "Continue", "Cancel");
        if (!confirmInitiate) return;

        OwnershipTransferInitiation? initiation = null;
        await RunAsync(async () =>
        {
            await _stepUp.ExecuteAsync(async () =>
            {
                initiation = await _storage.InitiateOwnershipTransferAsync(companyId, target.Id);
            });
        });
        if (initiation == null) return;

        var otpToShow = initiation.Otp;
        var expiryMinutes = (int)(initiation.ExpiresAt - DateTime.UtcNow).TotalMinutes;
        await Shell.Current.DisplayAlert("Your Confirmation Code",
            $"Code: {otpToShow}\n\nThis code expires in {expiryMinutes} minutes.\nShare this code with the person receiving ownership through your own channel, then enter it on the next screen to confirm.",
            "I've noted the code");

        // Discard OTP from memory — store only the transfer ID (BR-3)
        var transferId = initiation.TransferId;
        otpToShow = null;
        initiation = null;

        var entered = await Shell.Current.DisplayPromptAsync(
            "Confirm Transfer",
            $"Enter the 6-digit confirmation code to transfer ownership to {target.FullName}:",
            "Confirm", "Cancel",
            placeholder: "------",
            keyboard: Keyboard.Numeric,
            maxLength: 6);
        if (string.IsNullOrWhiteSpace(entered)) return;

        await RunAsync(async () =>
        {
            try
            {
                await _storage.VerifyOwnershipTransferAsync(companyId, transferId, entered.Trim());
            }
            catch (Exception ex) when (ex.Message.Contains("STEP_UP_REQUIRED"))
            {
                await _stepUp.ExecuteAsync(async () =>
                    await _storage.VerifyOwnershipTransferAsync(companyId, transferId, entered.Trim()));
            }
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
