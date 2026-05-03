import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/pa_task.dart';
import '../strings/workspace_terms.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import '_dashboard_decorators.dart';
import 'my_pa_meeting_calendar_tab.dart';

class MyPaSection extends StatefulWidget {
  final bool employeeMode;

  const MyPaSection({
    super.key,
    this.employeeMode = false,
  });

  @override
  State<MyPaSection> createState() => _MyPaSectionState();
}

class _MyPaSectionState extends State<MyPaSection> {
  bool _loading = false;
  String? _error;
  List<PaTask> _tasks = const [];
  String _statusFilter = 'all';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final prov = context.read<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    if (companyId == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (widget.employeeMode) {
        try {
          await SupabaseTimesheetStorage.enqueuePaTaskNotifications(
            companyId: companyId,
          );
          await SupabaseTimesheetStorage.dispatchNotificationDeliveries(
            companyId: companyId,
          );
        } catch (_) {}
      }
      if (!widget.employeeMode) {
        try {
          await SupabaseTimesheetStorage.syncOperationalPaTasks(
            companyId: companyId,
          );
        } catch (_) {
          // Sync pulls optional operational hints from jobs/deals; failures
          // must not block loading existing PA tasks for HR.
        }
      }
      final tasks = await SupabaseTimesheetStorage.getPaTasks(
        companyId: companyId,
        ownerEmployeeId: widget.employeeMode ? prov.currentEmployee?.id : null,
      );
      if (!mounted) return;
      setState(() {
        _tasks = tasks;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = friendlyErrorMessage(e, fallback: 'Could not load My PA tasks.'));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<PaTask> get _filteredTasks {
    final now = DateTime.now();
    return _tasks.where((t) {
      if (_statusFilter == 'all') return true;
      if (_statusFilter == 'overdue') {
        return !t.isDone && t.dueAt != null && t.dueAt!.isBefore(now);
      }
      return t.status == _statusFilter;
    }).toList();
  }

  Future<void> _showTaskEditor({
    PaTask? existing,
    DateTime? presetDay,
  }) async {
    final titleCtrl = TextEditingController(text: existing?.title ?? '');
    final notesCtrl = TextEditingController(text: existing?.notes ?? '');
    final meetingWithCtrl = TextEditingController(text: existing?.meetingWith ?? '');
    final meetingMinutesCtrl =
        TextEditingController(text: existing?.meetingMinutes ?? '');
    final meetingFollowUpCtrl =
        TextEditingController(text: existing?.meetingFollowUp ?? '');
    DateTime? dueAt = existing?.dueAt;
    DateTime? remindAt = existing?.remindAt;
    DateTime? meetingAt = existing?.meetingAt;
    if (existing == null && presetDay != null) {
      dueAt = DateTime(presetDay.year, presetDay.month, presetDay.day, 9);
    }
    String priority = existing?.priority ?? 'medium';
    String recurrencePattern = existing?.recurrencePattern ?? 'none';
    String linkedType = existing?.linkedType ?? 'none';
    String? linkedId = existing?.linkedId;
    String? linkedLabel = existing?.linkedLabel;
    List<PaLinkOption> linkOptions = const [];

    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    if (linkedType != 'none' && linkedType != 'meeting') {
      linkOptions = await SupabaseTimesheetStorage.getPaLinkOptions(
        companyId: companyId,
        linkedType: linkedType,
      );
      if (linkedId != null && linkOptions.every((o) => o.id != linkedId)) {
        linkedId = null;
        linkedLabel = null;
      }
    }

    Future<DateTime?> pickDateTime(DateTime? initial) async {
      final now = DateTime.now();
      final date = await showDatePicker(
        context: context,
        initialDate: initial ?? now,
        firstDate: DateTime(now.year - 1),
        lastDate: DateTime(now.year + 3),
      );
      if (date == null || !mounted) return null;
      final time = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(initial ?? now),
      );
      if (time == null) return null;
      return DateTime(date.year, date.month, date.day, time.hour, time.minute);
    }

    if (!mounted) return;
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(existing == null ? 'New task' : 'Edit task'),
          content: SizedBox(
            width: 560,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: titleCtrl,
                  decoration: const InputDecoration(labelText: 'Task title'),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: notesCtrl,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(labelText: 'Notes (optional)'),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: priority,
                        decoration: const InputDecoration(labelText: 'Priority'),
                        items: const [
                          DropdownMenuItem(value: 'low', child: Text('Low')),
                          DropdownMenuItem(value: 'medium', child: Text('Medium')),
                          DropdownMenuItem(value: 'high', child: Text('High')),
                        ],
                        onChanged: (v) => setLocal(() => priority = v ?? 'medium'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          final dt = await pickDateTime(dueAt);
                          if (dt == null) return;
                          setLocal(() => dueAt = dt);
                        },
                        icon: const Icon(Icons.schedule_outlined, size: 16),
                        label: Text(dueAt == null ? 'Set due' : DateFormat('dd MMM • HH:mm').format(dueAt!)),
                      ),
                    ),
                    if (dueAt != null) ...[
                      const SizedBox(width: 4),
                      IconButton(
                        tooltip: 'Clear due',
                        onPressed: () => setLocal(() => dueAt = null),
                        icon: const Icon(Icons.close, size: 18),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () async {
                          final dt = await pickDateTime(remindAt);
                          if (dt == null) return;
                          setLocal(() => remindAt = dt);
                        },
                        icon: const Icon(Icons.alarm_outlined, size: 16),
                        label: Text(remindAt == null ? 'Set reminder' : DateFormat('dd MMM • HH:mm').format(remindAt!)),
                      ),
                    ),
                    if (remindAt != null) ...[
                      const SizedBox(width: 4),
                      IconButton(
                        tooltip: 'Clear reminder',
                        onPressed: () => setLocal(() => remindAt = null),
                        icon: const Icon(Icons.close, size: 18),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: linkedType,
                  decoration: const InputDecoration(labelText: 'Link type'),
                  items: const [
                    DropdownMenuItem(value: 'none', child: Text('None')),
                    DropdownMenuItem(value: 'client', child: Text('Client')),
                    DropdownMenuItem(value: 'job', child: Text('Job')),
                    DropdownMenuItem(value: 'deal', child: Text(WorkspaceTerms.project)),
                    DropdownMenuItem(value: 'payment', child: Text('Payment')),
                    DropdownMenuItem(value: 'meeting', child: Text('Meeting')),
                  ],
                  onChanged: (v) async {
                    final next = v ?? 'none';
                    setLocal(() {
                      linkedType = next;
                      linkedId = null;
                      linkedLabel = null;
                      linkOptions = const [];
                    });
                    if (next != 'none' && next != 'meeting') {
                      final options = await SupabaseTimesheetStorage.getPaLinkOptions(
                        companyId: companyId,
                        linkedType: next,
                      );
                      if (!context.mounted) return;
                      setLocal(() => linkOptions = options);
                    }
                  },
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: recurrencePattern,
                  decoration: const InputDecoration(labelText: 'Recurrence'),
                  items: const [
                    DropdownMenuItem(value: 'none', child: Text('None')),
                    DropdownMenuItem(value: 'daily', child: Text('Daily')),
                    DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                    DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
                  ],
                  onChanged: (v) => setLocal(() => recurrencePattern = v ?? 'none'),
                ),
                if (linkedType != 'none' && linkedType != 'meeting') ...[
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: linkOptions.any((o) => o.id == linkedId) ? linkedId : null,
                    decoration: const InputDecoration(labelText: 'Linked record'),
                    items: linkOptions
                        .map((o) => DropdownMenuItem(value: o.id, child: Text(o.label)))
                        .toList(growable: false),
                    onChanged: (v) {
                      setLocal(() {
                        linkedId = v;
                        final match = linkOptions.where((o) => o.id == v);
                        linkedLabel = match.isEmpty ? null : match.first.label;
                      });
                    },
                  ),
                ],
                if (linkedType == 'meeting') ...[
                  const SizedBox(height: 8),
                  TextField(
                    controller: meetingWithCtrl,
                    decoration: const InputDecoration(labelText: 'Meeting with'),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            final dt = await pickDateTime(meetingAt);
                            if (dt == null) return;
                            setLocal(() => meetingAt = dt);
                          },
                          icon: const Icon(Icons.groups_2_outlined, size: 16),
                          label: Text(meetingAt == null
                              ? 'Set meeting time'
                              : DateFormat('dd MMM • HH:mm').format(meetingAt!)),
                        ),
                      ),
                      if (meetingAt != null) ...[
                        const SizedBox(width: 4),
                        IconButton(
                          tooltip: 'Clear meeting time',
                          onPressed: () => setLocal(() => meetingAt = null),
                          icon: const Icon(Icons.close, size: 18),
                        ),
                      ],
                    ],
                  ),
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: meetingMinutesCtrl,
                  minLines: 2,
                  maxLines: 5,
                  decoration: const InputDecoration(
                    labelText: 'Meeting minutes / outcomes',
                    hintText: 'After the meeting: how did it go? Decisions?',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: meetingFollowUpCtrl,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Follow-up plan',
                    hintText: 'Schedule another meeting? Project status? Next actions?',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () async {
                if (titleCtrl.text.trim().isEmpty) {
                  showInfoSnack(context, 'Task title is required.');
                  return;
                }
                if (existing == null) {
                  await SupabaseTimesheetStorage.createPaTask(
                    companyId: companyId,
                    title: titleCtrl.text.trim(),
                    notes: notesCtrl.text.trim(),
                    dueAt: dueAt,
                    priority: priority,
                    remindAt: remindAt,
                    linkedType: linkedType,
                    linkedId: linkedId,
                    linkedLabel: linkedLabel,
                    recurrencePattern: recurrencePattern,
                    meetingWith: meetingWithCtrl.text.trim(),
                    meetingAt: meetingAt,
                    meetingMinutes: meetingMinutesCtrl.text.trim(),
                    meetingFollowUp: meetingFollowUpCtrl.text.trim(),
                    ownerEmployeeId: widget.employeeMode
                        ? this.context.read<TimesheetProvider>().currentEmployee?.id
                        : null,
                  );
                } else {
                  await SupabaseTimesheetStorage.updatePaTask(
                    companyId: companyId,
                    taskId: existing.id,
                    title: titleCtrl.text.trim(),
                    notes: notesCtrl.text.trim(),
                    dueAt: dueAt,
                    priority: priority,
                    remindAt: remindAt,
                    linkedType: linkedType,
                    linkedId: linkedId,
                    linkedLabel: linkedLabel,
                    recurrencePattern: recurrencePattern,
                    meetingWith: meetingWithCtrl.text.trim(),
                    meetingAt: meetingAt,
                    meetingMinutes: meetingMinutesCtrl.text.trim(),
                    meetingFollowUp: meetingFollowUpCtrl.text.trim(),
                    actingEmployeeId: widget.employeeMode
                        ? this.context.read<TimesheetProvider>().currentEmployee?.id
                        : null,
                  );
                }
                if (!context.mounted) return;
                Navigator.of(context).pop(true);
              },
              child: Text(existing == null ? 'Create task' : 'Save changes'),
            ),
          ],
        ),
      ),
    );
    if (saved == true) {
      await _load();
      if (!mounted) return;
      showSuccessSnack(context, existing == null ? 'Task created.' : 'Task updated.');
    }
  }

  Future<void> _setStatus(PaTask task, String status) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    await SupabaseTimesheetStorage.updatePaTaskStatus(
      companyId: companyId,
      taskId: task.id,
      status: status,
      snoozedUntil: status == 'snoozed' ? DateTime.now().add(const Duration(hours: 2)) : null,
      actingEmployeeId: widget.employeeMode
          ? context.read<TimesheetProvider>().currentEmployee?.id
          : null,
    );
    await _load();
  }

  Future<void> _deleteTask(PaTask task) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    await SupabaseTimesheetStorage.deletePaTask(
      companyId: companyId,
      taskId: task.id,
      actingEmployeeId: widget.employeeMode
          ? context.read<TimesheetProvider>().currentEmployee?.id
          : null,
    );
    await _load();
    if (!mounted) return;
    showSuccessSnack(context, 'Task deleted.');
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final items = _filteredTasks;

    return LayoutBuilder(
      builder: (context, constraints) {
        final maxH = constraints.maxHeight;
        var bodyHeight = maxH.isFinite && maxH > 0
            ? maxH
            : MediaQuery.sizeOf(context).height * 0.78;
        bodyHeight = bodyHeight.clamp(400.0, 20000.0);
    return SizedBox(
      height: bodyHeight,
      child: DefaultTabController(
      length: 2,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: PremiumSectionHeader(
              icon: Icons.assistant_navigation,
              title: widget.employeeMode ? 'My PA' : 'My PA workspace',
              subtitle: widget.employeeMode
                  ? 'Track your tasks, due times, and priorities in one place.'
                  : 'Capture meetings, follow-ups, and operational to-dos.',
              actions: [
                ElevatedButton.icon(
                  onPressed: () => _showTaskEditor(),
                  icon: const Icon(Icons.add_task, size: 16),
                  label: const Text('New task'),
                ),
              ],
            ),
          ),
          if (companyId != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: widget.employeeMode
                  ? Builder(
                      builder: (_) {
                        final metrics =
                            SupabaseTimesheetStorage.metricsFromPaTasks(_tasks);
                        return SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: [
                              DashboardStatCard(
                                icon: Icons.assignment_outlined,
                                label: 'Open tasks',
                                value: '${metrics['open'] ?? 0}',
                              ),
                              const SizedBox(width: 10),
                              DashboardStatCard(
                                icon: Icons.warning_amber_outlined,
                                label: 'Overdue',
                                value: '${metrics['overdue'] ?? 0}',
                              ),
                              const SizedBox(width: 10),
                              DashboardStatCard(
                                icon: Icons.today_outlined,
                                label: 'Due today',
                                value: '${metrics['due_today'] ?? 0}',
                              ),
                            ],
                          ),
                        );
                      },
                    )
                  : FutureBuilder<Map<String, int>>(
                      future: SupabaseTimesheetStorage.getPaOverview(
                        companyId: companyId,
                        ownerEmployeeId: null,
                      ),
                      builder: (context, snap) {
                        final metrics =
                            snap.data ?? const {'open': 0, 'overdue': 0, 'due_today': 0};
                        return SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: [
                              DashboardStatCard(
                                icon: Icons.assignment_outlined,
                                label: 'Open tasks',
                                value: '${metrics['open'] ?? 0}',
                              ),
                              const SizedBox(width: 10),
                              DashboardStatCard(
                                icon: Icons.warning_amber_outlined,
                                label: 'Overdue',
                                value: '${metrics['overdue'] ?? 0}',
                              ),
                              const SizedBox(width: 10),
                              DashboardStatCard(
                                icon: Icons.today_outlined,
                                label: 'Due today',
                                value: '${metrics['due_today'] ?? 0}',
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
          Material(
            color: Colors.white,
            child: TabBar(
              labelColor: const Color(0xFF1E3A8A),
              unselectedLabelColor: const Color(0xFF64748B),
              indicatorColor: const Color(0xFF1E3A8A),
              labelStyle: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w600),
              tabs: const [
                Tab(text: 'Tasks', icon: Icon(Icons.task_alt_outlined, size: 18)),
                Tab(text: 'Meeting calendar', icon: Icon(Icons.calendar_month_outlined, size: 18)),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final f in const ['all', 'todo', 'in_progress', 'done', 'overdue'])
                            ChoiceChip(
                              label: Text(f == 'in_progress' ? 'in progress' : f),
                              selected: _statusFilter == f,
                              onSelected: (_) => setState(() => _statusFilter = f),
                            ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      if (_loading)
                        const PremiumLoadingIndicator(label: 'Loading My PA...')
                      else if (_error != null)
                        LoadErrorPanel(message: _error!, onRetry: _load)
                      else if (items.isEmpty)
                        const PremiumEmptyState(
                          icon: Icons.assignment_outlined,
                          title: 'No tasks yet',
                          subtitle:
                              'Create your first My PA task to track follow-ups, meetings, or reminders.',
                        )
                      else
                        ...items.map((t) => _TaskCard(
                              task: t,
                              onEdit: () => _showTaskEditor(existing: t),
                              onDelete: () => _deleteTask(t),
                              onStatusChange: (s) => _setStatus(t, s),
                            )),
                    ],
                  ),
                ),
                MyPaMeetingCalendarTab(
                  tasks: _tasks,
                  onOpenTask: (t) => _showTaskEditor(existing: t),
                  onPlanDay: (day) => _showTaskEditor(presetDay: day),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
    );
      },
    );
  }
}

class _TaskCard extends StatelessWidget {
  final PaTask task;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final ValueChanged<String> onStatusChange;

  const _TaskCard({
    required this.task,
    required this.onEdit,
    required this.onDelete,
    required this.onStatusChange,
  });

  Color _priorityColor(String p) => switch (p) {
        'high' => const Color(0xFFDC2626),
        'low' => const Color(0xFF059669),
        _ => const Color(0xFF1E3A8A),
      };

  @override
  Widget build(BuildContext context) {
    final dueText = task.dueAt == null ? 'No due time' : DateFormat('EEE, d MMM • h:mm a').format(task.dueAt!);
    final dueOverdue = task.dueAt != null && !task.isDone && task.dueAt!.isBefore(DateTime.now());
    final pColor = _priorityColor(task.priority);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    task.title,
                    style: GoogleFonts.poppins(
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F172A),
                      decoration: task.isDone ? TextDecoration.lineThrough : null,
                    ),
                  ),
                ),
                IconButton(onPressed: onEdit, icon: const Icon(Icons.edit_outlined, size: 18)),
                IconButton(onPressed: onDelete, icon: const Icon(Icons.delete_outline, size: 18)),
              ],
            ),
            if ((task.notes ?? '').trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  task.notes!.trim(),
                  style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF4B5563)),
                ),
              ),
            if ((task.meetingMinutes ?? '').trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  'Minutes: ${task.meetingMinutes!.trim()}',
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFF374151)),
                ),
              ),
            if ((task.meetingFollowUp ?? '').trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  'Follow-up: ${task.meetingFollowUp!.trim()}',
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFF065F46)),
                ),
              ),
            if (task.linkedType != 'none' || (task.meetingWith ?? '').trim().isNotEmpty || task.meetingAt != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    if (task.linkedType != 'none')
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEAF1FF),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          task.linkedLabel?.trim().isNotEmpty == true
                              ? '${WorkspaceTerms.linkedTypeDisplay(task.linkedType)}: ${task.linkedLabel}'
                              : '${WorkspaceTerms.linkedTypeDisplay(task.linkedType)}: ${task.linkedId ?? '-'}',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF1E3A8A),
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    if ((task.meetingWith ?? '').trim().isNotEmpty)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEAFBF3),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          'Meeting: ${task.meetingWith!.trim()}',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF166534),
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    if (task.meetingAt != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFF7ED),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          'At ${DateFormat('dd MMM • HH:mm').format(task.meetingAt!)}',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF9A3412),
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: pColor.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: pColor.withValues(alpha: 0.25)),
                  ),
                  child: Text(
                    task.priority.toUpperCase(),
                    style: GoogleFonts.poppins(color: pColor, fontSize: 10, fontWeight: FontWeight.w700),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: dueOverdue ? const Color(0xFFFEE2E2) : const Color(0xFFEFF4FF),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    dueOverdue ? 'Overdue • $dueText' : dueText,
                    style: GoogleFonts.poppins(
                      color: dueOverdue ? const Color(0xFFB91C1C) : const Color(0xFF1E3A8A),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                TextButton.icon(
                  onPressed: task.status == 'todo' ? () => onStatusChange('in_progress') : () => onStatusChange('todo'),
                  icon: const Icon(Icons.play_arrow_outlined, size: 16),
                  label: Text(task.status == 'todo' ? 'Start' : 'To-do'),
                ),
                TextButton.icon(
                  onPressed: task.isDone ? () => onStatusChange('todo') : () => onStatusChange('done'),
                  icon: Icon(task.isDone ? Icons.undo_outlined : Icons.check_circle_outline, size: 16),
                  label: Text(task.isDone ? 'Reopen' : 'Done'),
                ),
                TextButton.icon(
                  onPressed: () => onStatusChange('snoozed'),
                  icon: const Icon(Icons.snooze_outlined, size: 16),
                  label: const Text('Snooze 2h'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
