import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '_dashboard_decorators.dart';
import '../models/employee.dart';
import '../models/app_message.dart';
import '../models/leave_request.dart';
import '../models/message_thread.dart';
import '../models/punch_session.dart';
import '../models/time_punch.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/load_error_panel.dart';
import '../widgets/notifications_sheet.dart';
import '../widgets/app_feedback.dart';
import '../services/app_telemetry.dart';
import '../services/app_update_service.dart';
import '../services/export_service.dart';
import 'paperless_ops_screen.dart';
import 'hr_scheduling_screen.dart';
import 'id_entry_screen.dart';
import 'hr_employees_section.dart';
import 'hr_settings_section.dart';
import 'hr_jobs_section.dart';
import 'hr_payments_section.dart';
import 'hr_attendance_section.dart';
import 'hr_reports_section.dart';
import 'hr_incidents_section.dart';
import 'hr_inventory_section.dart';
import 'hr_clients_section.dart';
import 'hr_contractors_section.dart';
import 'hr_notifications_section.dart';
import 'hr_property_management_hub.dart';
import 'my_pa_section.dart';

class EmployerDashboardScreen extends StatefulWidget {
  const EmployerDashboardScreen({super.key});

  @override
  State<EmployerDashboardScreen> createState() =>
      _EmployerDashboardScreenState();
}

class _EmployerDashboardScreenState extends State<EmployerDashboardScreen> {
  final DateTime _rangeStart = DateTime(
    DateTime.now().year,
    DateTime.now().month,
    1,
  );
  final DateTime _rangeEnd = DateTime.now();
  DateTime _dailyDate = DateTime.now();
  DashboardSection _selectedSection = DashboardSection.dashboard;
  String? _companyCode;
  String? _companyName;
  List<String> _managedBranches = const [];
  String _currentHrRole = 'viewer';
  bool _scheduledUpdatePrompt = false;

  static final _dateFormat = DateFormat('MMM d, y');
  static final _timeFormat = DateFormat('h:mm a');

