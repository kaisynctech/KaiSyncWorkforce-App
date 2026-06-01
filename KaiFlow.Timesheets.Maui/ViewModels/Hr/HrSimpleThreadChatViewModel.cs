using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Helpers;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Hr;

public record ChatMessage(string SenderName, string Body, DateTime SentAt, bool IsOwn)
{
    public string TimeDisplay =>
        PortalDateHelper.IsSet(SentAt)
            ? PortalDateHelper.FormatTime(SentAt)
            : DateTime.Now.ToString("HH:mm");
}

[QueryProperty(nameof(ThreadId), "ThreadId")]
[QueryProperty(nameof(ThreadSubject), "ThreadSubject")]
public partial class HrSimpleThreadChatViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private string _threadId = "";
    [ObservableProperty] private string _threadSubject = "";
    [ObservableProperty] private ObservableCollection<ChatMessage> _messages = [];
    [ObservableProperty] private string _newMessage = "";

    private Dictionary<Guid, string> _employeeNames = [];

    public HrSimpleThreadChatViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Thread";
    }

    partial void OnThreadSubjectChanged(string value)
    {
        if (!string.IsNullOrEmpty(value))
            Title = value;
    }

    public async Task LoadAsync()
    {
        if (!Guid.TryParse(ThreadId, out var id)) return;
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var employees = await _storage.GetEmployeesAsync(employee.CompanyId);
            _employeeNames = employees.ToDictionary(e => e.Id, e => e.FullName);

            var raw = await _storage.GetMessagesAsync(id);
            var contractors = await _storage.GetContractorsAsync(employee.CompanyId);
            var contractorNames = contractors.ToDictionary(c => c.Id, c => c.Name);

            Messages = new ObservableCollection<ChatMessage>(raw.Select(m =>
            {
                var sender = m.SenderDisplayName
                    ?? (m.IsFromClient
                        ? "Client"
                        : m.SenderContractorId.HasValue
                            ? contractorNames.GetValueOrDefault(m.SenderContractorId.Value, "Contractor")
                            : _employeeNames.GetValueOrDefault(m.SenderId, "HR"));
                var isOwn = m.SenderId == employee.Id
                    && !m.SenderContractorId.HasValue
                    && !m.IsFromClient;
                return new ChatMessage(sender, m.Body, m.CreatedAt, isOwn);
            }));
        });
    }

    [RelayCommand]
    private async Task SendAsync()
    {
        var body = NewMessage.Trim();
        if (string.IsNullOrEmpty(body)) return;
        if (!Guid.TryParse(ThreadId, out var threadId)) return;

        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var msg = new AppMessage
            {
                ThreadId = threadId,
                SenderId = employee.Id,
                Body = body,
                CompanyId = employee.CompanyId
            };
            var sent = await _storage.SendMessageAsync(msg);
            var sentAt = PortalDateHelper.IsSet(sent.CreatedAt) ? sent.CreatedAt : DateTime.UtcNow;
            Messages.Add(new ChatMessage("Me", sent.Body, sentAt, true));
            NewMessage = "";
        });
    }

    [RelayCommand]
    private async Task RefreshAsync() => await LoadAsync();
}
