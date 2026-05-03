import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../theme/app_theme.dart';
import '../models/employee.dart';
import '../models/job.dart';
import '../models/time_punch.dart';
import '../providers/job_provider.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/export_service.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import '../theme/responsive.dart';
import 'my_jobs_screen.dart';
import 'incident_report_screen.dart';

class EmployeePunchScreen extends StatefulWidget {
  final bool embedded;
  final bool forceActivitiesOnly;

  const EmployeePunchScreen({
    super.key,
    this.embedded = false,
    this.forceActivitiesOnly = false,
  });

  @override
  State<EmployeePunchScreen> createState() => _EmployeePunchScreenState();
}

class _EmployeePunchScreenState extends State<EmployeePunchScreen> {
  static final _timeFormat = DateFormat('h:mm a');
  static final _dateFormat = DateFormat('EEEE, MMM d, y');
  String _activityRange = 'today'; // today, week, month, all
  bool _isPunching = false;

  Future<void> _exportActivities(
    List<TimePunch> punches,
    ExportFormat format,
    List<Job> jobs,
  ) async {
    final sessions = _EmployeePunchList._buildSessions(punches);
    String jobLabel(String? id) {
      if (id == null) return '—';
      for (final j in jobs) {
        if (j.id == id) return j.title;
      }
      return '—';
    }
    final headers = [
      'Date',
      'Time In',
      'Job',
      'Time Out',
      'Regular hrs',
      'Overtime hrs',
      'Total hrs',
      'Notes',
    ];
    final rows = sessions.map((s) {
      return [
        DateFormat('yyyy-MM-dd').format(s.date),
        s.timeIn != null ? _timeFormat.format(s.timeIn!) : '—',
        jobLabel(s.jobId),
        s.timeOut != null ? _timeFormat.format(s.timeOut!) : '—',
        s.regularHours.toStringAsFixed(1),
        s.overtimeHours.toStringAsFixed(1),
        s.totalHours.toStringAsFixed(1),
        s.notes ?? '—',
      ];
    }).toList();
    try {
      await ExportService.exportTable(
        fileBaseName: 'my_activities_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
        headers: headers,
        rows: rows,
        format: format,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Export completed.');
    } catch (e) {
      AppTelemetry.logError(screen: 'employee_punch_screen', action: 'export_activities', error: e);
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Export failed.'));
    }
  }

  _TodaySession _todaySession(List<TimePunch> punches) {
    final now = DateTime.now();
    final dayStart = DateTime(now.year, now.month, now.day);
    final dayEnd = dayStart.add(const Duration(days: 1));
    final today = punches.where((p) => !p.dateTime.isBefore(dayStart) && p.dateTime.isBefore(dayEnd)).toList()
      ..sort((a, b) => a.dateTime.compareTo(b.dateTime));

    DateTime? signIn;
    DateTime? signOut;
    String? lastLocation;

    for (int i = 0; i < today.length; i++) {
      final p = today[i];
      if (p.isSignIn) {
        signIn = p.dateTime;
        lastLocation = p.address;
        // find next sign-out after this sign-in
        for (int j = i + 1; j < today.length; j++) {
          if (today[j].isSignOut) {
            signOut = today[j].dateTime;
            lastLocation = today[j].address ?? lastLocation;
            break;
          }
        }
      }
    }

    return _TodaySession(
      signIn: signIn,
      signOut: signOut,
      lastLocation: lastLocation,
    );
  }

  List<TimePunch> _filterPunchesForRange(List<TimePunch> punches) {
    if (_activityRange == 'all') return punches;
    final now = DateTime.now();
    DateTime start;
    DateTime end;
    if (_activityRange == 'today') {
      start = DateTime(now.year, now.month, now.day);
      end = start.add(const Duration(days: 1));
    } else if (_activityRange == 'week') {
      final monday = now.subtract(Duration(days: now.weekday - DateTime.monday));
      start = DateTime(monday.year, monday.month, monday.day);
      end = start.add(const Duration(days: 7));
    } else {
      start = DateTime(now.year, now.month, 1);
      end = DateTime(now.year, now.month + 1, 1);
    }
    return punches.where((p) => !p.dateTime.isBefore(start) && p.dateTime.isBefore(end)).toList();
  }

  static Future<String?> _showNoteDialog(BuildContext context, String? initialNote) async {
    final controller = TextEditingController(text: initialNote ?? '');
    return showDialog<String?>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.gray,
        title: Text('Add note (optional)', style: GoogleFonts.poppins(color: AppTheme.gold)),
        content: TextField(
          controller: controller,
          maxLines: 3,
          decoration: const InputDecoration(
            hintText: 'e.g. Working from home, meeting at client',
            border: OutlineInputBorder(),
          ),
          style: GoogleFonts.poppins(color: AppTheme.textGray),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(null),
            child: Text('Skip', style: GoogleFonts.poppins(color: AppTheme.gold)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(controller.text.trim()),
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.gold, foregroundColor: AppTheme.black),
            child: Text('Save', style: GoogleFonts.poppins(color: AppTheme.black)),
          ),
        ],
      ),
    );
  }

  /// Optional job to attach to the new clock-in row (after [employee_submit_punch]).
  Future<String?> _pickSignInJob(BuildContext context, String employeeId) async {
    final jobProv = context.read<JobProvider>();
    await jobProv.loadMyJobs(employeeId);
    if (!context.mounted) return null;
    final jobs = jobProv.myJobs;
    return showModalBottomSheet<String?>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF1F2937),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                  child: Text(
                    'Link this clock-in to a job? (optional)',
                    style: GoogleFonts.poppins(
                      color: AppTheme.gold,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                ListTile(
                  title: Text('No specific job', style: GoogleFonts.poppins(color: Colors.white)),
                  leading: const Icon(Icons.timer_outlined, color: AppTheme.gold),
                  onTap: () => Navigator.pop(ctx, null),
                ),
                for (final j in jobs)
                  ListTile(
                    title: Text(
                      j.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.poppins(color: Colors.white, fontSize: 14),
                    ),
                    leading: const Icon(Icons.work_outline, color: AppTheme.gold, size: 22),
                    onTap: () => Navigator.pop(ctx, j.id),
                  ),
                const SizedBox(height: 8),
              ],
            ),
          ),
        );
      },
    );
  }

  String _titleForJob(List<Job> jobs, String jobId) {
    for (final j in jobs) {
      if (j.id == jobId) return 'Job: ${j.title}';
    }
    return 'Job linked';
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = Responsive.horizontalPadding(context);
    final isPhone = Responsive.isPhone(context);
    final isTinyPhone = Responsive.isTinyPhone(context);
    final body = Consumer2<TimesheetProvider, JobProvider>(
        builder: (context, prov, jobProv, _) {
          if (prov.currentEmployee == null) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      'Enter your ID to sign in or out',
                      style: GoogleFonts.poppins(color: AppTheme.textGray, fontSize: 16),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'No employee selected.',
                      style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                    ),
                  ],
                ),
              ),
            );
          }

          final isClockedIn = prov.isClockedIn;
          final today = _todaySession(prov.currentEmployeePunches);
          final currentEmployee = prov.currentEmployee!;
          final isContractor = currentEmployee.workerType == WorkerType.contractor ||
              currentEmployee.workerType == WorkerType.subcontractor;
          final monthStart = DateTime(DateTime.now().year, DateTime.now().month, 1);
          final monthEnd = DateTime(DateTime.now().year, DateTime.now().month + 1, 1);
          final monthPunches = prov.currentEmployeePunches
              .where((p) => !p.dateTime.isBefore(monthStart) && p.dateTime.isBefore(monthEnd))
              .toList();
          final monthSessions = _EmployeePunchList._buildSessions(monthPunches);
          final monthHours =
              monthSessions.fold<double>(0, (sum, s) => sum + s.totalHours);
          final monthOvertime =
              monthSessions.fold<double>(0, (sum, s) => sum + s.overtimeHours);
          final monthPayment = monthHours * currentEmployee.hourlyRate;
          final myJobs = jobProv.myJobs.length;

          if (widget.forceActivitiesOnly) {
            final filtered = _filterPunchesForRange(prov.currentEmployeePunches);
            return SingleChildScrollView(
              padding: EdgeInsets.all(horizontalPadding),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(left: 4, right: 4, bottom: 12),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          'Activities',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF111827),
                            fontSize: isTinyPhone ? 18 : 20,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(width: 8),
                        PopupMenuButton<ExportFormat>(
                          onSelected: (f) => _exportActivities(filtered, f, jobProv.myJobs),
                          itemBuilder: (context) => const [
                            PopupMenuItem(value: ExportFormat.csv, child: Text('Export CSV')),
                            PopupMenuItem(value: ExportFormat.excelCsv, child: Text('Export Excel (CSV)')),
                            PopupMenuItem(value: ExportFormat.pdf, child: Text('Export PDF')),
                          ],
                          child: Container(
                            padding: EdgeInsets.symmetric(horizontal: isTinyPhone ? 10 : 12, vertical: isTinyPhone ? 7 : 8),
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
                                    fontSize: isTinyPhone ? 10 : 11,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        Container(
                          padding: EdgeInsets.symmetric(horizontal: isTinyPhone ? 10 : 12, vertical: isTinyPhone ? 7 : 8),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(24),
                            border: Border.all(color: const Color(0xFFE5E7EB)),
                          ),
                          child: Text(
                            'Total punches: ${filtered.length}',
                            style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: isTinyPhone ? 10 : 11),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: SegmentedButton<String>(
                        segments: const [
                          ButtonSegment(value: 'today', label: Text('Today'), icon: Icon(Icons.today_outlined)),
                          ButtonSegment(value: 'week', label: Text('Week'), icon: Icon(Icons.view_week_outlined)),
                          ButtonSegment(value: 'month', label: Text('Month'), icon: Icon(Icons.calendar_month_outlined)),
                          ButtonSegment(value: 'all', label: Text('All'), icon: Icon(Icons.all_inclusive)),
                        ],
                        selected: {_activityRange},
                        onSelectionChanged: (value) => setState(() => _activityRange = value.first),
                        style: ButtonStyle(
                          backgroundColor: WidgetStateProperty.resolveWith((states) {
                            if (states.contains(WidgetState.selected)) return AppTheme.gold;
                            return Colors.white;
                          }),
                          foregroundColor: WidgetStateProperty.resolveWith((states) {
                            if (states.contains(WidgetState.selected)) return AppTheme.black;
                            return const Color(0xFF6B7280);
                          }),
                          side: WidgetStateProperty.all(const BorderSide(color: Color(0xFFE5E7EB))),
                        ),
                      ),
                    ),
                  ),
                  Card(
                    color: Colors.white,
                    elevation: 4,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: const BorderSide(color: Color(0xFFE5E7EB)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: _EmployeePunchList(punches: filtered, jobs: jobProv.myJobs),
                    ),
                  ),
                ],
              ),
            );
          }

          return SingleChildScrollView(
            padding: EdgeInsets.all(horizontalPadding),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Hello, ${currentEmployee.fullName}',
                  style: GoogleFonts.poppins(
                    fontSize: isTinyPhone ? 20 : 22,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFF111827),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _dateFormat.format(DateTime.now()),
                  style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 14),
                ),
                if (isContractor) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _MiniPill(label: 'Role', value: currentEmployee.workerType.label),
                      _MiniPill(label: 'Month hrs', value: monthHours.toStringAsFixed(1)),
                      _MiniPill(label: 'Overtime', value: monthOvertime.toStringAsFixed(1)),
                      _MiniPill(label: 'Jobs', value: '$myJobs'),
                    ],
                  ),
                  const SizedBox(height: 10),
                  FutureBuilder<List<dynamic>>(
                    future: Future.wait([
                      SupabaseTimesheetStorage.getPaymentApprovalsForMonth(
                        monthStart,
                        companyId: prov.currentCompanyId,
                      ),
                    ]),
                    builder: (context, snap) {
                      final approvals = (snap.data?.first as List?) ?? const [];
                      dynamic approval;
                      for (final a in approvals) {
                        if ((a.employeeId?.toString() ?? '') == currentEmployee.id) {
                          approval = a;
                          break;
                        }
                      }
                      final approved = approval?.approved == true;
                      final editedAmount = approval?.editedAmount as double?;
                      final due = editedAmount ?? monthPayment;
                      return Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFE5E7EB)),
                        ),
                        child: Row(
                          children: [
                            Icon(
                              approved ? Icons.check_circle_outline : Icons.pending_outlined,
                              size: 16,
                              color: approved ? const Color(0xFF059669) : const Color(0xFFB45309),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'Payment this month: R ${due.toStringAsFixed(2)} (${approved ? 'approved' : 'pending review'})',
                                style: GoogleFonts.poppins(
                                  fontSize: 12,
                                  color: const Color(0xFF374151),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ],
                const SizedBox(height: 24),
                Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(24),
                    side: const BorderSide(color: Color(0xFFE5E7EB)),
                  ),
                  elevation: 4,
                  child: Padding(
                    padding: EdgeInsets.all(isTinyPhone ? 16 : 24),
                    child: Column(
                      children: [
                        Text(
                          _timeFormat.format(DateTime.now()),
                          style: GoogleFonts.poppins(
                            fontSize: isPhone ? 32 : 40,
                            fontWeight: FontWeight.w700,
                            color: AppTheme.gold,
                          ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          today.signIn == null
                              ? 'No sign-in recorded today'
                              : (today.signOut == null ? 'Signed in today' : 'Signed out today'),
                          style: GoogleFonts.poppins(
                            color: today.signIn == null ? const Color(0xFF6B7280) : AppTheme.gold,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          alignment: WrapAlignment.center,
                          spacing: 10,
                          runSpacing: 8,
                          children: [
                            _MiniPill(
                              label: 'In',
                              value: today.signIn != null ? _timeFormat.format(today.signIn!) : '—',
                            ),
                            _MiniPill(
                              label: 'Out',
                              value: today.signOut != null ? _timeFormat.format(today.signOut!) : '—',
                            ),
                          ],
                        ),
                        if (today.lastLocation != null && today.lastLocation!.trim().isNotEmpty) ...[
                          const SizedBox(height: 10),
                          Text(
                            today.lastLocation!,
                            style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                        if (isClockedIn && prov.lastPunch?.jobId != null) ...[
                          const SizedBox(height: 10),
                          Text(
                            _titleForJob(jobProv.myJobs, prov.lastPunch!.jobId!),
                            style: GoogleFonts.poppins(
                              color: AppTheme.gold,
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                            ),
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Location is recorded when you sign in or out.',
                  style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                ),
                const SizedBox(height: 16),
                if (prov.isLoading)
                  const Center(child: CircularProgressIndicator(color: AppTheme.gold))
                else
                  SizedBox(
                    height: isTinyPhone ? 52 : 56,
                    child: ElevatedButton(
                      onPressed: _isPunching
                          ? null
                          : () async {
                              setState(() => _isPunching = true);
                              try {
                                final type =
                                    isClockedIn ? PunchType.signOut : PunchType.signIn;
                                String? note;
                                String? signInJobId;
                                if (type == PunchType.signOut) {
                                  note = await _showNoteDialog(context, null);
                                  if (!context.mounted) return;
                                } else {
                                  signInJobId =
                                      await _pickSignInJob(context, currentEmployee.id);
                                  if (!context.mounted) return;
                                }
                                final ok = await prov.punch(
                                  type,
                                  note: note,
                                  jobId: signInJobId,
                                );
                                if (context.mounted && ok && prov.error != null) {
                                  showInfoSnack(context, prov.error!);
                                }
                                if (context.mounted && !ok) {
                                  AppTelemetry.logError(
                                    screen: 'employee_punch_screen',
                                    action: 'punch',
                                    error: 'punch_returned_false',
                                  );
                                  showErrorSnack(
                                    context,
                                    friendlyErrorMessage(
                                      'Could not record punch. Check location permission.',
                                      fallback: 'Could not record punch.',
                                    ),
                                  );
                                }
                              } finally {
                                if (mounted) setState(() => _isPunching = false);
                              }
                            },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: isClockedIn ? Colors.red.shade700 : AppTheme.gold,
                        foregroundColor: Colors.white,
                      ),
                      child: _isPunching
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.4,
                                color: Colors.white,
                              ),
                            )
                          : Text(
                              isClockedIn ? 'Sign Out' : 'Sign In',
                              style: GoogleFonts.poppins(fontSize: isTinyPhone ? 16 : 18, fontWeight: FontWeight.w600),
                            ),
                    ),
                  ),
                if (!widget.embedded) ...[
                  const SizedBox(height: 16),
                  TextButton.icon(
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MyJobsScreen())),
                    icon: const Icon(Icons.work_outline, color: AppTheme.gold, size: 20),
                    label: Text('Jobs', style: GoogleFonts.poppins(color: AppTheme.gold)),
                  ),
                  const SizedBox(height: 4),
                  TextButton.icon(
                    onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const IncidentReportScreen())),
                    icon: const Icon(Icons.report_outlined, color: AppTheme.gold, size: 20),
                    label: Text('Report incident', style: GoogleFonts.poppins(color: AppTheme.gold)),
                  ),
                ],
              ],
            ),
          );
        },
    );

    if (widget.embedded) return body;

    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text('Timesheet', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppTheme.gold),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: body,
    );
  }
}

