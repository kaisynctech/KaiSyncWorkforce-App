using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class MyLeaveViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    // Form state
    [ObservableProperty] private ObservableCollection<LeaveRequest> _requests = [];
    [ObservableProperty] private ObservableCollection<LeaveBalance> _leaveBalances = [];
    [ObservableProperty] private string _leaveType = "Annual Leave";
    [ObservableProperty] private DateTime _startDate = DateTime.Today;
    [ObservableProperty] private DateTime _endDate = DateTime.Today;
    [ObservableProperty] private string _reason = "";
    [ObservableProperty] private bool _showForm;
    [ObservableProperty] private string? _attachmentPath;
    [ObservableProperty] private string? _attachmentFileName;
    [ObservableProperty] private bool _isEditing;

    // The leave request being edited (null = new request)
    private LeaveRequest? _editingRequest;

    public bool HasAttachment => AttachmentPath != null;
    public bool HasNoAttachment => AttachmentPath == null;
    public string FormTitle => IsEditing ? "EDIT LEAVE REQUEST" : "NEW LEAVE REQUEST";
    public string SubmitButtonLabel => IsEditing ? "Save Changes" : "Submit Request";

    partial void OnAttachmentPathChanged(string? value)
    {
        OnPropertyChanged(nameof(HasAttachment));
        OnPropertyChanged(nameof(HasNoAttachment));
        AttachmentFileName = value != null ? Path.GetFileName(value) : null;
    }

    partial void OnIsEditingChanged(bool value)
    {
        OnPropertyChanged(nameof(FormTitle));
        OnPropertyChanged(nameof(SubmitButtonLabel));
    }

    public List<string> LeaveTypes { get; } = LeavePolicy.TypeKeys.ToList();

    public MyLeaveViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "My Leave";
    }

    public async Task LoadAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var all = await _storage.GetMyLeaveRequestsAsync(employee.CompanyId, employee.Id);
            Requests = new ObservableCollection<LeaveRequest>(SortRequests(all));
            LeaveBalances = new ObservableCollection<LeaveBalance>(ComputeBalances(all));
        });
    }

    // Pending first, then by created date descending
    private static IEnumerable<LeaveRequest> SortRequests(IEnumerable<LeaveRequest> all)
        => all.OrderBy(r => r.StatusRaw == "pending" ? 0 : 1)
              .ThenByDescending(r => r.CreatedAt);

    private static List<LeaveBalance> ComputeBalances(IEnumerable<LeaveRequest> all)
    {
        var list = all.ToList();
        var thisYear = DateTime.Today.Year;
        var yearly = list.Where(r => r.StartDate.Year == thisYear).ToList();
        return LeavePolicy.Types.Select(t =>
        {
            var forType = yearly.Where(r => r.LeaveType.Equals(t.Key, StringComparison.OrdinalIgnoreCase)).ToList();
            var taken = forType.Where(r => r.IsApproved).Sum(r => r.TotalDays);
            var pending = forType.Where(r => r.IsPending).Sum(r => r.TotalDays);
            return new LeaveBalance(t.Key, t.Label, t.Color, t.AnnualDays, taken, pending);
        }).ToList();
    }

    [RelayCommand]
    private void ToggleForm()
    {
        if (ShowForm)
            ResetForm();
        else
            ShowForm = true;
    }

    [RelayCommand]
    private void EditLeave(LeaveRequest leave)
    {
        _editingRequest = leave;
        IsEditing = true;
        LeaveType = leave.LeaveType;
        StartDate = leave.StartDate.ToDateTime(TimeOnly.MinValue);
        EndDate = leave.EndDate.ToDateTime(TimeOnly.MinValue);
        Reason = leave.Reason ?? "";
        // Keep existing attachment URL but don't pre-fill local path
        AttachmentPath = null;
        ErrorMessage = null;
        ShowForm = true;
    }

    [RelayCommand]
    private async Task PickAttachmentAsync()
    {
        try
        {
            var result = await FilePicker.PickAsync(new PickOptions
            {
                PickerTitle = "Select document or photo",
                FileTypes = new FilePickerFileType(new Dictionary<DevicePlatform, IEnumerable<string>>
                {
                    { DevicePlatform.WinUI,      new[] { ".jpg", ".jpeg", ".png", ".pdf", ".doc", ".docx" } },
                    { DevicePlatform.Android,    new[] { "image/*", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } },
                    { DevicePlatform.iOS,        new[] { "public.image", "com.adobe.pdf", "com.microsoft.word.doc" } },
                    { DevicePlatform.MacCatalyst,new[] { "public.image", "com.adobe.pdf" } }
                })
            });

            if (result != null)
                AttachmentPath = result.FullPath;
        }
        catch { }
    }

    [RelayCommand]
    private void RemoveAttachment()
    {
        AttachmentPath = null;
        // Also clear the existing attachment URL when editing
        if (_editingRequest != null)
            _editingRequest.AttachmentUrl = null;
    }

    [RelayCommand]
    private async Task SubmitAsync()
    {
        if (EndDate < StartDate)
        {
            ErrorMessage = "End date cannot be before start date.";
            return;
        }

        if (IsEditing && _editingRequest != null)
            await SaveEditAsync();
        else
            await CreateNewAsync();
    }

    private async Task CreateNewAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var start = DateOnly.FromDateTime(StartDate);
            var end = DateOnly.FromDateTime(EndDate);

            string? attachmentUrl = null;
            if (AttachmentPath != null)
                attachmentUrl = await _storage.UploadLeaveAttachmentAsync(employee.Id, AttachmentPath);

            var request = new LeaveRequest
            {
                EmployeeId    = employee.Id,
                LeaveType     = LeaveType,
                StartDate     = start,
                EndDate       = end,
                TotalDays     = (end.DayNumber - start.DayNumber) + 1.0,
                Reason        = string.IsNullOrWhiteSpace(Reason) ? null : Reason,
                StatusRaw     = "pending",
                CompanyId     = employee.CompanyId,
                AttachmentUrl = attachmentUrl
            };

            var saved = await _storage.CreateLeaveRequestAsync(request);
            var updated = SortRequests(Requests.Prepend(saved)).ToList();
            Requests = new ObservableCollection<LeaveRequest>(updated);
            LeaveBalances = new ObservableCollection<LeaveBalance>(ComputeBalances(Requests));
            ResetForm();
        });
    }

    private async Task SaveEditAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var start = DateOnly.FromDateTime(StartDate);
            var end = DateOnly.FromDateTime(EndDate);

            // Upload new attachment if selected; keep existing URL if not changed
            string? attachmentUrl = _editingRequest!.AttachmentUrl;
            if (AttachmentPath != null)
                attachmentUrl = await _storage.UploadLeaveAttachmentAsync(employee.Id, AttachmentPath);

            var toUpdate = new LeaveRequest
            {
                Id            = _editingRequest.Id,
                EmployeeId    = employee.Id,
                CompanyId     = employee.CompanyId,
                LeaveType     = LeaveType,
                StartDate     = start,
                EndDate       = end,
                TotalDays     = (end.DayNumber - start.DayNumber) + 1.0,
                Reason        = string.IsNullOrWhiteSpace(Reason) ? null : Reason,
                StatusRaw     = "pending",
                AttachmentUrl = attachmentUrl
            };

            var saved = await _storage.UpdatePendingLeaveAsync(toUpdate);

            // Replace the old item in the list
            var idx = Requests.ToList().FindIndex(r => r.Id == saved.Id);
            if (idx >= 0) Requests[idx] = saved;
            var sorted = SortRequests(Requests).ToList();
            Requests = new ObservableCollection<LeaveRequest>(sorted);
            LeaveBalances = new ObservableCollection<LeaveBalance>(ComputeBalances(Requests));
            ResetForm();
        });
    }

    private void ResetForm()
    {
        ShowForm = false;
        IsEditing = false;
        _editingRequest = null;
        Reason = "";
        StartDate = DateTime.Today;
        EndDate = DateTime.Today;
        LeaveType = "Annual Leave";
        AttachmentPath = null;
        ErrorMessage = null;
    }
}
