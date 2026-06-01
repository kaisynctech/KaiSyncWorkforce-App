using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using KaiFlow.Timesheets.Models;
using KaiFlow.Timesheets.Services;
using KaiFlow.Timesheets.ViewModels.Base;
using System.Collections.ObjectModel;

namespace KaiFlow.Timesheets.ViewModels.Employees;

public partial class EmployeeThreadChatViewModel : BaseViewModel
{
    private readonly IStorageService _storage;
    private readonly TimesheetStateService _state;

    [ObservableProperty] private ObservableCollection<MessageThread> _threads = [];
    [ObservableProperty] private MessageThread? _selectedThread;
    [ObservableProperty] private ObservableCollection<AppMessage> _messages = [];
    [ObservableProperty] private string _newMessage = "";
    [ObservableProperty] private string _activeTab = "direct";

    private List<MessageThread> _allThreads = [];

    partial void OnActiveTabChanged(string value) => ApplyThreadFilter();

    private void ApplyThreadFilter()
    {
        var filtered = ActiveTab switch
        {
            "feed" => _allThreads.Where(t => t.IsCompanyFeed).ToList(),
            "teams" => _allThreads.Where(t =>
                !t.IsCompanyFeed && (t.Subject?.StartsWith("Job:") == true || t.ParticipantIds.Count > 2)).ToList(),
            _ => _allThreads.Where(t =>
                !t.IsCompanyFeed && t.Subject?.StartsWith("Job:") != true && t.ParticipantIds.Count <= 2).ToList()
        };
        Threads = new ObservableCollection<MessageThread>(filtered);
    }

    public EmployeeThreadChatViewModel(IStorageService storage, TimesheetStateService state)
    {
        _storage = storage;
        _state = state;
        Title = "Messages";
    }

    public async Task LoadThreadsAsync()
    {
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            _allThreads = await _storage.GetMessageThreadsAsync(employee.CompanyId, employee.Id);

            // Ensure company feed thread exists (will no-op if type_raw column missing)
            try
            {
                var feed = await _storage.GetOrCreateCompanyFeedAsync(employee.CompanyId, employee.Id);
                if (!_allThreads.Any(t => t.Id == feed.Id))
                    _allThreads.Insert(0, feed);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"GetOrCreateCompanyFeedAsync: {ex.Message}");
            }

            ApplyThreadFilter();
        });
    }

    [RelayCommand]
    private void SetTab(string tab) => ActiveTab = tab;

    [RelayCommand]
    private async Task SelectThreadAsync(MessageThread thread)
    {
        SelectedThread = thread;
        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var msgs = await _storage.GetMessagesAsync(
                thread.Id,
                employee.CompanyId,
                employee.Id,
                thread.IsCompanyFeed);
            Messages = new ObservableCollection<AppMessage>(msgs);
        });
    }

    [RelayCommand]
    private async Task SendAsync()
    {
        if (string.IsNullOrWhiteSpace(NewMessage) || SelectedThread == null) return;

        await RunAsync(async () =>
        {
            var employee = _state.CurrentEmployee!;
            var msg = new AppMessage
            {
                ThreadId = SelectedThread.Id,
                SenderId = employee.Id,
                Body = NewMessage,
                CompanyId = employee.CompanyId
            };

            var sent = await _storage.SendMessageAsync(msg, SelectedThread.IsCompanyFeed);
            Messages.Add(sent);
            NewMessage = "";
        });
    }

    [RelayCommand]
    private async Task NewDirectMessageAsync()
    {
        var employee = _state.CurrentEmployee!;
        var colleagues = await _storage.GetEmployeesAsync(employee.CompanyId, employee.Id);
        var others = colleagues.Where(e => e.Id != employee.Id).ToList();
        if (!others.Any()) return;

        var names = others.Select(e => e.FullName).ToArray();
        var chosen = await Shell.Current.DisplayActionSheet("Message colleague", "Cancel", null, names);
        if (string.IsNullOrEmpty(chosen) || chosen == "Cancel") return;

        var target = others.FirstOrDefault(e => e.FullName == chosen);
        if (target == null) return;

        await RunAsync(async () =>
        {
            var thread = new MessageThread
            {
                CompanyId = employee.CompanyId,
                Subject = $"{employee.FullName} & {target.FullName}",
                ParticipantIds = [employee.Id, target.Id]
            };
            var created = await _storage.CreateThreadAsync(thread);
            Threads.Insert(0, created);
            await SelectThreadAsync(created);
        });
    }
}