/// One row in the activity table: pairs Time In with Time Out (and optional notes on sign-out).
class _PunchSession {
  final DateTime date;
  final DateTime? timeIn;
  final DateTime? timeOut;
  final String? notes;
  final TimePunch? signOutPunch;
  /// From sign-in punch (`punches.job_id`).
  final String? jobId;
  final double regularHours;
  final double overtimeHours;
  final double totalHours;

  _PunchSession({
    required this.date,
    this.timeIn,
    this.timeOut,
    this.notes,
    this.signOutPunch,
    this.jobId,
    this.regularHours = 0,
    this.overtimeHours = 0,
    this.totalHours = 0,
  });

  static void _computeHours(DateTime? timeIn, DateTime? timeOut, List<double> out) {
    if (timeIn == null || timeOut == null || !timeOut.isAfter(timeIn)) {
      out.addAll([0.0, 0.0, 0.0]);
      return;
    }
    final total = timeOut.difference(timeIn).inMinutes / 60.0;
    const standard = 8.0;
    if (total <= standard) {
      out.addAll([total, 0.0, total]);
    } else {
      out.addAll([standard, total - standard, total]);
    }
  }
}

class _EmployeePunchList extends StatelessWidget {
  final List<TimePunch> punches;
  final List<Job> jobs;

