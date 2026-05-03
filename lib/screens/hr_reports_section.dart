import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';
import '../models/punch_session.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/load_error_panel.dart';
import 'jobs_report_section.dart';

/// Shared table for report punch sessions (avoids subclassing attendance widgets).
Widget buildHrReportsSessionsDataTable(
  BuildContext context,
  List<PunchSession> sessions,
) {
  final isCompact = MediaQuery.of(context).size.width < 1200;
  final dateFormat = DateFormat('MMM d, y');
  final timeFormat = DateFormat('h:mm a');
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
        return DataRow(
          cells: [
            DataCell(Text(dateFormat.format(s.date))),
            DataCell(Text(s.fullName)),
            DataCell(Text(s.employeeId)),
            DataCell(Text(s.timeIn != null ? timeFormat.format(s.timeIn!) : '—')),
            DataCell(Text(s.timeOut != null ? timeFormat.format(s.timeOut!) : '—')),
            DataCell(Text(s.regularHours.toStringAsFixed(1))),
            DataCell(Text(s.overtimeHours.toStringAsFixed(1))),
            DataCell(Text(s.totalHours.toStringAsFixed(1))),
            DataCell(Text(
              s.signInLocation?.trim().isNotEmpty == true
                  ? s.signInLocation!
                  : (s.signInLatitude != null
                        ? '${s.signInLatitude!.toStringAsFixed(5)}, ${s.signInLongitude!.toStringAsFixed(5)}'
                        : '—'),
              overflow: TextOverflow.ellipsis,
              maxLines: 2,
            )),
            DataCell(Text(
              s.signOutLocation?.trim().isNotEmpty == true
                  ? s.signOutLocation!
                  : (s.signOutLatitude != null
                        ? '${s.signOutLatitude!.toStringAsFixed(5)}, ${s.signOutLongitude!.toStringAsFixed(5)}'
                        : '—'),
              overflow: TextOverflow.ellipsis,
              maxLines: 2,
            )),
            DataCell(Text(
              s.notes ?? '—',
              overflow: TextOverflow.ellipsis,
              maxLines: 2,
            )),
          ],
        );
      }).toList(),
    ),
  );
}

class HrReportsSection extends StatefulWidget {
  const HrReportsSection({super.key});

  @override
  State<HrReportsSection> createState() => _HrReportsSectionState();
}

class _HrReportsSectionState extends State<HrReportsSection> {
  static final _dateFormat = DateFormat('MMM d, y');

