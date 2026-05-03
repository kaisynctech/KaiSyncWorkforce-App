import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../providers/job_provider.dart';
import '../providers/timesheet_provider.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../models/employee.dart';
import '../models/app_message.dart';
import '../models/leave_request.dart';
import '../models/message_thread.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/notifications_sheet.dart';
import '../widgets/app_feedback.dart';
import 'employee_punch_screen.dart';
import 'employee_company_selector_screen.dart';
import 'my_jobs_screen.dart';
import 'my_incidents_screen.dart';
import 'my_shifts_screen.dart';
import 'employee_notifications_section.dart';
import 'employee_contractor_admin_section.dart';
import 'my_pa_section.dart';
import 'employee_thread_chat_screen.dart';
import 'employee_my_teams_screen.dart';
import '_dashboard_decorators.dart';

enum EmployeeSection {
  dashboard,
  activities,
  shifts,
  jobs,
  incidents,
  myTeams,
  myPa,
  leave,
  messages,
  notifications,
  contractorAdmin,
}

class EmployeeDashboardShell extends StatefulWidget {
  const EmployeeDashboardShell({super.key});

  @override
  State<EmployeeDashboardShell> createState() => _EmployeeDashboardShellState();
}

class _EmployeeDashboardShellState extends State<EmployeeDashboardShell> {
  EmployeeSection _selected = EmployeeSection.dashboard;
  /// When set, [EmployeeMessagesSection] opens a direct thread with this employee.
  String? _pendingMessagesPeerEmployeeId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final timesheet = context.read<TimesheetProvider>();
      context.read<JobProvider>()
        ..setCompanyId(timesheet.currentCompanyId)
        ..setEmployeeId(timesheet.currentEmployee?.id);
      final empId = timesheet.currentEmployee?.id;
      if (empId != null) {
        unawaited(
          timesheet.loadEmployees(
            actingEmployeeId: empId,
            silent: true,
          ),
        );
        context.read<JobProvider>().loadMyJobs(empId);
        final companyId = timesheet.currentCompanyId;
        if (companyId != null) {
          SupabaseTimesheetStorage.enqueuePaTaskNotifications(
            companyId: companyId,
          );
          SupabaseTimesheetStorage.dispatchNotificationDeliveries(
            companyId: companyId,
          );
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final isWide = Responsive.isDesktop(context);
    final isTinyPhone = Responsive.isTinyPhone(context);
    final workerType = prov.currentEmployee?.workerType ?? WorkerType.employee;
    final shellTitle = workerType == WorkerType.employee
        ? 'Employee'
        : 'Contractor';

    if (prov.currentEmployee == null) {
      return const EmployeePunchScreen();
    }

    final content = _buildContent();

    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
        title: Text(
          shellTitle,
          style: GoogleFonts.poppins(
            fontWeight: FontWeight.w600,
            fontSize: isTinyPhone ? 18 : 20,
          ),
        ),
        actions: [
          Builder(
            builder: (context) {
              final companyId = prov.currentCompanyId;
              final employeeId = prov.currentEmployee?.id;
              if (companyId == null || employeeId == null)
                return const SizedBox.shrink();
              return FutureBuilder<int>(
                future: SupabaseTimesheetStorage.getUnreadNotificationsCount(
                  companyId: companyId,
                  employeeId: employeeId,
                ),
                builder: (context, snap) {
                  final unread = snap.data ?? 0;
                  return IconButton(
                    tooltip: 'Notifications',
                    onPressed: () => showModalBottomSheet<void>(
                      context: context,
                      isScrollControlled: true,
                      builder: (_) => SizedBox(
                        height: MediaQuery.of(context).size.height * 0.72,
                        child: NotificationsSheet(
                          companyId: companyId,
                          employeeId: employeeId,
                        ),
                      ),
                    ),
                    icon: Badge.count(
                      isLabelVisible: unread > 0,
                      count: unread,
                      child: const Icon(Icons.notifications_none),
                    ),
                  );
                },
              );
            },
          ),
          Builder(
            builder: (context) {
              final companyName = prov.currentCompanyName;
              if (companyName == null || companyName.isEmpty)
                return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(right: 12),
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEFF4FF),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: const Color(0xFFD1D5DB)),
                    ),
                    child: Text(
                      companyName,
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF374151),
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ],
        leading: isWide
            ? null
            : Builder(
                builder: (innerContext) => IconButton(
                  icon: const Icon(Icons.menu, color: AppTheme.gold),
                  onPressed: () => Scaffold.of(innerContext).openDrawer(),
                ),
              ),
      ),
      drawer: isWide
          ? null
          : Drawer(
              child: SafeArea(
                child: _EmployeeSidebar(
                  selected: _selected,
                  onSelected: (s) {
                    setState(() => _selected = s);
                    Navigator.of(context).pop();
                  },
                ),
              ),
            ),
      body: isWide
          ? Row(
              children: [
                _EmployeeSidebar(
                  selected: _selected,
                  onSelected: (s) => setState(() => _selected = s),
                ),
                Expanded(child: content),
              ],
            )
          : content,
    );
  }

  Widget _buildContent() {
    switch (_selected) {
      case EmployeeSection.dashboard:
        return const EmployeePunchScreen(embedded: true);
      case EmployeeSection.activities:
        return const EmployeePunchScreen(
          embedded: true,
          forceActivitiesOnly: true,
        );
      case EmployeeSection.jobs:
        return const MyJobsScreen(embedded: true);
      case EmployeeSection.incidents:
        return const MyIncidentsScreen();
      case EmployeeSection.myTeams:
        return const EmployeeMyTeamsScreen();
      case EmployeeSection.myPa:
        return const MyPaSection(employeeMode: true);
      case EmployeeSection.leave:
        return const EmployeeLeaveSection();
      case EmployeeSection.messages:
        return EmployeeMessagesSection(
          initialDirectPeerEmployeeId: _pendingMessagesPeerEmployeeId,
          onInitialDirectPeerConsumed: () {
            if (_pendingMessagesPeerEmployeeId != null) {
              setState(() => _pendingMessagesPeerEmployeeId = null);
            }
          },
        );
      case EmployeeSection.shifts:
        return const MyShiftsScreen(embedded: true);
      case EmployeeSection.notifications:
        return const EmployeeNotificationsSection();
      case EmployeeSection.contractorAdmin:
        return const EmployeeContractorAdminSection();
    }
  }
}