  bool get _canViewSensitiveData =>
      _currentHrRole == 'admin' || _currentHrRole == 'owner';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final prov = context.read<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    if (companyId != null) {
      _companyCode = await SupabaseTimesheetStorage.getCompanyCodeById(
        companyId,
      );
      _companyName = await SupabaseTimesheetStorage.getCompanyNameById(
        companyId,
      );
      _managedBranches = await SupabaseTimesheetStorage.getCompanyBranches(
        companyId: companyId,
      );
      final profile = await SupabaseTimesheetStorage.getCurrentHrProfile();
      _currentHrRole = profile?.role ?? 'viewer';
    }
    // Load module flags so the sidebar can gate sections.
    await prov.loadEnabledModules();
    try {
      await SupabaseTimesheetStorage.enqueueDailyOperationalReminders();
      if (companyId != null) {
        await SupabaseTimesheetStorage.syncOperationalPaTasks(
          companyId: companyId,
        );
        await SupabaseTimesheetStorage.publishPendingRemindersAsNotifications(
          companyId: companyId,
        );
        await SupabaseTimesheetStorage.emitSlaBreachNotifications(
          companyId: companyId,
        );
        await SupabaseTimesheetStorage.enqueuePaTaskNotifications(
          companyId: companyId,
        );
        await SupabaseTimesheetStorage.dispatchNotificationDeliveries(
          companyId: companyId,
        );
      }
    } catch (_) {}
    await prov.loadEmployees();
    final endOfRange = DateTime(
      _rangeEnd.year,
      _rangeEnd.month,
      _rangeEnd.day,
      23,
      59,
      59,
    );
    await prov.loadAllPunches(from: _rangeStart, to: endOfRange);
    if (mounted) setState(() {});
    if (mounted && !_scheduledUpdatePrompt) {
      _scheduledUpdatePrompt = true;
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (!mounted) return;
        await AppUpdateService.maybePromptForUpdate(context);
      });
    }
  }

  Future<void> _signOutToHome() async {
    try {
      await SupabaseTimesheetStorage.signOutHr();
    } catch (_) {}
    if (!mounted) return;
    context.read<TimesheetProvider>().setCurrentCompanyId(null);
    await context.read<TimesheetProvider>().setCurrentEmployee(null);
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const IdEntryScreen()),
      (route) => false,
    );
  }

  Future<void> _runSystemCheck() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) {
      showErrorSnack(context, 'System check failed.\nNo company selected.');
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(
      const SnackBar(
        content: Text('Running system check...'),
        duration: Duration(seconds: 1),
      ),
    );
    final checks = await SupabaseTimesheetStorage.runEmployeeRpcHealthCheck(
      companyId: companyId,
    );
    if (!mounted) return;
    final failed = checks.where((c) => !c.ok).toList();
    if (failed.isNotEmpty) {
      AppTelemetry.logError(
        screen: 'employer_dashboard_screen',
        action: 'system_check_failed',
        error: failed.map((f) => '${f.name}: ${f.details}').join(' | '),
      );
      showErrorSnack(context, 'System check completed with failures.');
    } else {
      AppTelemetry.logInfo(
        screen: 'employer_dashboard_screen',
        action: 'system_check_passed',
      );
      showSuccessSnack(context, 'System check passed.');
    }
    Future<List<RpcHealthCheckResult>> runChecks() =>
        SupabaseTimesheetStorage.runEmployeeRpcHealthCheck(
          companyId: companyId,
        );
    var localChecks = checks;
    await showDialog<void>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) {
          return AlertDialog(
            title: Text(
              'System Check',
              style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
            ),
            content: SizedBox(
              width: 560,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: localChecks.map((c) {
                    final color = c.ok
                        ? const Color(0xFF059669)
                        : const Color(0xFFB91C1C);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            c.ok ? Icons.check_circle : Icons.error_outline,
                            color: color,
                            size: 18,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '${c.name}: ${c.details}',
                              style: GoogleFonts.poppins(
                                fontSize: 12,
                                color: const Color(0xFF111827),
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  }).toList(),
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () async {
                  final retried = await runChecks();
                  if (!mounted) return;
                  setLocal(() => localChecks = retried);
                },
                child: const Text('Retry checks'),
              ),
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Close'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _exportRows({
    required String fileName,
    required List<String> headers,
    required List<List<String>> rows,
    required ExportFormat format,
  }) async {
    try {
      await ExportService.exportTable(
        fileBaseName: fileName,
        headers: headers,
        rows: rows,
        format: format,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Export completed.');
    } catch (e) {
      AppTelemetry.logError(
        screen: 'employer_dashboard_screen',
        action: 'export',
        error: e,
      );
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Export failed.'),
      );
    }
  }

  Widget _buildExportButton({
    required String fileName,
    required List<String> headers,
    required List<List<String>> rows,
  }) {
    return PopupMenuButton<ExportFormat>(
      tooltip: 'Export',
      onSelected: (format) => _exportRows(
        fileName: fileName,
        headers: headers,
        rows: rows,
        format: format,
      ),
      itemBuilder: (context) => const [
        PopupMenuItem(value: ExportFormat.csv, child: Text('Export CSV')),
        PopupMenuItem(
          value: ExportFormat.excelCsv,
          child: Text('Export Excel (CSV)'),
        ),
        PopupMenuItem(value: ExportFormat.pdf, child: Text('Export PDF')),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: const Color(0xFFE5E7EB)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.download_outlined, size: 16, color: AppTheme.gold),
            const SizedBox(width: 6),
            Text(
              'Export',
              style: GoogleFonts.poppins(
                color: AppTheme.gold,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSessionsTable(
    List<PunchSession> sessions, {
    Map<String, Employee>? employeesById,
  }) {
    final isCompact = MediaQuery.of(context).size.width < 1200;
    if (sessions.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'No sessions in this period.',
          style: GoogleFonts.poppins(color: AppTheme.textGray),
        ),
      );
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingRowColor: WidgetStateProperty.all(const Color(0xFFF9FAFB)),
        headingTextStyle: GoogleFonts.poppins(
          color: const Color(0xFF111827),
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
        dataTextStyle: GoogleFonts.poppins(
          color: const Color(0xFF4B5563),
          fontSize: 11,
        ),
        columnSpacing: isCompact ? 14 : 28,
        headingRowHeight: isCompact ? 40 : 52,
        dataRowMinHeight: isCompact ? 38 : 46,
        dataRowMaxHeight: isCompact ? 52 : 64,
        dividerThickness: 0.4,
        columns: const [
          DataColumn(label: Text('Date')),
          DataColumn(label: Text('Full name')),
          DataColumn(label: Text('ID')),
          DataColumn(label: Text('Time In')),
          DataColumn(label: Text('Time Out')),
          DataColumn(label: Text('Regular hrs')),
          DataColumn(label: Text('Overtime hrs')),
          DataColumn(label: Text('Total hrs')),
          DataColumn(label: Text('In location')),
          DataColumn(label: Text('Out location')),
          DataColumn(label: Text('Notes')),
        ],
        rows: sessions.take(100).map((s) {
          final worker = employeesById?[s.employeeId];
          final isContractor =
              worker != null &&
              (worker.workerType == WorkerType.contractor ||
                  worker.workerType == WorkerType.subcontractor);
          return DataRow(
            cells: [
              DataCell(Text(_dateFormat.format(s.date))),
              DataCell(
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(s.fullName, overflow: TextOverflow.ellipsis),
                    ),
                    if (isContractor) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(
                            0xFF7C3AED,
                          ).withValues(alpha: 0.10 * 255),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.engineering_outlined,
                              size: 10,
                              color: Color(0xFF7C3AED),
                            ),
                            const SizedBox(width: 3),
                            Text(
                              worker.workerType == WorkerType.subcontractor
                                  ? 'Sub'
                                  : 'Contractor',
                              style: GoogleFonts.poppins(
                                color: const Color(0xFF7C3AED),
                                fontSize: 9,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              DataCell(Text(s.employeeId)),
              DataCell(
                Text(s.timeIn != null ? _timeFormat.format(s.timeIn!) : '—'),
              ),
              DataCell(
                Text(s.timeOut != null ? _timeFormat.format(s.timeOut!) : '—'),
              ),
              DataCell(Text(s.regularHours.toStringAsFixed(1))),
              DataCell(Text(s.overtimeHours.toStringAsFixed(1))),
              DataCell(Text(s.totalHours.toStringAsFixed(1))),
              DataCell(
                Text(
                  s.signInLocation?.trim().isNotEmpty == true
                      ? s.signInLocation!
                      : (s.signInLatitude != null
                            ? '${s.signInLatitude!.toStringAsFixed(5)}, ${s.signInLongitude!.toStringAsFixed(5)}'
                            : '—'),
                  overflow: TextOverflow.ellipsis,
                  maxLines: 2,
                ),
              ),
              DataCell(
                Text(
                  s.signOutLocation?.trim().isNotEmpty == true
                      ? s.signOutLocation!
                      : (s.signOutLatitude != null
                            ? '${s.signOutLatitude!.toStringAsFixed(5)}, ${s.signOutLongitude!.toStringAsFixed(5)}'
                            : '—'),
                  overflow: TextOverflow.ellipsis,
                  maxLines: 2,
                ),
              ),
              DataCell(
                Text(
                  s.notes ?? '—',
                  overflow: TextOverflow.ellipsis,
                  maxLines: 2,
                ),
              ),
            ],
          );
        }).toList(),
      ),
    );
  }

  Widget _buildDailyView(TimesheetProvider prov) {
    final dayStart = DateTime(
      _dailyDate.year,
      _dailyDate.month,
      _dailyDate.day,
    );
    final dayEnd = dayStart.add(const Duration(days: 1));
    return FutureBuilder<List<TimePunch>>(
      key: ValueKey('$_dailyDate'),
      future: SupabaseTimesheetStorage.getAllPunches(
        from: dayStart,
        to: dayEnd,
        companyId: context.read<TimesheetProvider>().currentCompanyId,
      ),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(
              snapshot.error,
              fallback: 'Could not load today punches.',
            ),
            onRetry: () => setState(() {}),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting &&
            !snapshot.hasData) {
          return const PremiumLoadingIndicator(label: 'Loading dashboard...');
        }
        final punches = snapshot.data!;
        final employees = {for (var e in prov.employees) e.id: e};
        final sessions = PunchSession.fromPunches(punches, employees);
        final sessionHeaders = [
          'Date',
          'Full name',
          'ID',
          'Time In',
          'Time Out',
          'Regular hrs',
          'Overtime hrs',
          'Total hrs',
          'In location',
          'Out location',
          'Notes',
        ];
        final sessionRows = sessions
            .map(
              (s) => [
                _dateFormat.format(s.date),
                s.fullName,
                s.employeeId,
                s.timeIn != null ? _timeFormat.format(s.timeIn!) : '—',
                s.timeOut != null ? _timeFormat.format(s.timeOut!) : '—',
                s.regularHours.toStringAsFixed(1),
                s.overtimeHours.toStringAsFixed(1),
                s.totalHours.toStringAsFixed(1),
                s.signInLocation ?? '—',
                s.signOutLocation ?? '—',
                s.notes ?? '—',
              ],
            )
            .toList();
        final sessionEmployeeIds = sessions.map((s) => s.employeeId).toSet();
        final missingEmployees =
            employees.values
                .where((e) => !sessionEmployeeIds.contains(e.id))
                .toList()
              ..sort((a, b) => a.fullName.compareTo(b.fullName));
        return SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    'Workforce overview',
                    style: GoogleFonts.poppins(
                      color: const Color(0xFF111827),
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  _buildExportButton(
                    fileName:
                        'daily_attendance_${DateFormat('yyyy_MM_dd').format(_dailyDate)}',
                    headers: sessionHeaders,
                    rows: sessionRows,
                  ),
                  const Spacer(),
                  OutlinedButton.icon(
                    onPressed: () async {
                      final d = await showDatePicker(
                        context: context,
                        initialDate: _dailyDate,
                        firstDate: DateTime(2020),
                        lastDate: DateTime.now(),
                      );
                      if (d != null) setState(() => _dailyDate = d);
                    },
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppTheme.gold),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30),
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                      foregroundColor: AppTheme.gold,
                    ),
                    icon: const Icon(Icons.calendar_today, size: 18),
                    label: Text(
                      _dateFormat.format(_dailyDate),
                      style: GoogleFonts.poppins(
                        color: AppTheme.gold,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Text(
                (prov.enabledModules['attendance'] ?? true)
                    ? 'Active attendance sessions: ${sessions.length}'
                    : 'People in workforce: ${prov.employees.length}',
                style: GoogleFonts.poppins(
                  color: const Color(0xFF475569),
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 12),
              Card(
                color: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 380),
                    child: _buildSessionsTable(
                      sessions,
                      employeesById: employees,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              if (missingEmployees.isNotEmpty) ...[
                Text(
                  'Employees who did not punch on this day',
                  style: GoogleFonts.poppins(
                    color: const Color(0xFF111827),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: missingEmployees.map((e) {
                    return Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: const Color(0xFFE5E7EB)),
                      ),
                      child: Text(
                        e.fullName,
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF6B7280),
                          fontSize: 12,
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _buildSectionContent(TimesheetProvider prov) {
    switch (_selectedSection) {
      case DashboardSection.dashboard:
        return _buildDailyView(prov);
      case DashboardSection.notifications:
        return const HrNotificationsSection();
      case DashboardSection.payments:
        if (!_canViewSensitiveData) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                'Payments are only available to HR Admin.',
                style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                textAlign: TextAlign.center,
              ),
            ),
          );
        }
        return const HrPaymentsSection();
      case DashboardSection.inventory:
        return const HrInventorySection();
      case DashboardSection.jobs:
        return const HrJobsSection();
      case DashboardSection.clients:
        return const HrClientsSection();
      case DashboardSection.attendance:
        return const HrAttendanceSection();
      case DashboardSection.reports:
        return const HrReportsSection();
      case DashboardSection.scheduling:
        return const HrSchedulingScreen(embedded: true);
      case DashboardSection.myPa:
        return const MyPaSection();
      case DashboardSection.leave:
        return const HrLeaveSection();
      case DashboardSection.messages:
        return const HrMessagesSection();
      case DashboardSection.incidents:
        return const HrIncidentsSection();
      case DashboardSection.employees:
        return HrEmployeesSection(
          canViewSensitiveData: _canViewSensitiveData,
          companyCode: _companyCode,
        );
      case DashboardSection.contractors:
        return const HrContractorsSection();
      case DashboardSection.propertyManagement:
        return const HrPropertyManagementHub();
      case DashboardSection.settings:
        return HrSettingsSection(
          canViewSensitiveData: _canViewSensitiveData,
          canTransferOwnership: _currentHrRole == 'owner',
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFE5EDFF),
      appBar: AppBar(
        backgroundColor: const Color(0xFFE5EDFF),
        elevation: 0,
        toolbarHeight: 0,
      ),
      drawer: Drawer(
        child: SafeArea(
          child: SizedBox(
            width: Responsive.sidebarWidth(context),
            child: Consumer<TimesheetProvider>(
              builder: (context, prov, _) => DashboardSidebar(
                selected: _selectedSection,
                companyCode: _companyCode,
                companyName: _companyName,
                onBackTap: _signOutToHome,
                enabledModules: prov.enabledModules,
                onSectionSelected: (section) {
                  setState(() => _selectedSection = section);
                  Navigator.of(context).pop();
                },
              ),
            ),
          ),
        ),
      ),
      body: Consumer<TimesheetProvider>(
        builder: (context, prov, _) {
          if (prov.isLoading && prov.allPunches.isEmpty) {
            return const PremiumLoadingIndicator(label: 'Loading section...');
          }
          return LayoutBuilder(
            builder: (context, constraints) {
              final isWide = Responsive.isDesktop(context);
              final isTinyPhone = Responsive.isTinyPhone(context);
              final horizontalPadding = Responsive.horizontalPadding(context);
              final maxContentWidth = Responsive.contentMaxWidth(context);

              final header = _selectedSection == DashboardSection.dashboard
                  ? Container(
                      padding: EdgeInsets.fromLTRB(
                        horizontalPadding,
                        horizontalPadding,
                        horizontalPadding,
                        16,
                      ),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [Color(0xFFE5EDFF), Color(0xFFDCE7FF)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        border: Border.all(color: const Color(0x220F172A)),
                        borderRadius: BorderRadius.circular(22),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(
                              0xFF0F172A,
                            ).withValues(alpha: 0.08),
                            blurRadius: 24,
                            offset: const Offset(0, 10),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 84,
                            height: 6,
                            decoration: BoxDecoration(
                              color: const Color(0xFF0F172A),
                              borderRadius: BorderRadius.circular(999),
                            ),
                          ),
                          const SizedBox(height: 14),
                          if (isWide)
                            Row(
                              children: [
                                OutlinedButton.icon(
                                  onPressed: _runSystemCheck,
                                  style: OutlinedButton.styleFrom(
                                    side: const BorderSide(
                                      color: AppTheme.gold,
                                    ),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(30),
                                    ),
                                    foregroundColor: AppTheme.gold,
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 14,
                                      vertical: 10,
                                    ),
                                  ),
                                  icon: const Icon(
                                    Icons.health_and_safety_outlined,
                                    size: 16,
                                  ),
                                  label: Text(
                                    'System check',
                                    style: GoogleFonts.poppins(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                OutlinedButton.icon(
                                  onPressed: () => Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) =>
                                          const PaperlessOpsScreen(),
                                    ),
                                  ),
                                  style: OutlinedButton.styleFrom(
                                    side: const BorderSide(
                                      color: AppTheme.gold,
                                    ),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(30),
                                    ),
                                    foregroundColor: AppTheme.gold,
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 14,
                                      vertical: 10,
                                    ),
                                  ),
                                  icon: const Icon(
                                    Icons.description_outlined,
                                    size: 16,
                                  ),
                                  label: Text(
                                    'Paperless Ops',
                                    style: GoogleFonts.poppins(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 10,
                                  ),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFEFF4FF),
                                    borderRadius: BorderRadius.circular(30),
                                    border: Border.all(
                                      color: const Color(0xFFD1D5DB),
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(
                                        Icons.calendar_today_outlined,
                                        size: 16,
                                        color: AppTheme.gold,
                                      ),
                                      const SizedBox(width: 8),
                                      Text(
                                        '${_dateFormat.format(_rangeStart)} – ${_dateFormat.format(_rangeEnd)}',
                                        style: GoogleFonts.poppins(
                                          color: const Color(0xFF111827),
                                          fontSize: 12,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 12),
                                FutureBuilder<int>(
                                  future: prov.currentCompanyId == null
                                      ? Future.value(0)
                                      : SupabaseTimesheetStorage.getUnreadNotificationsCount(
                                          companyId: prov.currentCompanyId!,
                                          forHr: true,
                                        ),
                                  builder: (context, snap) {
                                    final unread = snap.data ?? 0;
                                    return IconButton(
                                      tooltip: 'Notifications',
                                      onPressed: prov.currentCompanyId == null
                                          ? null
                                          : () => showModalBottomSheet<void>(
                                              context: context,
                                              isScrollControlled: true,
                                              builder: (_) => SizedBox(
                                                height:
                                                    MediaQuery.of(
                                                      context,
                                                    ).size.height *
                                                    0.72,
                                                child: NotificationsSheet(
                                                  companyId:
                                                      prov.currentCompanyId!,
                                                  forHr: true,
                                                ),
                                              ),
                                            ),
                                      icon: Badge.count(
                                        isLabelVisible: unread > 0,
                                        count: unread,
                                        child: const Icon(
                                          Icons.notifications_none,
                                          color: AppTheme.gold,
                                        ),
                                      ),
                                    );
                                  },
                                ),
                              ],
                            )
                          else
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Builder(
                                      builder: (innerContext) => IconButton(
                                        icon: const Icon(
                                          Icons.menu,
                                          color: AppTheme.gold,
                                        ),
                                        onPressed: () => Scaffold.of(
                                          innerContext,
                                        ).openDrawer(),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          'Human Resource',
                                          style: GoogleFonts.poppins(
                                            color: const Color(0xFF111827),
                                            fontSize: isTinyPhone ? 21 : 24,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          'Track employee attendance, payments and overtime.',
                                          style: GoogleFonts.poppins(
                                            color: const Color(0xFF6B7280),
                                            fontSize: isTinyPhone ? 12 : 13,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                Wrap(
                                  spacing: 10,
                                  runSpacing: 10,
                                  children: [
                                    OutlinedButton.icon(
                                      onPressed: _runSystemCheck,
                                      style: OutlinedButton.styleFrom(
                                        side: const BorderSide(
                                          color: AppTheme.gold,
                                        ),
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                            30,
                                          ),
                                        ),
                                        foregroundColor: AppTheme.gold,
                                        padding: EdgeInsets.symmetric(
                                          horizontal: isTinyPhone ? 10 : 14,
                                          vertical: isTinyPhone ? 8 : 10,
                                        ),
                                      ),
                                      icon: const Icon(
                                        Icons.health_and_safety_outlined,
                                        size: 16,
                                      ),
                                      label: Text(
                                        'System check',
                                        style: GoogleFonts.poppins(
                                          fontSize: isTinyPhone ? 11 : 12,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                    OutlinedButton.icon(
                                      onPressed: () => setState(
                                        () => _selectedSection =
                                            DashboardSection.scheduling,
                                      ),
                                      style: OutlinedButton.styleFrom(
                                        side: const BorderSide(
                                          color: AppTheme.gold,
                                        ),
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                            30,
                                          ),
                                        ),
                                        foregroundColor: AppTheme.gold,
                                        padding: EdgeInsets.symmetric(
                                          horizontal: isTinyPhone ? 10 : 14,
                                          vertical: isTinyPhone ? 8 : 10,
                                        ),
                                      ),
                                      icon: const Icon(
                                        Icons.event_note_outlined,
                                        size: 16,
                                      ),
                                      label: Text(
                                        'Scheduling',
                                        style: GoogleFonts.poppins(
                                          fontSize: isTinyPhone ? 11 : 12,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                    OutlinedButton.icon(
                                      onPressed: () =>
                                          Navigator.of(context).push(
                                            MaterialPageRoute(
                                              builder: (_) =>
                                                  const PaperlessOpsScreen(),
                                            ),
                                          ),
                                      style: OutlinedButton.styleFrom(
                                        side: const BorderSide(
                                          color: AppTheme.gold,
                                        ),
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(
                                            30,
                                          ),
                                        ),
                                        foregroundColor: AppTheme.gold,
                                        padding: EdgeInsets.symmetric(
                                          horizontal: isTinyPhone ? 10 : 14,
                                          vertical: isTinyPhone ? 8 : 10,
                                        ),
                                      ),
                                      icon: const Icon(
                                        Icons.description_outlined,
                                        size: 16,
                                      ),
                                      label: Text(
                                        'Paperless Ops',
                                        style: GoogleFonts.poppins(
                                          fontSize: isTinyPhone ? 11 : 12,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                    Container(
                                      padding: EdgeInsets.symmetric(
                                        horizontal: isTinyPhone ? 12 : 16,
                                        vertical: isTinyPhone ? 8 : 10,
                                      ),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFEFF4FF),
                                        borderRadius: BorderRadius.circular(30),
                                        border: Border.all(
                                          color: const Color(0xFFD1D5DB),
                                        ),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          const Icon(
                                            Icons.calendar_today_outlined,
                                            size: 16,
                                            color: AppTheme.gold,
                                          ),
                                          const SizedBox(width: 8),
                                          Text(
                                            isTinyPhone
                                                ? DateFormat(
                                                    'MMM d',
                                                  ).format(_rangeStart)
                                                : '${_dateFormat.format(_rangeStart)} – ${_dateFormat.format(_rangeEnd)}',
                                            style: GoogleFonts.poppins(
                                              color: const Color(0xFF111827),
                                              fontSize: isTinyPhone ? 11 : 12,
                                              fontWeight: FontWeight.w500,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    FutureBuilder<int>(
                                      future: prov.currentCompanyId == null
                                          ? Future.value(0)
                                          : SupabaseTimesheetStorage.getUnreadNotificationsCount(
                                              companyId: prov.currentCompanyId!,
                                              forHr: true,
                                            ),
                                      builder: (context, snap) {
                                        final unread = snap.data ?? 0;
                                        return IconButton(
                                          tooltip: 'Notifications',
                                          onPressed:
                                              prov.currentCompanyId == null
                                              ? null
                                              : () => showModalBottomSheet<void>(
                                                  context: context,
                                                  isScrollControlled: true,
                                                  builder: (_) => SizedBox(
                                                    height:
                                                        MediaQuery.of(
                                                          context,
                                                        ).size.height *
                                                        0.72,
                                                    child: NotificationsSheet(
                                                      companyId: prov
                                                          .currentCompanyId!,
                                                      forHr: true,
                                                    ),
                                                  ),
                                                ),
                                          icon: Badge.count(
                                            isLabelVisible: unread > 0,
                                            count: unread,
                                            child: const Icon(
                                              Icons.notifications_none,
                                              color: AppTheme.gold,
                                            ),
                                          ),
                                        );
                                      },
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          const SizedBox(height: 16),
                          SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Row(
                              children: [
                                DashboardStatCard(
                                  icon: Icons.people_alt_outlined,
                                  label: 'Employees',
                                  value: prov.employees
                                      .where(
                                        (e) =>
                                            e.workerType == WorkerType.employee,
                                      )
                                      .length
                                      .toString(),
                                ),
                                const SizedBox(width: 12),
                                DashboardStatCard(
                                  icon: Icons.engineering_outlined,
                                  label: 'Contractors',
                                  value: prov.employees
                                      .where(
                                        (e) =>
                                            e.workerType ==
                                                WorkerType.contractor ||
                                            e.workerType ==
                                                WorkerType.subcontractor,
                                      )
                                      .length
                                      .toString(),
                                ),
                                const SizedBox(width: 12),
                                DashboardStatCard(
                                  icon: Icons.insights_outlined,
                                  label: 'Enabled Modules',
                                  value: prov.enabledModules.values
                                      .where((v) => v)
                                      .length
                                      .toString(),
                                ),
                                const SizedBox(width: 12),
                                DashboardStatCard(
                                  icon: Icons.location_city_outlined,
                                  label: 'Branches',
                                  value: {
                                    ..._managedBranches.map(
                                      (b) => b.toLowerCase(),
                                    ),
                                    ...prov.employees
                                        .map((e) => e.branch.toLowerCase())
                                        .where((b) => b.isNotEmpty),
                                  }.length.toString(),
                                ),
                                if (prov.currentCompanyId != null) ...[
                                  const SizedBox(width: 12),
                                  FutureBuilder<Map<String, int>>(
                                    future:
                                        SupabaseTimesheetStorage.getPaOverview(
                                          companyId: prov.currentCompanyId!,
                                        ),
                                    builder: (context, snap) {
                                      final metrics =
                                          snap.data ??
                                          const {
                                            'open': 0,
                                            'overdue': 0,
                                            'due_today': 0,
                                          };
                                      return DashboardStatCard(
                                        icon: Icons.assistant_navigation,
                                        label: 'My PA open',
                                        value: '${metrics['open'] ?? 0}',
                                      );
                                    },
                                  ),
                                ],
                              ],
                            ),
                          ),
                        ],
                      ),
                    )
                  : !isWide
                  ? Container(
                      padding: EdgeInsets.fromLTRB(
                        horizontalPadding,
                        horizontalPadding,
                        horizontalPadding,
                        0,
                      ),
                      child: Row(
                        children: [
                          Builder(
                            builder: (innerContext) => IconButton(
                              icon: const Icon(
                                Icons.menu,
                                color: AppTheme.gold,
                              ),
                              onPressed: () =>
                                  Scaffold.of(innerContext).openDrawer(),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Human Resource',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF111827),
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    )
                  : const SizedBox(height: 16);

              final content = Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  header,
                  const SizedBox(height: 12),
                  Expanded(
                    child: Container(
                      padding: EdgeInsets.fromLTRB(
                        horizontalPadding,
                        0,
                        horizontalPadding,
                        horizontalPadding,
                      ),
                      child: Card(
                        color: const Color(0xFFE5EDFF),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(32),
                        ),
                        elevation: 0.6,
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(32),
                          child: Padding(
                            padding: const EdgeInsets.all(8.0),
                            child: DataTableTheme(
                              data: DataTableThemeData(
                                headingRowColor: WidgetStateProperty.all(
                                  const Color(0xFFF8FAFC),
                                ),
                                headingTextStyle: GoogleFonts.poppins(
                                  color: const Color(0xFF111827),
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                                dataTextStyle: GoogleFonts.poppins(
                                  color: const Color(0xFF374151),
                                  fontSize: 11,
                                ),
                                dividerThickness: 0.35,
                              ),
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 240),
                                switchInCurve: Curves.easeOutCubic,
                                switchOutCurve: Curves.easeInCubic,
                                transitionBuilder: (child, animation) {
                                  return FadeTransition(
                                    opacity: animation,
                                    child: SlideTransition(
                                      position: Tween<Offset>(
                                        begin: const Offset(0.02, 0),
                                        end: Offset.zero,
                                      ).animate(animation),
                                      child: child,
                                    ),
                                  );
                                },
                                child: KeyedSubtree(
                                  key: ValueKey(_selectedSection),
                                  child: SizedBox.expand(
                                    child: Container(
                                      decoration: BoxDecoration(
                                        color: Colors.white,
                                        borderRadius: BorderRadius.circular(24),
                                      ),
                                      clipBehavior: Clip.antiAlias,
                                      child: _buildSectionContent(prov),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              );

              if (!isWide) {
                return Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: maxContentWidth),
                    child: content,
                  ),
                );
              }

              return Row(
                children: [
                  DashboardSidebar(
                    selected: _selectedSection,
                    companyCode: _companyCode,
                    companyName: _companyName,
                    onBackTap: _signOutToHome,
                    enabledModules: prov.enabledModules,
                    onSectionSelected: (section) {
                      setState(() => _selectedSection = section);
                    },
                  ),
                  Expanded(
                    child: Align(
                      alignment: Alignment.topCenter,
                      child: ConstrainedBox(
                        constraints: BoxConstraints(maxWidth: maxContentWidth),
                        child: content,
                      ),
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}

class HrLeaveSection extends StatefulWidget {
  const HrLeaveSection({super.key});

  @override
  State<HrLeaveSection> createState() => _HrLeaveSectionState();
}

class _HrLeaveSectionState extends State<HrLeaveSection> {
  bool _loading = false;
  String? _error;
  List<LeaveRequest> _requests = const [];
  String _status = 'pending';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await SupabaseTimesheetStorage.getLeaveRequests(
        companyId: companyId,
        status: _status,
      );
      if (!mounted) return;
      setState(() => _requests = rows);
    } catch (e) {
      if (!mounted) return;
      setState(
        () => _error = friendlyErrorMessage(
          e,
          fallback: 'Could not load leave requests.',
        ),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _decide(LeaveRequest r, String decision) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final noteCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          '${decision == 'approved' ? 'Approve' : 'Decline'} leave request',
        ),
        content: TextField(
          controller: noteCtrl,
          minLines: 2,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'Decision note (optional)',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await SupabaseTimesheetStorage.decideLeaveRequest(
      companyId: companyId,
      leaveRequestId: r.id,
      decision: decision,
      decisionNote: noteCtrl.text,
    );
    await SupabaseTimesheetStorage.dispatchNotificationDeliveries(
      companyId: companyId,
    );
    await _load();
    if (!mounted) return;
    showSuccessSnack(
      context,
      'Leave request ${decision == 'approved' ? 'approved' : 'declined'}.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final employees = {
      for (final e in context.watch<TimesheetProvider>().employees) e.id: e,
    };
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          PremiumSectionHeader(
            icon: Icons.event_available_outlined,
            title: 'Leave Management',
            subtitle: 'Employee leave requests and approvals.',
            actions: [
              Wrap(
                spacing: 8,
                children: [
                  for (final s in const [
                    'pending',
                    'approved',
                    'declined',
                    'cancelled',
                    'all',
                  ])
                    ChoiceChip(
                      label: Text(s),
                      selected: _status == s,
                      onSelected: (_) {
                        setState(() => _status = s);
                        _load();
                      },
                    ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_loading)
            const PremiumLoadingIndicator(label: 'Loading leave requests...'),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                _error!,
                style: GoogleFonts.poppins(color: const Color(0xFFB91C1C)),
              ),
            ),
          ..._requests.map((r) {
            final employee = employees[r.employeeId];
            final label = employee == null
                ? 'Employee #${r.employeeId}'
                : employee.fullName;
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
                            '$label • ${r.leaveType.toUpperCase()}',
                            style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        Text(
                          r.status.toUpperCase(),
                          style: GoogleFonts.poppins(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${DateFormat('dd MMM').format(r.startDate)} - ${DateFormat('dd MMM').format(r.endDate)} (${r.totalDays} day(s))',
                      style: GoogleFonts.poppins(
                        fontSize: 12,
                        color: const Color(0xFF475569),
                      ),
                    ),
                    if ((r.reason ?? '').trim().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          r.reason!.trim(),
                          style: GoogleFonts.poppins(fontSize: 12),
                        ),
                      ),
                    if (r.isPending)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Wrap(
                          spacing: 8,
                          children: [
                            TextButton.icon(
                              onPressed: () => _decide(r, 'approved'),
                              icon: const Icon(
                                Icons.check_circle_outline,
                                size: 16,
                              ),
                              label: const Text('Approve'),
                            ),
                            TextButton.icon(
                              onPressed: () => _decide(r, 'declined'),
                              icon: const Icon(Icons.cancel_outlined, size: 16),
                              label: const Text('Decline'),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            );
          }),
          const SizedBox(height: 12),
          FutureBuilder<List<Map<String, dynamic>>>(
            future: context.watch<TimesheetProvider>().currentCompanyId == null
                ? Future.value(const [])
                : SupabaseTimesheetStorage.getApprovedLeaveForPayroll(
                    companyId: context
                        .watch<TimesheetProvider>()
                        .currentCompanyId!,
                  ),
            builder: (context, snap) {
              final rows = snap.data ?? const [];
              if (rows.isEmpty) return const SizedBox.shrink();
              final exportRows = rows
                  .map(
                    (r) => [
                      r['employee_code']?.toString() ?? '-',
                      '${r['name'] ?? ''} ${r['surname'] ?? ''}'.trim(),
                      r['leave_type']?.toString() ?? '-',
                      r['start_date']?.toString() ?? '-',
                      r['end_date']?.toString() ?? '-',
                      r['total_days']?.toString() ?? '0',
                    ],
                  )
                  .toList();
              return Align(
                alignment: Alignment.centerRight,
                child: buildExportButton(
                  context: context,
                  fileName:
                      'leave_payroll_export_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
                  headers: const [
                    'Employee code',
                    'Name',
                    'Type',
                    'Start date',
                    'End date',
                    'Days',
                  ],
                  rows: exportRows,
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class HrMessagesSection extends StatefulWidget {
  const HrMessagesSection({super.key});

  @override
  State<HrMessagesSection> createState() => _HrMessagesSectionState();
}

class _HrMessagesSectionState extends State<HrMessagesSection>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final TextEditingController _msgCtrl = TextEditingController();
  final TextEditingController _peopleSearchCtrl = TextEditingController();
  String? _directThreadId;
  String? _directPeerEmployeeId;
  String? _teamThreadId;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    _tabController.dispose();
    _msgCtrl.dispose();
    _peopleSearchCtrl.dispose();
    super.dispose();
  }

  Future<void> _openDirectWithEmployee(Employee e, String companyId) async {
    final threadId =
        await SupabaseTimesheetStorage.getOrCreateDirectThreadHrToEmployee(
          companyId: companyId,
          targetEmployeeId: e.id,
          threadTitle: e.fullName,
        );
    if (!mounted) return;
    if (threadId != null) {
      setState(() {
        _directThreadId = threadId;
        _directPeerEmployeeId = e.id;
      });
    }
  }

  Future<void> _createGroupThread(TimesheetProvider prov) async {
    final companyId = prov.currentCompanyId;
    if (companyId == null || prov.employees.isEmpty) return;
    final titleCtrl = TextEditingController();
    final selected = <String>{};
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('New team/group'),
          content: SizedBox(
            width: 520,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: titleCtrl,
                  decoration: const InputDecoration(labelText: 'Group name'),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  height: 220,
                  child: ListView(
                    children: prov.employees
                        .map(
                          (e) => CheckboxListTile(
                            dense: true,
                            value: selected.contains(e.id),
                            onChanged: (v) => setLocal(() {
                              if (v == true) {
                                selected.add(e.id);
                              } else {
                                selected.remove(e.id);
                              }
                            }),
                            title: Text(e.fullName),
                          ),
                        )
                        .toList(),
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
              onPressed: selected.isEmpty || titleCtrl.text.trim().isEmpty
                  ? null
                  : () => Navigator.of(ctx).pop(true),
              child: const Text('Create'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final threadId = await SupabaseTimesheetStorage.createMessageThread(
      companyId: companyId,
      title: titleCtrl.text.trim(),
      threadType: 'group',
      memberEmployeeIds: selected.toList(),
    );
    if (threadId != null && mounted) {
      setState(() {
        _teamThreadId = threadId;
        _tabController.index = 2;
      });
    }
  }

  Future<void> _send(TimesheetProvider prov) async {
    final companyId = prov.currentCompanyId;
    if (companyId == null) return;
    final body = _msgCtrl.text.trim();
    if (body.isEmpty) return;
    final tab = _tabController.index;
    if (tab == 1 && _directThreadId == null) {
      showInfoSnack(context, 'Select someone from the list to message.');
      return;
    }
    if (tab == 2 && _teamThreadId == null) {
      showInfoSnack(context, 'Select a team from the list.');
      return;
    }
    setState(() => _sending = true);
    try {
      if (tab == 0) {
        await SupabaseTimesheetStorage.sendCompanyMessage(
          companyId: companyId,
          body: body,
        );
      } else if (tab == 1) {
        await SupabaseTimesheetStorage.sendThreadMessage(
          companyId: companyId,
          threadId: _directThreadId!,
          body: body,
        );
      } else {
        await SupabaseTimesheetStorage.sendThreadMessage(
          companyId: companyId,
          threadId: _teamThreadId!,
          body: body,
        );
      }
      if (!mounted) return;
      _msgCtrl.clear();
      setState(() {});
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Could not send message.'),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Widget _messageListCard({
    required Future<List<AppMessage>> future,
    required Map<String, Employee> employeesById,
    required String emptyLabel,
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
                    );
                  },
                ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    if (companyId == null) return const SizedBox.shrink();
    final employeesById = {for (final e in prov.employees) e.id: e};
    final q = _peopleSearchCtrl.text.trim().toLowerCase();
    final people = List<Employee>.from(prov.employees)
      ..sort(
        (a, b) => a.fullName.toLowerCase().compareTo(b.fullName.toLowerCase()),
      );
    final filteredPeople = q.isEmpty
        ? people
        : people
              .where(
                (e) =>
                    e.fullName.toLowerCase().contains(q) ||
                    e.employeeCode.toLowerCase().contains(q),
              )
              .toList();

    return FutureBuilder<List<MessageThread>>(
      key: ValueKey('hr_threads_$companyId'),
      future: SupabaseTimesheetStorage.getMessageThreads(companyId: companyId),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting &&
            !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final threads = snapshot.data ?? const <MessageThread>[];
        final teamThreads = threads.where((t) => t.isGroup).toList()
          ..sort(
            (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
          );

        Widget companyFeedTab() {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
                child: Text(
                  'Announcements for everyone in this company. Use Direct or Teams for private or group chats.',
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
                  ),
                  employeesById: employeesById,
                  emptyLabel: 'No announcements yet.',
                ),
              ),
            ],
          );
        }

        Widget directTab() {
          final list = Column(
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
              const SizedBox(height: 8),
              Expanded(
                child: filteredPeople.isEmpty
                    ? Center(
                        child: Text(
                          'No people match your search.',
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
                          return ListTile(
                            dense: true,
                            leading: CircleAvatar(
                              radius: 18,
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
                                        : 'Employee'),
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: const Icon(
                              Icons.chevron_right,
                              color: Color(0xFF9CA3AF),
                            ),
                            onTap: () =>
                                _openDirectWithEmployee(e, companyId),
                          );
                        },
                      ),
              ),
            ],
          );

          if (_directThreadId != null) {
            final peerName =
                employeesById[_directPeerEmployeeId]?.fullName ??
                    'Conversation';
            final chatBody = _messageListCard(
              future: SupabaseTimesheetStorage.getThreadMessages(
                companyId: companyId,
                threadId: _directThreadId!,
              ),
              employeesById: employeesById,
              emptyLabel: 'No messages yet. Say hello below.',
            );
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Material(
                  color: Colors.white,
                  child: Row(
                    children: [
                      IconButton(
                        tooltip: 'All conversations',
                        icon: const Icon(Icons.arrow_back_rounded),
                        color: const Color(0xFF111827),
                        onPressed: () => setState(() {
                          _directThreadId = null;
                          _directPeerEmployeeId = null;
                        }),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              peerName,
                              style: GoogleFonts.poppins(
                                fontWeight: FontWeight.w600,
                                fontSize: 16,
                                color: const Color(0xFF111827),
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              'Direct message',
                              style: GoogleFonts.poppins(
                                fontSize: 12,
                                color: const Color(0xFF6B7280),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Expanded(child: chatBody),
              ],
            );
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
                child: Text(
                  'Tap someone to open your conversation.',
                  style: GoogleFonts.poppins(
                    fontSize: 12,
                    color: const Color(0xFF6B7280),
                  ),
                ),
              ),
              Expanded(child: list),
            ],
          );
        }

        Widget teamsTab() {
          final list = Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              OutlinedButton.icon(
                onPressed: () => _createGroupThread(prov),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Create team'),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: teamThreads.isEmpty
                    ? Center(
                        child: Text(
                          'No teams yet. Create one to message a group, or open a job’s team chat from Job details.',
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
                            trailing: const Icon(
                              Icons.chevron_right,
                              color: Color(0xFF9CA3AF),
                            ),
                            onTap: () => setState(() => _teamThreadId = t.id),
                          );
                        },
                      ),
              ),
            ],
          );

          if (_teamThreadId != null) {
            MessageThread? active;
            for (final t in teamThreads) {
              if (t.id == _teamThreadId) {
                active = t;
                break;
              }
            }
            final teamTitle = active?.title ?? 'Team';
            final chatBody = _messageListCard(
              future: SupabaseTimesheetStorage.getThreadMessages(
                companyId: companyId,
                threadId: _teamThreadId!,
              ),
              employeesById: employeesById,
              emptyLabel: 'No team messages yet.',
            );
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Material(
                  color: Colors.white,
                  child: Row(
                    children: [
                      IconButton(
                        tooltip: 'All teams',
                        icon: const Icon(Icons.arrow_back_rounded),
                        color: const Color(0xFF111827),
                        onPressed: () =>
                            setState(() => _teamThreadId = null),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              teamTitle,
                              style: GoogleFonts.poppins(
                                fontWeight: FontWeight.w600,
                                fontSize: 16,
                                color: const Color(0xFF111827),
                              ),
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              active?.jobId != null
                                  ? 'Job team channel'
                                  : 'Team channel',
                              style: GoogleFonts.poppins(
                                fontSize: 12,
                                color: const Color(0xFF6B7280),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Expanded(child: chatBody),
              ],
            );
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
                child: Text(
                  'Tap a team to open the channel.',
                  style: GoogleFonts.poppins(
                    fontSize: 12,
                    color: const Color(0xFF6B7280),
                  ),
                ),
              ),
              Expanded(child: list),
            ],
          );
        }

        String composerHint() {
          switch (_tabController.index) {
            case 0:
              return 'Post a company announcement…';
            case 1:
              return _directThreadId == null
                  ? 'Choose someone in Direct messages first…'
                  : 'Write a direct message…';
            default:
              return _teamThreadId == null
                  ? 'Choose a team in Teams first…'
                  : 'Message your team…';
          }
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
                        'Company feed, direct messages, team channels, and job crew chats.',
                  ),
                  const SizedBox(height: 8),
                  TabBar(
                    controller: _tabController,
                    labelColor: AppTheme.gold,
                    unselectedLabelColor: const Color(0xFF6B7280),
                    indicatorColor: AppTheme.gold,
                    tabs: const [
                      Tab(text: 'Company feed'),
                      Tab(text: 'Direct messages'),
                      Tab(text: 'Teams'),
                    ],
                  ),
                  Expanded(
                    child: TabBarView(
                      controller: _tabController,
                      children: [
                        companyFeedTab(),
                        directTab(),
                        teamsTab(),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _msgCtrl,
                          minLines: 1,
                          maxLines: 3,
                          decoration: InputDecoration(
                            labelText: composerHint(),
                            border: const OutlineInputBorder(),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton.icon(
                        onPressed: _sending ? null : () => _send(prov),
                        icon: const Icon(Icons.send_outlined, size: 16),
                        label: const Text('Send'),
                      ),
                    ],
                  ),
                ],
          ),
        );
      },
    );
  }
}