  DateTime _rangeStart = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _rangeEnd = DateTime.now();

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final start = await showDatePicker(
      context: context,
      initialDate: _rangeStart,
      firstDate: DateTime(now.year - 1),
      lastDate: now,
    );
    if (start == null || !mounted) return;
    final end = await showDatePicker(
      context: context,
      initialDate: _rangeEnd.isBefore(start) ? start : _rangeEnd,
      firstDate: start,
      lastDate: now,
    );
    if (end == null || !mounted) return;
    final endOfRange = DateTime(end.year, end.month, end.day, 23, 59, 59);
    await context.read<TimesheetProvider>().loadAllPunches(
          from: start,
          to: endOfRange,
        );
    setState(() {
      _rangeStart = start;
      _rangeEnd = end;
    });
  }

  Widget _pillTabBar() {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(40),
      ),
      child: TabBar(
        indicatorSize: TabBarIndicatorSize.tab,
        labelColor: Colors.white,
        unselectedLabelColor: const Color(0xFF6B7280),
        indicator: BoxDecoration(
          color: AppTheme.gold,
          borderRadius: BorderRadius.circular(28),
        ),
        labelStyle: GoogleFonts.poppins(
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
        unselectedLabelStyle: GoogleFonts.poppins(
          fontSize: 11,
          fontWeight: FontWeight.w500,
        ),
        isScrollable: true,
        tabs: const [
          Tab(text: 'Overview'),
          Tab(text: 'Jobs'),
          Tab(text: 'Operations'),
          Tab(text: 'Finance'),
          Tab(text: 'Attendance'),
        ],
      ),
    );
  }

  Widget _reportCard(String title, String subtitle, int count) {
    return Container(
      width: 200,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: GoogleFonts.poppins(
              color: const Color(0xFF111827),
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: GoogleFonts.poppins(
              color: const Color(0xFF6B7280),
              fontSize: 11,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            '$count',
            style: GoogleFonts.poppins(
              color: AppTheme.gold,
              fontSize: 24,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Total punches',
            style: GoogleFonts.poppins(
              color: const Color(0xFF9CA3AF),
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final employees = {for (var e in prov.employees) e.id: e};
    final sessions = PunchSession.fromPunches(prov.allPunches, employees);

    final now = DateTime.now();
    final todayStart = DateTime(now.year, now.month, now.day);
    final todayEnd = todayStart.add(const Duration(days: 1));
    final weekStart = todayStart.subtract(const Duration(days: 6));
    final monthStart = DateTime(now.year, now.month, 1);

    bool inRange(DateTime d, DateTime from, DateTime to) =>
        !d.isBefore(from) && d.isBefore(to);

    final dailyCount =
        sessions.where((s) => inRange(s.date, todayStart, todayEnd)).length;
    final weeklyCount =
        sessions.where((s) => inRange(s.date, weekStart, todayEnd)).length;
    final monthlyCount =
        sessions.where((s) => inRange(s.date, monthStart, todayEnd)).length;

    final companyId = prov.currentCompanyId ?? '';

    Widget overviewTab() {
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Punch activity',
              style: GoogleFonts.poppins(
                color: const Color(0xFF111827),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _reportCard(
                    'Today',
                    DateFormat('EEE, d MMM').format(todayStart),
                    dailyCount,
                  ),
                  const SizedBox(width: 12),
                  _reportCard(
                    'This week',
                    '${DateFormat('d MMM').format(weekStart)} – ${DateFormat('d MMM').format(todayStart)}',
                    weeklyCount,
                  ),
                  const SizedBox(width: 12),
                  _reportCard(
                    'This month',
                    DateFormat('MMMM y').format(monthStart),
                    monthlyCount,
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    Widget operationsTab() {
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Scheduling KPIs',
              style: GoogleFonts.poppins(
                color: const Color(0xFF111827),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            FutureBuilder<Map<String, num>>(
              future: SupabaseTimesheetStorage.getSchedulingKpis(
                companyId: companyId,
                from: monthStart,
                to: todayEnd,
              ),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return LoadErrorPanel(
                    message: friendlyErrorMessage(
                      snapshot.error,
                      fallback: 'Could not load KPIs.',
                    ),
                    onRetry: () => setState(() {}),
                  );
                }
                final k = snapshot.data ??
                    const {
                      'fill_rate': 0,
                      'acceptance_rate': 0,
                      'late_no_show': 0,
                      'overtime_exceptions': 0,
                    };
                return SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _reportCard(
                        'Fill rate',
                        'Shifts covered',
                        (k['fill_rate'] ?? 0).round(),
                      ),
                      const SizedBox(width: 12),
                      _reportCard(
                        'Acceptance rate',
                        'Offers accepted',
                        (k['acceptance_rate'] ?? 0).round(),
                      ),
                      const SizedBox(width: 12),
                      _reportCard(
                        'Late/No-show',
                        'Exceptions',
                        (k['late_no_show'] ?? 0).round(),
                      ),
                      const SizedBox(width: 12),
                      _reportCard(
                        'Overtime exceptions',
                        'Shift overruns',
                        (k['overtime_exceptions'] ?? 0).round(),
                      ),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: 20),
            Text(
              'SLA command center',
              style: GoogleFonts.poppins(
                color: const Color(0xFF111827),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            FutureBuilder<Map<String, num>>(
              future: SupabaseTimesheetStorage.getSlaCommandCenterKpis(
                companyId: companyId,
                from: monthStart,
                to: todayEnd,
              ),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return LoadErrorPanel(
                    message: friendlyErrorMessage(
                      snapshot.error,
                      fallback: 'Could not load SLA KPIs.',
                    ),
                    onRetry: () => setState(() {}),
                  );
                }
                final k = snapshot.data ??
                    const {
                      'total_open': 0,
                      'due_soon': 0,
                      'response_breached': 0,
                      'resolution_breached': 0,
                    };
                return SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _reportCard(
                        'Open jobs',
                        'Active workload',
                        (k['total_open'] ?? 0).round(),
                      ),
                      const SizedBox(width: 12),
                      _reportCard(
                        'Due in 24h',
                        'Needs action soon',
                        (k['due_soon'] ?? 0).round(),
                      ),
                      const SizedBox(width: 12),
                      _reportCard(
                        'Response breached',
                        'No response > 2h',
                        (k['response_breached'] ?? 0).round(),
                      ),
                      const SizedBox(width: 12),
                      _reportCard(
                        'Resolution breached',
                        'Missed schedule target',
                        (k['resolution_breached'] ?? 0).round(),
                      ),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: 12),
            FutureBuilder<List<Map<String, dynamic>>>(
              future: SupabaseTimesheetStorage.getSlaExceptionJobs(
                companyId: companyId,
                limit: 10,
              ),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return LoadErrorPanel(
                    message: friendlyErrorMessage(
                      snapshot.error,
                      fallback: 'Could not load SLA exceptions.',
                    ),
                    onRetry: () => setState(() {}),
                  );
                }
                final rows = snapshot.data ?? const <Map<String, dynamic>>[];
                return Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: rows.isEmpty
                        ? Text(
                            'No SLA exceptions right now.',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF6B7280),
                              fontSize: 12,
                            ),
                          )
                        : SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: DataTable(
                              columns: const [
                                DataColumn(label: Text('Job')),
                                DataColumn(label: Text('Status')),
                                DataColumn(label: Text('Response breach')),
                                DataColumn(label: Text('Resolution breach')),
                              ],
                              rows: rows.map((r) {
                                final status =
                                    (r['status'] ?? 'pending').toString();
                                return DataRow(
                                  cells: [
                                    DataCell(Text(
                                      (r['title'] ?? 'Untitled').toString(),
                                    )),
                                    DataCell(Text(status)),
                                    DataCell(Text(
                                      r['response_breached'] == true
                                          ? 'Yes'
                                          : 'No',
                                    )),
                                    DataCell(Text(
                                      r['resolution_breached'] == true
                                          ? 'Yes'
                                          : 'No',
                                    )),
                                  ],
                                );
                              }).toList(),
                            ),
                          ),
                  ),
                );
              },
            ),
            const SizedBox(height: 20),
            Text(
              'Preventive maintenance',
              style: GoogleFonts.poppins(
                color: const Color(0xFF111827),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            FutureBuilder<Map<String, num>>(
              future: SupabaseTimesheetStorage.getPreventiveMaintenanceKpis(
                companyId: companyId,
                from: monthStart,
                to: todayEnd,
              ),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return LoadErrorPanel(
                    message: friendlyErrorMessage(
                      snapshot.error,
                      fallback:
                          'Could not load preventive maintenance KPIs.',
                    ),
                    onRetry: () => setState(() {}),
                  );
                }
                final k = snapshot.data ??
                    const {
                      'generated': 0,
                      'completed': 0,
                      'overdue_open': 0,
                    };
                return SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _reportCard(
                        'Generated',
                        'From PM schedules',
                        (k['generated'] ?? 0).round(),
                      ),
                      const SizedBox(width: 12),
                      _reportCard(
                        'Completed',
                        'Preventive jobs closed',
                        (k['completed'] ?? 0).round(),
                      ),
                      const SizedBox(width: 12),
                      _reportCard(
                        'Overdue open',
                        'PM jobs past due',
                        (k['overdue_open'] ?? 0).round(),
                      ),
                    ],
                  ),
                );
              },
            ),
          ],
        ),
      );
    }

    Widget financeTab() {
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Client profitability snapshot',
              style: GoogleFonts.poppins(
                color: const Color(0xFF111827),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            FutureBuilder<List<Map<String, dynamic>>>(
              future: SupabaseTimesheetStorage.getClientProfitabilitySnapshot(
                companyId: companyId,
                from: monthStart,
                to: todayEnd,
              ),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return LoadErrorPanel(
                    message: friendlyErrorMessage(
                      snapshot.error,
                      fallback: 'Could not load profitability snapshot.',
                    ),
                    onRetry: () => setState(() {}),
                  );
                }
                final rows = snapshot.data ?? const <Map<String, dynamic>>[];
                return Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: rows.isEmpty
                        ? Text(
                            'No client profitability data in this range.',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF6B7280),
                              fontSize: 12,
                            ),
                          )
                        : SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: DataTable(
                              columns: const [
                                DataColumn(label: Text('Client')),
                                DataColumn(label: Text('Revenue')),
                                DataColumn(label: Text('Cost')),
                                DataColumn(label: Text('Gross profit')),
                              ],
                              rows: rows.take(12).map((r) {
                                final revenue =
                                    (r['revenue'] as num?)?.toDouble() ?? 0;
                                final cost =
                                    (r['cost'] as num?)?.toDouble() ?? 0;
                                final gross =
                                    (r['gross_profit'] as num?)?.toDouble() ??
                                        0;
                                return DataRow(
                                  cells: [
                                    DataCell(Text(
                                      (r['client_name'] ?? 'Unnamed client')
                                          .toString(),
                                    )),
                                    DataCell(Text(
                                      'R ${revenue.toStringAsFixed(2)}',
                                    )),
                                    DataCell(Text(
                                      'R ${cost.toStringAsFixed(2)}',
                                    )),
                                    DataCell(Text(
                                      'R ${gross.toStringAsFixed(2)}',
                                    )),
                                  ],
                                );
                              }).toList(),
                            ),
                          ),
                  ),
                );
              },
            ),
          ],
        ),
      );
    }

    Widget attendanceTab() {
      return SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'All punches in range',
                  style: GoogleFonts.poppins(
                    color: const Color(0xFF111827),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                OutlinedButton.icon(
                  onPressed: _pickRange,
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
                  icon: const Icon(Icons.date_range, size: 18),
                  label: Text(
                    '${_dateFormat.format(_rangeStart)} – ${_dateFormat.format(_rangeEnd)}',
                    style: GoogleFonts.poppins(
                      color: AppTheme.gold,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Card(
              color: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(24),
              ),
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: buildHrReportsSessionsDataTable(context, sessions),
              ),
            ),
          ],
        ),
      );
    }

    return DefaultTabController(
      length: 5,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 20, 24, 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Reports',
                  style: GoogleFonts.poppins(
                    color: const Color(0xFF111827),
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Tabs match the older layout: summaries, jobs, operations KPIs, finance, and raw attendance.',
                  style: GoogleFonts.poppins(
                    color: const Color(0xFF6B7280),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          _pillTabBar(),
          Expanded(
            child: TabBarView(
              physics: const BouncingScrollPhysics(),
              children: [
                overviewTab(),
                SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(8, 8, 8, 24),
                  child: const JobsReportSection(),
                ),
                operationsTab(),
                financeTab(),
                attendanceTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