class _EmployeeSidebar extends StatelessWidget {
  final EmployeeSection selected;
  final ValueChanged<EmployeeSection> onSelected;

  const _EmployeeSidebar({required this.selected, required this.onSelected});

  @override
  Widget build(BuildContext context) {
    final emp = context.watch<TimesheetProvider>().currentEmployee;
    return Container(
      width: Responsive.sidebarWidth(context),
      decoration: BoxDecoration(
        color: const Color(0xFFE5EDFF),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 20,
            offset: const Offset(2, 0),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: AppTheme.gold.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(
                    Icons.access_time_rounded,
                    color: AppTheme.gold,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'KaiSync Workforce',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF111827),
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        emp != null
                            ? (emp.workerType == WorkerType.employee
                                  ? 'Employee: ${emp.fullName}'
                                  : 'Contractor: ${emp.fullName}')
                            : 'Employee:',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF111827),
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Builder(
                        builder: (context) {
                          final companyName = context
                              .watch<TimesheetProvider>()
                              .currentCompanyName;
                          if (companyName == null || companyName.isEmpty)
                            return const SizedBox.shrink();
                          return Text(
                            companyName,
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF6B7280),
                              fontSize: 11,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 6),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                _SectionTitle('Workspace'),
                _NavItem(
                  icon: Icons.dashboard_outlined,
                  label: 'Dashboard',
                  active: selected == EmployeeSection.dashboard,
                  onTap: () => onSelected(EmployeeSection.dashboard),
                ),
                _NavItem(
                  icon: Icons.notifications_none,
                  label: 'Notifications',
                  active: selected == EmployeeSection.notifications,
                  onTap: () => onSelected(EmployeeSection.notifications),
                ),
                _NavItem(
                  icon: Icons.history_outlined,
                  label: 'Activities',
                  active: selected == EmployeeSection.activities,
                  onTap: () => onSelected(EmployeeSection.activities),
                ),
                _NavItem(
                  icon: Icons.event_available_outlined,
                  label: 'Shifts',
                  active: selected == EmployeeSection.shifts,
                  onTap: () => onSelected(EmployeeSection.shifts),
                ),
                _NavItem(
                  icon: Icons.work_outline,
                  label: 'Jobs',
                  active: selected == EmployeeSection.jobs,
                  onTap: () => onSelected(EmployeeSection.jobs),
                ),
                _NavItem(
                  icon: Icons.report_outlined,
                  label: 'Incidents',
                  active: selected == EmployeeSection.incidents,
                  onTap: () => onSelected(EmployeeSection.incidents),
                ),
                _NavItem(
                  icon: Icons.groups_outlined,
                  label: 'Teams',
                  active: selected == EmployeeSection.myTeams,
                  onTap: () => onSelected(EmployeeSection.myTeams),
                ),
                _NavItem(
                  icon: Icons.assistant_navigation,
                  label: 'My PA',
                  active: selected == EmployeeSection.myPa,
                  onTap: () => onSelected(EmployeeSection.myPa),
                ),
                _NavItem(
                  icon: Icons.event_note_outlined,
                  label: 'Leave',
                  active: selected == EmployeeSection.leave,
                  onTap: () => onSelected(EmployeeSection.leave),
                ),
                _NavItem(
                  icon: Icons.forum_outlined,
                  label: 'Messages',
                  active: selected == EmployeeSection.messages,
                  onTap: () => onSelected(EmployeeSection.messages),
                ),
                if (emp?.workerType == WorkerType.contractor ||
                    emp?.workerType == WorkerType.subcontractor)
                  _NavItem(
                    icon: Icons.manage_accounts_outlined,
                    label: 'Contractor Admin',
                    active: selected == EmployeeSection.contractorAdmin,
                    onTap: () => onSelected(EmployeeSection.contractorAdmin),
                  ),
                const SizedBox(height: 10),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Builder(
              builder: (context) {
                final hasMultiple =
                    context
                        .watch<TimesheetProvider>()
                        .employeeCompanies
                        .length >
                    1;
                if (!hasMultiple) return const SizedBox.shrink();
                return OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF2563EB),
                    side: const BorderSide(color: Color(0xFF2563EB)),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(30),
                    ),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    minimumSize: const Size(double.infinity, 0),
                  ),
                  onPressed: () => Navigator.of(context).pushReplacement(
                    MaterialPageRoute(
                      builder: (_) => const EmployeeCompanySelectorScreen(),
                    ),
                  ),
                  icon: const Icon(Icons.swap_horiz_rounded, size: 18),
                  label: Text(
                    'Switch company',
                    style: GoogleFonts.poppins(fontSize: 12),
                  ),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF6B7280),
                side: const BorderSide(color: Color(0xFFD1D5DB)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(30),
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
              ),
              onPressed: () async {
                await context.read<TimesheetProvider>().signOutEmployee();
                if (!context.mounted) return;
                Navigator.of(context).popUntil((r) => r.isFirst);
              },
              icon: const Icon(Icons.logout, size: 18),
              label: Text('Sign out', style: GoogleFonts.poppins(fontSize: 12)),
            ),
          ),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  const _NavItem({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: ListTile(
        dense: true,
        leading: Icon(
          icon,
          size: 20,
          color: active ? AppTheme.gold : const Color(0xFF9CA3AF),
        ),
        title: Text(
          label,
          style: GoogleFonts.poppins(
            color: active ? const Color(0xFF111827) : const Color(0xFF6B7280),
            fontSize: 13,
            fontWeight: active ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        tileColor: active ? const Color(0xFFF3F4FF) : Colors.transparent,
        onTap: onTap,
      ),
    );
  }
}

Employee? _resolveHrOrManagerContact(List<Employee> directory, Employee me) {
  Employee? contact;
  for (final e in directory) {
    if (e.accessLevel == EmployeeAccessLevel.hrAdmin) {
      contact = e;
      break;
    }
  }
  if (contact == null) {
    for (final e in directory) {
      if (e.accessLevel == EmployeeAccessLevel.manager) {
        contact = e;
        break;
      }
    }
  }
  if (contact == null || contact.id == me.id) return null;
  return contact;
}

class _SectionTitle extends StatelessWidget {
  final String label;
  const _SectionTitle(this.label);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 6),
      child: Text(
        label.toUpperCase(),
        style: GoogleFonts.poppins(
          color: AppTheme.textGray.withValues(alpha: 0.7),
          fontSize: 10,
          letterSpacing: 0.8,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class EmployeeMessagesSection extends StatefulWidget {
  final String? initialDirectPeerEmployeeId;
  final VoidCallback? onInitialDirectPeerConsumed;

  const EmployeeMessagesSection({
    super.key,
    this.initialDirectPeerEmployeeId,
    this.onInitialDirectPeerConsumed,
  });

  @override
  State<EmployeeMessagesSection> createState() =>
      _EmployeeMessagesSectionState();
}

class _EmployeeMessagesSectionState extends State<EmployeeMessagesSection>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final TextEditingController _msgCtrl = TextEditingController();
  final TextEditingController _peopleSearchCtrl = TextEditingController();
  Timer? _companyFeedReadTimer;
  bool _sending = false;
  bool _loading = true;
  String? _loadError;
  List<MessageThread> _threads = const [];
  Map<String, String> _peerToThread = const {};
  Map<String, int> _unreadByThread = const {};
  int _feedUnread = 0;
  bool _initialPeerHandled = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(_onTabChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  void _onTabChanged() {
    if (_tabController.indexIsChanging) {
      return;
    }
    _companyFeedReadTimer?.cancel();
    setState(() {});
    if (_tabController.index == 0) {
      _companyFeedReadTimer = Timer(const Duration(milliseconds: 900), () {
        if (!mounted || _tabController.index != 0) {
          return;
        }
        _markCompanyFeedReadQuiet();
      });
    }
  }

  Future<void> _markCompanyFeedReadQuiet() async {
    final prov = context.read<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final me = prov.currentEmployee;
    if (companyId == null || me == null) {
      return;
    }
    await SupabaseTimesheetStorage.markCompanyFeedRead(
      companyId: companyId,
      employeeId: me.id,
    );
    await _load();
  }

  @override
  void didUpdateWidget(EmployeeMessagesSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialDirectPeerEmployeeId != null &&
        widget.initialDirectPeerEmployeeId !=
            oldWidget.initialDirectPeerEmployeeId) {
      _initialPeerHandled = false;
      WidgetsBinding.instance
          .addPostFrameCallback((_) => _openInitialDirectChat());
    }
  }

  Future<void> _load() async {
    final prov = context.read<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final me = prov.currentEmployee;
    if (companyId == null || me == null) {
      if (mounted) {
        setState(() {
          _loading = false;
          _loadError = 'Not signed in.';
        });
      }
      return;
    }
    if (mounted) {
      setState(() {
        if (_threads.isEmpty) {
          _loading = true;
        }
        _loadError = null;
      });
    }
    try {
      final threads = await SupabaseTimesheetStorage.getMessageThreads(
        companyId: companyId,
        currentEmployeeId: me.id,
      );
      final peerToThread =
          await SupabaseTimesheetStorage.getDirectPeerToThreadMap(
        companyId: companyId,
        myEmployeeId: me.id,
      );
      final teamThreadIds =
          threads.where((t) => t.isGroup).map((t) => t.id).toList();
      final allThreadIds = <String>{
        ...peerToThread.values,
        ...teamThreadIds,
      }.toList();
      final unread =
          await SupabaseTimesheetStorage.getMessageUnreadCountsForThreads(
        companyId: companyId,
        employeeId: me.id,
        threadIds: allThreadIds,
      );
      final feedUnread =
          await SupabaseTimesheetStorage.getCompanyFeedUnreadCount(
        companyId: companyId,
        employeeId: me.id,
      );
      if (!mounted) {
        return;
      }
      setState(() {
        _threads = threads;
        _peerToThread = peerToThread;
        _unreadByThread = unread;
        _feedUnread = feedUnread;
        _loading = false;
      });
      if (!_initialPeerHandled &&
          widget.initialDirectPeerEmployeeId != null) {
        await _openInitialDirectChat();
      }
    } catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _loadError = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _openInitialDirectChat() async {
    if (_initialPeerHandled) {
      return;
    }
    final id = widget.initialDirectPeerEmployeeId;
    if (id == null) {
      return;
    }
    final prov = context.read<TimesheetProvider>();
    final me = prov.currentEmployee;
    final companyId = prov.currentCompanyId;
    if (me == null || companyId == null) {
      return;
    }
    Employee? peer;
    for (final e in prov.employees) {
      if (e.id == id) {
        peer = e;
        break;
      }
    }
    if (peer == null) {
      if (mounted) {
        showErrorSnack(
          context,
          'Could not find that colleague in your company directory.',
        );
        widget.onInitialDirectPeerConsumed?.call();
      }
      return;
    }
    final peerResolved = peer;
    final threadId =
        await SupabaseTimesheetStorage.getOrCreateDirectThreadEmployeePeer(
      companyId: companyId,
      fromEmployeeId: me.id,
      toEmployeeId: peerResolved.id,
      threadTitle: peerResolved.fullName,
    );
    if (!mounted) {
      return;
    }
    if (threadId == null) {
      showErrorSnack(context, 'Could not open chat.');
      widget.onInitialDirectPeerConsumed?.call();
      return;
    }
    _initialPeerHandled = true;
    widget.onInitialDirectPeerConsumed?.call();
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => EmployeeThreadChatScreen(
          companyId: companyId,
          threadId: threadId,
          title: peerResolved.fullName,
          actingEmployeeId: me.id,
        ),
      ),
    );
    if (mounted) {
      await _load();
    }
  }

  @override
  void dispose() {
    _companyFeedReadTimer?.cancel();
    _tabController.removeListener(_onTabChanged);
    _tabController.dispose();
    _msgCtrl.dispose();
    _peopleSearchCtrl.dispose();
    super.dispose();
  }

  Future<void> _sendCompanyFeed(TimesheetProvider prov) async {
    final companyId = prov.currentCompanyId;
    final employeeId = prov.currentEmployee?.id;
    if (companyId == null || employeeId == null) {
      return;
    }
    final body = _msgCtrl.text.trim();
    if (body.isEmpty) {
      return;
    }
    setState(() => _sending = true);
    try {
      await SupabaseTimesheetStorage.sendCompanyMessage(
        companyId: companyId,
        senderEmployeeId: employeeId,
        body: body,
      );
      if (!mounted) {
        return;
      }
      _msgCtrl.clear();
      await _load();
    } catch (e) {
      if (!mounted) {
        return;
      }
      showErrorSnack(context, e.toString());
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  Widget _unreadChip(int count) {
    if (count <= 0) {
      return const SizedBox.shrink();
    }
    final label = count > 99 ? '99+' : '$count';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0xFF25D366),
        borderRadius: BorderRadius.circular(11),
      ),
      child: Text(
        label,
        style: GoogleFonts.poppins(
          color: Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  int _directTabUnreadTotal() {
    var sum = 0;
    for (final tid in _peerToThread.values) {
      sum += _unreadByThread[tid] ?? 0;
    }
    return sum;
  }

  int _teamsTabUnreadTotal() {
    var sum = 0;
    for (final t in _threads.where((x) => x.isGroup)) {
      sum += _unreadByThread[t.id] ?? 0;
    }
    return sum;
  }

  int _unreadForPeer(String peerEmployeeId) {
    final tid = _peerToThread[peerEmployeeId];
    if (tid == null) {
      return 0;
    }
    return _unreadByThread[tid] ?? 0;
  }

  Widget _messageListCard({
    required Future<List<AppMessage>> future,
    required Map<String, Employee> employeesById,
    required String emptyLabel,
    required String myEmployeeId,
  }) {
    return FutureBuilder<List<AppMessage>>(
      future: future,
      builder: (context, msgSnap) {
        final rows = msgSnap.data ?? const <AppMessage>[];
        if (msgSnap.connectionState == ConnectionState.waiting &&
            !msgSnap.hasData) {
          return const Card(
            child: Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: CircularProgressIndicator(),
              ),
            ),
          );
        }
        return Card(
          clipBehavior: Clip.antiAlias,
          child: rows.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      emptyLabel,
                      textAlign: TextAlign.center,
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF6B7280),
                        fontSize: 13,
                      ),
                    ),
                  ),
                )
              : ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: rows.length,
                  itemBuilder: (_, i) {
                    final m = rows[i];
                    final sender = m.senderEmployeeId != null
                        ? (employeesById[m.senderEmployeeId]?.fullName ??
                              'Employee ${m.senderEmployeeId}')
                        : 'HR';
                    final mine = m.senderEmployeeId == myEmployeeId;
                    return ListTile(
                      dense: true,
                      title: Text(sender),
                      subtitle: Text(m.body),
                      trailing: Text(
                        DateFormat('dd MMM HH:mm').format(m.createdAt),
                        style: GoogleFonts.poppins(
                          fontSize: 11,
                          color: const Color(0xFF6B7280),
                        ),
                      ),
                      tileColor: mine ? const Color(0xFFF3F4FF) : null,
                    );
                  },
                ),
        );
      },
    );
  }

  Tab _tabWithBadge(String label, int unread) {
    return Tab(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label),
          if (unread > 0) ...[
            const SizedBox(width: 6),
            _unreadChip(unread),
          ],
        ],
      ),
    );
  }

  Future<void> _openDirectChat(Employee peer, String companyId, String meId) async {
    final threadId =
        await SupabaseTimesheetStorage.getOrCreateDirectThreadEmployeePeer(
      companyId: companyId,
      fromEmployeeId: meId,
      toEmployeeId: peer.id,
      threadTitle: peer.fullName,
    );
    if (!mounted || threadId == null) {
      return;
    }
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => EmployeeThreadChatScreen(
          companyId: companyId,
          threadId: threadId,
          title: peer.fullName,
          actingEmployeeId: meId,
        ),
      ),
    );
    if (mounted) {
      await _load();
    }
  }

  Future<void> _openTeamChat(
    MessageThread thread,
    String companyId,
    String actingEmployeeId,
  ) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => EmployeeThreadChatScreen(
          companyId: companyId,
          threadId: thread.id,
          title: thread.title,
          actingEmployeeId: actingEmployeeId,
        ),
      ),
    );
    if (mounted) {
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final me = prov.currentEmployee;
    if (companyId == null || me == null) {
      return const SizedBox.shrink();
    }
    final employeesById = {for (final e in prov.employees) e.id: e};
    final pinnedContact = _resolveHrOrManagerContact(prov.employees, me);
    final others = prov.employees
        .where(
          (e) =>
              e.id != me.id &&
              (pinnedContact == null || e.id != pinnedContact.id),
        )
        .toList()
      ..sort(
        (a, b) => a.fullName.toLowerCase().compareTo(b.fullName.toLowerCase()),
      );
    final q = _peopleSearchCtrl.text.trim().toLowerCase();
    final filteredPeople = q.isEmpty
        ? others
        : others
              .where(
                (e) =>
                    e.fullName.toLowerCase().contains(q) ||
                    e.employeeCode.toLowerCase().contains(q),
              )
              .toList();
    final teamThreads = _threads.where((t) => t.isGroup).toList()
      ..sort(
        (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
      );

    if (_loading && _threads.isEmpty && _loadError == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_loadError != null && !_loading) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _loadError!,
            style: GoogleFonts.poppins(color: const Color(0xFFB91C1C)),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    Widget companyFeedTab() {
      return RefreshIndicator(
        onRefresh: _load,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
              child: Text(
                'Company announcements — visible to everyone in your company.',
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  color: const Color(0xFF6B7280),
                ),
              ),
            ),
            Expanded(
              child: _messageListCard(
                future: SupabaseTimesheetStorage.getCompanyMessages(
                  companyId: companyId,
                  actingEmployeeId: me.id,
                ),
                employeesById: employeesById,
                emptyLabel: 'No announcements yet.',
                myEmployeeId: me.id,
              ),
            ),
          ],
        ),
      );
    }

    Widget directListTab() {
      return RefreshIndicator(
        onRefresh: _load,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _peopleSearchCtrl,
              decoration: InputDecoration(
                hintText: 'Search people',
                prefixIcon: const Icon(Icons.search, size: 20),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                isDense: true,
              ),
              onChanged: (_) => setState(() {}),
            ),
            if (pinnedContact != null) ...[
              const SizedBox(height: 10),
              Card(
                elevation: 0,
                color: const Color(0xFFEFF4FF),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: const BorderSide(color: Color(0xFFC7D2FE)),
                ),
                child: ListTile(
                  dense: true,
                  leading: const CircleAvatar(
                    backgroundColor: Color(0xFFE0E7FF),
                    child: Icon(
                      Icons.support_agent_outlined,
                      color: Color(0xFF1E3A8A),
                    ),
                  ),
                  title: Text(
                    pinnedContact.accessLevel == EmployeeAccessLevel.hrAdmin
                        ? 'Message HR'
                        : 'Message your manager',
                    style: GoogleFonts.poppins(
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                  ),
                  subtitle: Text(
                    pinnedContact.fullName,
                    style: GoogleFonts.poppins(
                      fontSize: 12,
                      color: const Color(0xFF64748B),
                    ),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () =>
                      _openDirectChat(pinnedContact, companyId, me.id),
                ),
              ),
            ],
            const SizedBox(height: 8),
            Expanded(
              child: filteredPeople.isEmpty
                  ? Center(
                      child: Text(
                        others.isEmpty
                            ? 'No other colleagues listed yet.'
                            : 'No people match your search.',
                        textAlign: TextAlign.center,
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF6B7280),
                          fontSize: 12,
                        ),
                      ),
                    )
                  : ListView.separated(
                      itemCount: filteredPeople.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final e = filteredPeople[i];
                        final unread = _unreadForPeer(e.id);
                        return ListTile(
                          dense: true,
                          leading: CircleAvatar(
                            radius: 22,
                            backgroundColor: AppTheme.gold.withValues(
                              alpha: 0.15,
                            ),
                            child: Text(
                              e.fullName.isNotEmpty
                                  ? e.fullName[0].toUpperCase()
                                  : '?',
                              style: GoogleFonts.poppins(
                                fontWeight: FontWeight.w600,
                                color: AppTheme.gold,
                              ),
                            ),
                          ),
                          title: Text(
                            e.fullName,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            e.position.isNotEmpty
                                ? e.position
                                : (e.employeeCode.isNotEmpty
                                      ? e.employeeCode
                                      : 'Colleague'),
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              _unreadChip(unread),
                              const Icon(Icons.chevron_right,
                                  color: Color(0xFF9CA3AF)),
                            ],
                          ),
                          onTap: () => _openDirectChat(e, companyId, me.id),
                        );
                      },
                    ),
            ),
          ],
        ),
      );
    }

    Widget teamsListTab() {
      return RefreshIndicator(
        onRefresh: _load,
        child: teamThreads.isEmpty
            ? Center(
                child: Text(
                  'You are not in any teams yet. Job crew chats appear here when HR links a job to a team channel.',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.poppins(
                    color: const Color(0xFF6B7280),
                    fontSize: 12,
                  ),
                ),
              )
            : ListView.separated(
                itemCount: teamThreads.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (_, i) {
                  final t = teamThreads[i];
                  final unread = _unreadByThread[t.id] ?? 0;
                  return ListTile(
                    dense: true,
                    leading: Icon(
                      Icons.groups_outlined,
                      color: AppTheme.gold.withValues(alpha: 0.85),
                    ),
                    title: Text(
                      t.title,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: (t.jobId ?? '').isNotEmpty
                        ? Text(
                            'Job team chat',
                            style: GoogleFonts.poppins(
                              fontSize: 11,
                              color: const Color(0xFF6B7280),
                            ),
                          )
                        : null,
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _unreadChip(unread),
                        const Icon(Icons.chevron_right,
                            color: Color(0xFF9CA3AF)),
                      ],
                    ),
                    onTap: () => _openTeamChat(t, companyId, me.id),
                  );
                },
              ),
      );
    }

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PremiumSectionHeader(
            icon: Icons.forum_outlined,
            title: 'Messages',
            subtitle:
                'Announcements, direct chats, and team channels (including job crew chats).',
          ),
          const SizedBox(height: 8),
          TabBar(
            controller: _tabController,
            labelColor: AppTheme.gold,
            unselectedLabelColor: const Color(0xFF6B7280),
            indicatorColor: AppTheme.gold,
            isScrollable: true,
            tabs: [
              _tabWithBadge('Company feed', _feedUnread),
              _tabWithBadge('Direct messages', _directTabUnreadTotal()),
              _tabWithBadge('Teams', _teamsTabUnreadTotal()),
            ],
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                companyFeedTab(),
                directListTab(),
                teamsListTab(),
              ],
            ),
          ),
          if (_tabController.index == 0) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _msgCtrl,
                    minLines: 1,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Reply on the company feed…',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  onPressed: _sending ? null : () => _sendCompanyFeed(prov),
                  icon: const Icon(Icons.send_outlined, size: 16),
                  label: const Text('Send'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class EmployeeLeaveSection extends StatefulWidget {
  const EmployeeLeaveSection({super.key});

  @override
  State<EmployeeLeaveSection> createState() => _EmployeeLeaveSectionState();
}

class _EmployeeLeaveSectionState extends State<EmployeeLeaveSection> {
  bool _loading = false;
  String? _error;
  List<LeaveRequest> _requests = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final prov = context.read<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final employeeId = prov.currentEmployee?.id;
    if (companyId == null || employeeId == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await SupabaseTimesheetStorage.getLeaveRequests(
        companyId: companyId,
        employeeId: employeeId,
      );
      if (!mounted) return;
      setState(() => _requests = rows);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submit() async {
    final prov = context.read<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final employeeId = prov.currentEmployee?.id;
    if (companyId == null || employeeId == null) return;
    DateTime start = DateTime.now();
    DateTime end = DateTime.now();
    String leaveType = 'annual';
    final reasonCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Apply for leave'),
          content: SizedBox(
            width: 460,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: leaveType,
                  items: const [
                    DropdownMenuItem(value: 'annual', child: Text('Annual')),
                    DropdownMenuItem(value: 'sick', child: Text('Sick')),
                    DropdownMenuItem(
                      value: 'family',
                      child: Text('Family responsibility'),
                    ),
                    DropdownMenuItem(value: 'unpaid', child: Text('Unpaid')),
                    DropdownMenuItem(value: 'study', child: Text('Study')),
                    DropdownMenuItem(value: 'other', child: Text('Other')),
                  ],
                  onChanged: (v) => setLocal(() => leaveType = v ?? 'annual'),
                  decoration: const InputDecoration(labelText: 'Leave type'),
                ),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: start,
                      firstDate: DateTime.now().subtract(
                        const Duration(days: 365),
                      ),
                      lastDate: DateTime.now().add(const Duration(days: 730)),
                    );
                    if (d == null) return;
                    setLocal(() {
                      start = DateTime(d.year, d.month, d.day);
                      if (end.isBefore(start)) end = start;
                    });
                  },
                  child: Text(
                    'Start date: ${DateFormat('dd MMM yyyy').format(start)}',
                  ),
                ),
                OutlinedButton(
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: end,
                      firstDate: start,
                      lastDate: DateTime.now().add(const Duration(days: 730)),
                    );
                    if (d == null) return;
                    setLocal(() => end = DateTime(d.year, d.month, d.day));
                  },
                  child: Text(
                    'End date: ${DateFormat('dd MMM yyyy').format(end)}',
                  ),
                ),
                TextField(
                  controller: reasonCtrl,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: 'Reason (optional)',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Submit'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    await SupabaseTimesheetStorage.submitLeaveRequest(
      companyId: companyId,
      employeeId: employeeId,
      leaveType: leaveType,
      startDate: start,
      endDate: end,
      reason: reasonCtrl.text,
    );
    await _load();
    if (!mounted) return;
    showSuccessSnack(context, 'Leave request submitted.');
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Text(
                'Leave',
                style: GoogleFonts.poppins(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              ElevatedButton.icon(
                onPressed: _submit,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Apply'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_loading) const Center(child: CircularProgressIndicator()),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                _error!,
                style: GoogleFonts.poppins(color: const Color(0xFFB91C1C)),
              ),
            ),
          ..._requests.map(
            (r) => Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: ListTile(
                title: Text(
                  '${r.leaveType.toUpperCase()} • ${DateFormat('dd MMM').format(r.startDate)} - ${DateFormat('dd MMM').format(r.endDate)}',
                ),
                subtitle: Text(
                  (r.reason ?? '').trim().isEmpty
                      ? 'No reason provided'
                      : r.reason!.trim(),
                ),
                trailing: Text(
                  r.status.toUpperCase(),
                  style: GoogleFonts.poppins(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
