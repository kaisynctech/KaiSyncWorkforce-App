import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../theme/app_theme.dart';
import '../models/employee.dart';
import '../models/time_punch.dart';
import '../models/punch_session.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import 'hr_edit_employee_screen.dart';
import '../models/payment_approval.dart';
import '../widgets/load_error_panel.dart';

/// HR view of a single employee: info, table of punches, edit/delete.
class HrEmployeeDashboardScreen extends StatefulWidget {
  final Employee employee;

  const HrEmployeeDashboardScreen({super.key, required this.employee});

  @override
  State<HrEmployeeDashboardScreen> createState() => _HrEmployeeDashboardScreenState();
}

class _HrEmployeeDashboardScreenState extends State<HrEmployeeDashboardScreen> {
  DateTime _rangeStart = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _rangeEnd = DateTime(DateTime.now().year, DateTime.now().month + 1, 0);
  late Employee _employee;
  bool _canViewSensitiveData = false;

  static final _timeFormat = DateFormat('h:mm a');
  static final _dateFormat = DateFormat('MMM d, y');

  @override
  void initState() {
    super.initState();
    _employee = widget.employee;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final profile = await SupabaseTimesheetStorage.getCurrentHrProfile();
      if (!mounted) return;
      setState(() {
        final role = profile?.role ?? 'viewer';
        _canViewSensitiveData = role == 'admin' || role == 'owner';
      });
    });
  }

  @override
  void didUpdateWidget(covariant HrEmployeeDashboardScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.employee.id != widget.employee.id) _employee = widget.employee;
  }

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _rangeStart,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
    );
    if (picked == null || !mounted) return;
    setState(() {
      _rangeStart = DateTime(picked.year, picked.month, 1);
      _rangeEnd = DateTime(picked.year, picked.month + 1, 0);
    });
  }

  Future<void> _deleteEmployee() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.gray,
        title: Text('Delete employee?', style: GoogleFonts.poppins(color: AppTheme.gold)),
        content: Text(
          '${_employee.fullName} will be removed. Punch history is kept. This cannot be undone.',
          style: GoogleFonts.poppins(color: AppTheme.textGray),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('Cancel', style: GoogleFonts.poppins(color: AppTheme.gold)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red, foregroundColor: Colors.white),
            child: Text('Delete', style: GoogleFonts.poppins(color: Colors.white)),
          ),
        ],
      ),
    );
    if (confirm == true && mounted) {
      await context.read<TimesheetProvider>().deleteEmployee(_employee);
      if (mounted) Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final companyId = context.watch<TimesheetProvider>().currentCompanyId;
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text(_employee.fullName, style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppTheme.gold),
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit, color: AppTheme.gold),
            onPressed: () async {
              final updated = await Navigator.of(context).push<Employee>(
                MaterialPageRoute(
                  builder: (_) => HrEditEmployeeScreen(employee: _employee),
                ),
              );
              if (updated != null && mounted) {
                setState(() => _employee = updated);
              }
            },
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline, color: Colors.redAccent),
            onPressed: _deleteEmployee,
          ),
        ],
      ),
      body: FutureBuilder<List<TimePunch>>(
        key: ValueKey('${_employee.id}_${companyId ?? ''}_$_rangeStart$_rangeEnd'),
        future: SupabaseTimesheetStorage.getPunchesForEmployee(
          _employee.id,
          from: _rangeStart,
          to: DateTime(_rangeEnd.year, _rangeEnd.month, _rangeEnd.day, 23, 59, 59),
          companyId: companyId,
        ),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return LoadErrorPanel(
              message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load employee punches.'),
              onRetry: () => setState(() {}),
            );
          }
          if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
            return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
          }
          final punches = snapshot.data!;
          final employees = {_employee.id: _employee};
          final sessions = PunchSession.fromPunches(punches, employees);
          final absent = _computeAbsence(_rangeStart, _rangeEnd, sessions, _employee);

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                    side: const BorderSide(color: Color(0xFFE5E7EB)),
                  ),
                  elevation: 4,
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'ID number: ${_canViewSensitiveData && _employee.employeeCode.isNotEmpty ? _employee.employeeCode : "Hidden"}',
                          style: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 14),
                        ),
                        Text('Position: ${_employee.position}', style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 14)),
                        Text(
                          '${_employee.employmentType == EmploymentType.contract ? "Contract" : _employee.employmentType == EmploymentType.student ? "Student" : "Part-time"} '
                          '· Branch: ${_employee.branch.isNotEmpty ? _employee.branch : "—"} '
                          '${_canViewSensitiveData ? '· Monthly: R ${_employee.monthlySalary.toStringAsFixed(2)} · Hourly: R ${_employee.hourlyRate.toStringAsFixed(2)}' : ''}',
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                        ),
                        Text(
                          'Access level: ${switch (_employee.accessLevel) { EmployeeAccessLevel.manager => "Manager", EmployeeAccessLevel.hrAdmin => "HR Admin", _ => "Employee" }}',
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text('Monthly summary', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _MetricCard(label: 'Workdays', value: '${absent.expectedDays}'),
                      const SizedBox(width: 10),
                      _MetricCard(label: 'Present', value: '${absent.presentDays}'),
                      const SizedBox(width: 10),
                      _MetricCard(label: 'Days absent', value: '${absent.absentDays}', danger: absent.absentDays > 0),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                if (_canViewSensitiveData) _buildSummaryTable(sessions),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Sessions', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 16, fontWeight: FontWeight.w600)),
                    OutlinedButton.icon(
                      onPressed: _pickRange,
                      icon: const Icon(Icons.date_range, color: AppTheme.gold, size: 18),
                      label: Text(
                        '${_dateFormat.format(_rangeStart)} – ${_dateFormat.format(_rangeEnd)}',
                        style: GoogleFonts.poppins(color: AppTheme.gold, fontSize: 12),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                _buildTable(sessions),
              ],
            ),
          );
        },
      ),
    );
  }

  _AbsenceSummary _computeAbsence(DateTime start, DateTime end, List<PunchSession> sessions, Employee employee) {
    final s = DateTime(start.year, start.month, start.day);
    final e = DateTime(end.year, end.month, end.day);
    final presentDays = <String>{};
    for (final sess in sessions) {
      if (sess.timeIn == null) continue;
      final d = DateTime(sess.date.year, sess.date.month, sess.date.day);
      if (d.isBefore(s) || d.isAfter(e)) continue;
      presentDays.add('${d.year}-${d.month}-${d.day}');
    }
    int expected = 0;
    for (DateTime d = s; !d.isAfter(e); d = d.add(const Duration(days: 1))) {
      // Assume Monday-Friday are workdays by default.
      if (d.weekday >= DateTime.monday && d.weekday <= DateTime.friday) expected++;
    }
    final present = presentDays.length;
    final absentDays = (expected - present) < 0 ? 0 : (expected - present);
    return _AbsenceSummary(expectedDays: expected, presentDays: present, absentDays: absentDays);
  }

  Widget _buildSummaryTable(List<PunchSession> sessions) {
    final totalRegular = sessions.fold<double>(0, (sum, s) => sum + s.regularHours);
    final totalOvertime = sessions.fold<double>(0, (sum, s) => sum + s.overtimeHours);
    final normalSalary = totalRegular * _employee.hourlyRate;
    final overtimeSalary = totalOvertime * _employee.hourlyRate * 1.5;
    final calculatedFinal = normalSalary + overtimeSalary;
    final totalHours = totalRegular + totalOvertime;

    final periodStart = DateTime(_rangeStart.year, _rangeStart.month, 1);

    return FutureBuilder<List<PaymentApproval>>(
      future: SupabaseTimesheetStorage.getPaymentApprovalsForMonth(
        periodStart,
        companyId: context.read<TimesheetProvider>().currentCompanyId,
      ),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load payment approvals.'),
            onRetry: () => setState(() {}),
            padding: const EdgeInsets.all(16),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: SizedBox(height: 40, child: CircularProgressIndicator(color: AppTheme.gold)));
        }

        final approvals = snapshot.data!;
        final matching = approvals.where((a) => a.employeeId == _employee.id).toList();
        final approval = matching.isEmpty ? null : matching.first;
        final edited = approval?.editedAmount;
        final finalAmt = edited ?? calculatedFinal;
        final isApproved = approval?.approved == true;

        return SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            headingRowColor: WidgetStateProperty.all(const Color(0xFFF9FAFB)),
            headingTextStyle: GoogleFonts.poppins(
              color: const Color(0xFF111827),
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
            dataTextStyle: GoogleFonts.poppins(color: const Color(0xFF4B5563), fontSize: 10),
            columnSpacing: 18,
            dividerThickness: 0.4,
            columns: const [
              DataColumn(label: Text('Total Hours')),
              DataColumn(label: Text('Total Overtime Hours')),
              DataColumn(label: Text('Normal salary')),
              DataColumn(label: Text('Overtime salary')),
              DataColumn(label: Text('Final payment')),
              DataColumn(label: Text('Status')),
              DataColumn(label: Text('Actions')),
            ],
            rows: [
              DataRow(
                cells: [
                  DataCell(Text(totalHours.toStringAsFixed(1))),
                  DataCell(Text(totalOvertime.toStringAsFixed(1))),
                  DataCell(Text('R ${normalSalary.toStringAsFixed(2)}')),
                  DataCell(Text('R ${overtimeSalary.toStringAsFixed(2)}')),
                  DataCell(Text('R ${finalAmt.toStringAsFixed(2)}')),
                  DataCell(
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                      decoration: BoxDecoration(
                        color: (isApproved ? const Color(0xFF059669) : const Color(0xFFB45309)).withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                          color: (isApproved ? const Color(0xFF059669) : const Color(0xFFB45309)).withValues(alpha: 0.25),
                        ),
                      ),
                      child: Text(
                        isApproved ? 'Approved' : 'Edits',
                        style: GoogleFonts.poppins(
                          color: isApproved ? const Color(0xFF059669) : const Color(0xFFB45309),
                          fontWeight: FontWeight.w700,
                          fontSize: 10,
                        ),
                      ),
                    ),
                  ),
                  DataCell(
                    Wrap(
                      spacing: 6,
                      alignment: WrapAlignment.center,
                      children: [
                        IconButton(
                          tooltip: 'Edit payment amount',
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(minWidth: 26, minHeight: 26),
                          icon: const Icon(Icons.edit_outlined, size: 18, color: AppTheme.gold),
                          onPressed: () async {
                            final ctrl = TextEditingController(text: finalAmt.toStringAsFixed(2));
                            final ok = await showDialog<bool>(
                              context: context,
                              builder: (context) {
                                return AlertDialog(
                                  title: const Text('Edit payment amount'),
                                  content: TextField(
                                    controller: ctrl,
                                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                    decoration: const InputDecoration(labelText: 'Final payment amount (R)'),
                                  ),
                                  actions: [
                                    TextButton(
                                      onPressed: () => Navigator.pop(context, false),
                                      child: const Text('Cancel'),
                                    ),
                                    ElevatedButton(
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: AppTheme.gold,
                                        foregroundColor: Colors.white,
                                      ),
                                      onPressed: () => Navigator.pop(context, true),
                                      child: const Text('Save'),
                                    ),
                                  ],
                                );
                              },
                            );
                            if (ok != true || !context.mounted) return;
                            final v = double.tryParse(ctrl.text.trim());
                            if (v == null) return;
                            await SupabaseTimesheetStorage.upsertPaymentApproval(
                              PaymentApproval(
                                employeeId: _employee.id,
                                periodStart: periodStart,
                                editedAmount: v,
                                approved: false,
                                approvedAt: null,
                              ),
                              companyId: context.read<TimesheetProvider>().currentCompanyId,
                            );
                            if (mounted) setState(() {});
                          },
                        ),
                        IconButton(
                          tooltip: 'Approve payment',
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(minWidth: 26, minHeight: 26),
                          icon: Icon(
                            Icons.check_circle_outline,
                            size: 18,
                            color: isApproved ? const Color(0xFF9CA3AF) : const Color(0xFF059669),
                          ),
                          onPressed: isApproved
                              ? null
                              : () async {
                                  await SupabaseTimesheetStorage.upsertPaymentApproval(
                                    PaymentApproval(
                                      employeeId: _employee.id,
                                      periodStart: periodStart,
                                      editedAmount: edited,
                                      approved: true,
                                      approvedAt: DateTime.now(),
                                    ),
                                    companyId: context.read<TimesheetProvider>().currentCompanyId,
                                  );
                                  if (mounted) setState(() {});
                                },
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTable(List<PunchSession> sessions) {
    if (sessions.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text('No punches in this period.', style: GoogleFonts.poppins(color: AppTheme.textGray)),
      );
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingRowColor: WidgetStateProperty.all(const Color(0xFFF9FAFB)),
        headingTextStyle: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 12, fontWeight: FontWeight.w600),
        dataTextStyle: GoogleFonts.poppins(color: const Color(0xFF4B5563), fontSize: 11),
        columns: [
          const DataColumn(label: Text('Date')),
          const DataColumn(label: Text('Time In')),
          const DataColumn(label: Text('Time Out')),
          const DataColumn(label: Text('Regular hrs')),
          const DataColumn(label: Text('Overtime hrs')),
          const DataColumn(label: Text('Total hrs')),
          if (_canViewSensitiveData) const DataColumn(label: Text('Payment')),
          if (_canViewSensitiveData) const DataColumn(label: Text('Overtime Payment')),
          if (_canViewSensitiveData) const DataColumn(label: Text('Payment Due')),
          const DataColumn(label: Text('In location')),
          const DataColumn(label: Text('Out location')),
          const DataColumn(label: Text('Notes')),
        ],
        rows: sessions.map((s) {
          return DataRow(
            cells: [
              DataCell(Text(_dateFormat.format(s.date))),
              DataCell(Text(s.timeIn != null ? _timeFormat.format(s.timeIn!) : '—')),
              DataCell(Text(s.timeOut != null ? _timeFormat.format(s.timeOut!) : '—')),
              DataCell(Text(s.regularHours.toStringAsFixed(1))),
              DataCell(Text(s.overtimeHours.toStringAsFixed(1))),
              DataCell(Text(s.totalHours.toStringAsFixed(1))),
              if (_canViewSensitiveData) DataCell(Text('R ${s.monthlySalary.toStringAsFixed(2)}')),
              if (_canViewSensitiveData) DataCell(Text('R ${s.overtimePayment.toStringAsFixed(2)}')),
              if (_canViewSensitiveData) DataCell(Text('R ${s.paymentDue.toStringAsFixed(2)}')),
              DataCell(Text(
                s.signInLocation != null && s.signInLocation!.trim().isNotEmpty
                    ? s.signInLocation!
                    : (s.signInLatitude != null && s.signInLongitude != null
                        ? '${s.signInLatitude!.toStringAsFixed(5)}, ${s.signInLongitude!.toStringAsFixed(5)}'
                        : '—'),
                overflow: TextOverflow.ellipsis,
                maxLines: 2,
              )),
              DataCell(Text(
                s.signOutLocation != null && s.signOutLocation!.trim().isNotEmpty
                    ? s.signOutLocation!
                    : (s.signOutLatitude != null && s.signOutLongitude != null
                        ? '${s.signOutLatitude!.toStringAsFixed(5)}, ${s.signOutLongitude!.toStringAsFixed(5)}'
                        : '—'),
                overflow: TextOverflow.ellipsis,
                maxLines: 2,
              )),
              DataCell(Text(s.notes ?? '—', overflow: TextOverflow.ellipsis, maxLines: 2)),
            ],
          );
        }).toList(),
      ),
    );
  }
}

class _AbsenceSummary {
  final int expectedDays;
  final int presentDays;
  final int absentDays;
  const _AbsenceSummary({required this.expectedDays, required this.presentDays, required this.absentDays});
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;
  final bool danger;

  const _MetricCard({required this.label, required this.value, this.danger = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 160,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11)),
          const SizedBox(height: 6),
          Text(
            value,
            style: GoogleFonts.poppins(
              color: danger ? const Color(0xFFDC2626) : const Color(0xFF111827),
              fontSize: 20,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