  const _EmployeePunchList({required this.punches, required this.jobs});

  static final _timeFormat = DateFormat('h:mm a');
  static final _dateFormat = DateFormat('MMM d, y');

  static String _jobCell(List<Job> jobs, String? jobId) {
    if (jobId == null) return '—';
    for (final j in jobs) {
      if (j.id == jobId) return j.title;
    }
    return '—';
  }

  static List<_PunchSession> _buildSessions(List<TimePunch> punches) {
    if (punches.isEmpty) return [];
    final sorted = List<TimePunch>.from(punches)
      ..sort((a, b) => a.dateTime.compareTo(b.dateTime));
    final sessions = <_PunchSession>[];
    int i = 0;
    while (i < sorted.length) {
      if (sorted[i].isSignIn) {
        final timeIn = sorted[i].dateTime;
        TimePunch? signOutPunch;
        if (i + 1 < sorted.length && sorted[i + 1].isSignOut) {
          signOutPunch = sorted[i + 1];
          i += 2;
        } else {
          i += 1;
        }
        final outDt = signOutPunch?.dateTime;
        final hours = <double>[];
        _PunchSession._computeHours(timeIn, outDt, hours);
        sessions.add(_PunchSession(
          date: timeIn,
          timeIn: timeIn,
          timeOut: outDt,
          notes: signOutPunch?.notes,
          signOutPunch: signOutPunch,
          jobId: sorted[i].jobId,
          regularHours: hours.isNotEmpty ? hours[0] : 0,
          overtimeHours: hours.length > 1 ? hours[1] : 0,
          totalHours: hours.length > 2 ? hours[2] : 0,
        ));
      } else {
        final hours = <double>[];
        _PunchSession._computeHours(null, sorted[i].dateTime, hours);
        sessions.add(_PunchSession(
          date: sorted[i].dateTime,
          timeIn: null,
          timeOut: sorted[i].dateTime,
          notes: sorted[i].notes,
          signOutPunch: sorted[i],
          regularHours: hours.isNotEmpty ? hours[0] : 0,
          overtimeHours: hours.length > 1 ? hours[1] : 0,
          totalHours: hours.length > 2 ? hours[2] : 0,
        ));
        i += 1;
      }
    }
    sessions.sort((a, b) => b.date.compareTo(a.date));
    return sessions.take(30).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<TimesheetProvider>(
      builder: (context, prov, _) {
        final sessions = _buildSessions(punches);
        if (sessions.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              'No punches yet.',
              style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 14),
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
            dataTextStyle: GoogleFonts.poppins(color: const Color(0xFF4B5563), fontSize: 12),
            columns: const [
              DataColumn(label: Text('Date')),
              DataColumn(label: Text('Time In')),
              DataColumn(label: Text('Job')),
              DataColumn(label: Text('Time Out')),
              DataColumn(label: Text('Regular hrs')),
              DataColumn(label: Text('Overtime hrs')),
              DataColumn(label: Text('Total hrs')),
              DataColumn(label: Text('Notes')),
            ],
            rows: sessions.map((s) {
              final timeInStr = s.timeIn != null ? _timeFormat.format(s.timeIn!) : '—';
              final timeOutStr = s.timeOut != null ? _timeFormat.format(s.timeOut!) : '—';
              final jobStr = _jobCell(jobs, s.jobId);
              final hasNote = s.notes != null && s.notes!.isNotEmpty;
              final notePreview = hasNote
                  ? (s.notes!.length > 25 ? '${s.notes!.substring(0, 25)}…' : s.notes!)
                  : (s.signOutPunch != null ? 'Tap to add note' : '—');
              final canEditNote = s.signOutPunch != null;
              return DataRow(
                cells: [
                  DataCell(Text(_dateFormat.format(s.date))),
                  DataCell(Text(timeInStr)),
                  DataCell(Text(jobStr)),
                  DataCell(Text(timeOutStr)),
                  DataCell(Text(s.regularHours.toStringAsFixed(1))),
                  DataCell(Text(s.overtimeHours.toStringAsFixed(1))),
                  DataCell(Text(s.totalHours.toStringAsFixed(1))),
                  DataCell(
                    canEditNote
                        ? InkWell(
                            onTap: () async {
                              final newNote = await _EmployeePunchScreenState._showNoteDialog(context, s.notes);
                              if (context.mounted && s.signOutPunch != null) {
                                await prov.updatePunchNotes(s.signOutPunch!, newNote);
                              }
                            },
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Flexible(
                                  child: Text(
                                    notePreview,
                                    overflow: TextOverflow.ellipsis,
                                    style: GoogleFonts.poppins(
                                      color: hasNote ? AppTheme.textGray : AppTheme.gold.withValues(alpha: 0.7),
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 4),
                                Icon(Icons.edit_note, size: 16, color: AppTheme.gold.withValues(alpha: 0.8)),
                              ],
                            ),
                          )
                        : Text(
                            notePreview,
                            style: GoogleFonts.poppins(color: AppTheme.textGray, fontSize: 12),
                          ),
                  ),
                ],
              );
            }).toList(),
          ),
        );
      },
    );
  }
}

@immutable
class _TodaySession {
  final DateTime? signIn;
  final DateTime? signOut;
  final String? lastLocation;

  const _TodaySession({
    required this.signIn,
    required this.signOut,
    required this.lastLocation,
  });
}

class _MiniPill extends StatelessWidget {
  final String label;
  final String value;

  const _MiniPill({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11, fontWeight: FontWeight.w600)),
          const SizedBox(width: 8),
          Text(value, style: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 12, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
