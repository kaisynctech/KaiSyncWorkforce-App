import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';
import '../models/time_punch.dart';
import '../models/punch_session.dart';
import '../models/employee.dart';
import '../models/job.dart';
import '../models/message_thread.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../services/location_service.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import '_dashboard_decorators.dart';

enum _ManagerBulkScope { manual, everyone, team, job }

class HrAttendanceSection extends StatefulWidget {
  const HrAttendanceSection({super.key});

  @override
  State<HrAttendanceSection> createState() => _HrAttendanceSectionState();
}

class _HrAttendanceSectionState extends State<HrAttendanceSection> {
  static final _dateFormat = DateFormat('MMM d, y');
  static final _timeFormat = DateFormat('h:mm a');

  DateTime _dailyDate = DateTime.now();
  DateTime _rangeStart = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _rangeEnd = DateTime.now();

  Set<String> _jobAssignableEmployeeIds(Job job) {
    final ids = <String>{...job.assignedEmployeeIds};
    final assignee = job.assigneeEmployeeId?.trim();
    if (assignee != null && assignee.isNotEmpty) {
      ids.add(assignee);
    }
    return ids;
  }

  Future<void> _managerBulkPunch({
    required TimesheetProvider prov,
    required bool isSignIn,
  }) async {
    final companyId = prov.currentCompanyId;
    if (companyId == null) return;

    List<MessageThread> groupThreads = const [];
    List<Job> rosterJobs = const [];
    try {
      final threads = await SupabaseTimesheetStorage.getMessageThreads(
        companyId: companyId,
      );
      groupThreads =
          threads.where((t) => t.isGroup).toList()
            ..sort(
              (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
            );
      final allJobs = await SupabaseTimesheetStorage.getJobs(
        companyId: companyId,
      );
      rosterJobs =
          allJobs
              .where(
                (j) =>
                    j.status == JobStatus.scheduled ||
                    j.status == JobStatus.inProgress,
              )
              .toList()
            ..sort(
              (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
            );
    } catch (_) {
      groupThreads = const [];
      rosterJobs = const [];
    }

    if (!mounted) return;

    final notesCtrl = TextEditingController();
    final selected = <String>{};
    _ManagerBulkScope scope = _ManagerBulkScope.manual;
    MessageThread? teamPick;
    Job? jobPick;
    List<String> teamMemberIds = const [];

    Future<void> refreshTeamMembers(StateSetter setLocal) async {
      teamMemberIds = const [];
      if (teamPick == null) return;
      teamMemberIds =
          await SupabaseTimesheetStorage.getMessageThreadMemberEmployeeIds(
            companyId: companyId,
            threadId: teamPick!.id,
          );
      setLocal(() {});
    }

    void applyScope(StateSetter setLocal) {
      setLocal(() {
        selected.clear();
        switch (scope) {
          case _ManagerBulkScope.manual:
            break;
          case _ManagerBulkScope.everyone:
            selected.addAll(prov.employees.map((e) => e.id));
            break;
          case _ManagerBulkScope.team:
            selected.addAll(
              teamMemberIds.where(
                (id) => prov.employees.any((e) => e.id == id),
              ),
            );
            break;
          case _ManagerBulkScope.job:
            if (jobPick != null) {
              final roster = _jobAssignableEmployeeIds(jobPick!);
              selected.addAll(
                roster.where((id) => prov.employees.any((e) => e.id == id)),
              );
            }
            break;
        }
      });
    }

    try {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) {
          Widget rosterHints() {
            if (scope == _ManagerBulkScope.team && teamPick != null) {
              return Text(
                teamMemberIds.isEmpty
                    ? 'Loading team roster…'
                    : '${teamMemberIds.length} member(s) in this channel (employees only).',
                style: GoogleFonts.poppins(
                  fontSize: 11,
                  color: const Color(0xFF6B7280),
                ),
              );
            }
            if (scope == _ManagerBulkScope.job && jobPick != null) {
              final n =
                  _jobAssignableEmployeeIds(
                    jobPick!,
                  ).where((id) => prov.employees.any((e) => e.id == id)).length;
              return Text(
                '$n assignee(s) on this job in your employee directory.',
                style: GoogleFonts.poppins(
                  fontSize: 11,
                  color: const Color(0xFF6B7280),
                ),
              );
            }
            return const SizedBox.shrink();
          }

          return AlertDialog(
            title: Text(
              isSignIn ? 'Manager bulk clock-in' : 'Manager bulk clock-out',
            ),
            content: SizedBox(
              width: 560,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Location is taken from this device so punches match where you stand.',
                      style: GoogleFonts.poppins(
                        fontSize: 12,
                        color: const Color(0xFF475569),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Who to clock',
                      style: GoogleFonts.poppins(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    if (prov.employees.isEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Text(
                          'No employees in the directory yet. Add people under Employees, then use '
                          '“Everyone in directory” or pick individuals.',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            color: const Color(0xFFB45309),
                          ),
                        ),
                      ),
                    RadioListTile<_ManagerBulkScope>(
                      dense: true,
                      title: const Text('Pick individually'),
                      value: _ManagerBulkScope.manual,
                      groupValue: scope,
                      onChanged: (v) {
                        if (v == null) return;
                        setLocal(() => scope = v);
                        applyScope(setLocal);
                      },
                    ),
                    RadioListTile<_ManagerBulkScope>(
                      dense: true,
                      title: const Text('Everyone in directory'),
                      subtitle: prov.employees.isEmpty
                          ? Text(
                              'Unavailable until you add employees.',
                              style: GoogleFonts.poppins(fontSize: 11),
                            )
                          : null,
                      value: _ManagerBulkScope.everyone,
                      groupValue: scope,
                      onChanged: prov.employees.isEmpty
                          ? null
                          : (v) {
                              if (v == null) return;
                              setLocal(() => scope = v);
                              applyScope(setLocal);
                            },
                    ),
                    RadioListTile<_ManagerBulkScope>(
                      dense: true,
                      title: const Text('Team (message channel)'),
                      subtitle: Text(
                        groupThreads.isEmpty
                            ? 'No team channels yet — create one under Messages.'
                            : 'Uses member list from the channel.',
                        style: GoogleFonts.poppins(fontSize: 11),
                      ),
                      value: _ManagerBulkScope.team,
                      groupValue: scope,
                      onChanged: groupThreads.isEmpty
                          ? null
                          : (v) {
                              if (v == null) return;
                              setLocal(() => scope = v);
                              applyScope(setLocal);
                            },
                    ),
                    if (scope == _ManagerBulkScope.team &&
                        groupThreads.isNotEmpty) ...[
                      DropdownButtonFormField<MessageThread>(
                        value: teamPick != null &&
                                groupThreads.any((t) => t.id == teamPick!.id)
                            ? teamPick
                            : null,
                        decoration: const InputDecoration(
                          labelText: 'Team channel',
                          isDense: true,
                        ),
                        items: groupThreads
                            .map(
                              (t) => DropdownMenuItem(
                                value: t,
                                child: Text(
                                  t.title,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: (t) async {
                          teamPick = t;
                          await refreshTeamMembers(setLocal);
                          applyScope(setLocal);
                        },
                      ),
                      const SizedBox(height: 6),
                      rosterHints(),
                    ],
                    RadioListTile<_ManagerBulkScope>(
                      dense: true,
                      title: const Text('Everyone on a job'),
                      subtitle: Text(
                        rosterJobs.isEmpty
                            ? 'No open jobs with assignments.'
                            : 'Uses assignees on scheduled / in-progress work.',
                        style: GoogleFonts.poppins(fontSize: 11),
                      ),
                      value: _ManagerBulkScope.job,
                      groupValue: scope,
                      onChanged: rosterJobs.isEmpty
                          ? null
                          : (v) {
                              if (v == null) return;
                              setLocal(() => scope = v);
                              applyScope(setLocal);
                            },
                    ),
                    if (scope == _ManagerBulkScope.job &&
                        rosterJobs.isNotEmpty) ...[
                      DropdownButtonFormField<Job>(
                        value: jobPick != null &&
                                rosterJobs.any((j) => j.id == jobPick!.id)
                            ? jobPick
                            : null,
                        decoration: const InputDecoration(
                          labelText: 'Job',
                          isDense: true,
                        ),
                        items: rosterJobs
                            .map(
                              (j) => DropdownMenuItem(
                                value: j,
                                child: Text(
                                  j.title,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: (j) {
                          jobPick = j;
                          applyScope(setLocal);
                        },
                      ),
                      const SizedBox(height: 6),
                      rosterHints(),
                    ],
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Wrap(
                        spacing: 8,
                        children: [
                          TextButton(
                            onPressed: prov.employees.isEmpty
                                ? null
                                : () => setLocal(() {
                                      scope = _ManagerBulkScope.manual;
                                      selected
                                        ..clear()
                                        ..addAll(
                                          prov.employees.map((e) => e.id),
                                        );
                                    }),
                            child: const Text('Select all'),
                          ),
                          TextButton(
                            onPressed: () =>
                                setLocal(() => selected.clear()),
                            child: const Text('Clear'),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(
                      height: 200,
                      child: ListView(
                        children: prov.employees
                            .map(
                              (e) => CheckboxListTile(
                                dense: true,
                                value: selected.contains(e.id),
                                onChanged: scope == _ManagerBulkScope.manual
                                    ? (v) => setLocal(() {
                                          if (v == true) {
                                            selected.add(e.id);
                                          } else {
                                            selected.remove(e.id);
                                          }
                                        })
                                    : null,
                                title: Text(e.fullName),
                                subtitle: Text(
                                  e.employeeCode.isNotEmpty
                                      ? e.employeeCode
                                      : e.id,
                                ),
                              ),
                            )
                            .toList(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: notesCtrl,
                      minLines: 2,
                      maxLines: 3,
                      decoration: const InputDecoration(
                        labelText: 'Notes (optional)',
                      ),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                onPressed: selected.isEmpty
                    ? null
                    : () => Navigator.of(ctx).pop(true),
                child: Text(
                  isSignIn ? 'Clock in selected' : 'Clock out selected',
                ),
              ),
            ],
          );
        },
      ),
    );
    if (ok != true) return;

    if (!mounted) return;
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (x) => PopScope(
        canPop: false,
        child: AlertDialog(
          content: Row(
            children: [
              const CircularProgressIndicator(),
              const SizedBox(width: 16),
              Expanded(
                child: Text(
                  'Getting location…',
                  style: GoogleFonts.poppins(fontSize: 13),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    final position = await LocationService.getCurrentPosition();
    String? address;
    if (position != null) {
      address = await LocationService.getAddressFromPosition(
        position.latitude,
        position.longitude,
      );
    }

    if (mounted) Navigator.of(context).pop();

      await SupabaseTimesheetStorage.managerBulkPunch(
        companyId: companyId,
        employeeIds: selected.toList(),
        isSignIn: isSignIn,
        notes: notesCtrl.text,
        latitude: position?.latitude,
        longitude: position?.longitude,
        address: address,
      );
      if (!mounted) return;
      showSuccessSnack(
        context,
        '${selected.length} worker(s) ${isSignIn ? 'clocked in' : 'clocked out'} successfully.',
      );
      setState(() {});
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Bulk clock action failed.'),
      );
    } finally {
      notesCtrl.dispose();
    }
  }

  Future<void> _hrSelfPunch({
    required TimesheetProvider prov,
    required Employee self,
    required bool signIn,
  }) async {
    final companyId = prov.currentCompanyId;
    if (companyId == null) return;

    String? note;
    if (!signIn) {
      note = await showDialog<String>(
        context: context,
        builder: (ctx) {
          final c = TextEditingController();
          return AlertDialog(
            title: const Text('Clock out note'),
            content: TextField(
              controller: c,
              decoration: const InputDecoration(
                hintText: 'Optional note',
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Skip'),
              ),
              ElevatedButton(
                onPressed: () => Navigator.pop(ctx, c.text),
                child: const Text('Continue'),
              ),
            ],
          );
        },
      );
      if (!mounted) return;
    }

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (x) => PopScope(
        canPop: false,
        child: AlertDialog(
          content: Row(
            children: [
              const CircularProgressIndicator(),
              const SizedBox(width: 16),
              Expanded(
                child: Text(
                  'Recording punch…',
                  style: GoogleFonts.poppins(fontSize: 13),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    try {
      final position = await LocationService.getCurrentPosition();
      String? address;
      if (position != null) {
        address = await LocationService.getAddressFromPosition(
          position.latitude,
          position.longitude,
        );
      }
      final trimmedNote = note?.trim().isEmpty == true ? null : note?.trim();
      final punch = TimePunch(
        employeeId: self.id,
        type: signIn ? PunchType.signIn : PunchType.signOut,
        dateTime: DateTime.now(),
        latitude: position?.latitude,
        longitude: position?.longitude,
        address: address,
        notes: trimmedNote,
      );
      final check = await SupabaseTimesheetStorage.validatePunchAgainstShift(
        companyId: companyId,
        employeeId: self.id,
        punchAt: punch.dateTime,
        latitude: punch.latitude,
        longitude: punch.longitude,
      );
      if (check != null && check['allowed'] == false) {
        if (mounted) Navigator.of(context).pop();
        if (!mounted) return;
        showErrorSnack(
          context,
          check['reason']?.toString() ??
              'Punch blocked by shift validation.',
        );
        return;
      }
      await SupabaseTimesheetStorage.insertPunch(
        punch,
        companyId: companyId,
      );
      final endOfRange = DateTime(
        _rangeEnd.year,
        _rangeEnd.month,
        _rangeEnd.day,
        23,
        59,
        59,
      );
      await prov.loadAllPunches(from: _rangeStart, to: endOfRange);
      if (mounted) Navigator.of(context).pop();
      if (!mounted) return;
      showSuccessSnack(
        context,
        signIn ? 'You clocked in.' : 'You clocked out.',
      );
      setState(() {});
    } catch (e) {
      if (mounted) Navigator.of(context).pop();
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Could not record your punch.'),
      );
    }
  }

  Widget _buildManagerSelfRow(TimesheetProvider prov) {
    final companyId = prov.currentCompanyId;
    if (companyId == null) return const SizedBox.shrink();

    return FutureBuilder<Employee?>(
      future: SupabaseTimesheetStorage.getEmployeeLinkedToCurrentAuthUser(
        companyId: companyId,
      ),
      builder: (context, snap) {
        final self = snap.data;
        if (snap.connectionState == ConnectionState.waiting && self == null) {
          return const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: LinearProgressIndicator(minHeight: 2),
          );
        }
        if (self == null) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFFFF7ED),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFFDBA74)),
              ),
              child: Text(
                'To clock yourself in/out here, your HR login must be linked to an '
                'employee profile (new companies: created automatically at signup). '
                'Otherwise link your email under Employees.',
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  color: const Color(0xFF9A3412),
                ),
              ),
            ),
          );
        }

        final punches =
            prov.allPunches.where((p) => p.employeeId == self.id).toList()
              ..sort((a, b) => b.dateTime.compareTo(a.dateTime));
        final last = punches.isEmpty ? null : punches.first;
        final clockedIn = last != null && last.isSignIn;

        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Card(
            color: const Color(0xFFF8FAFC),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
              side: const BorderSide(color: Color(0xFFE2E8F0)),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  Icon(
                    Icons.badge_outlined,
                    color: AppTheme.gold.withValues(alpha: 0.9),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Your attendance (${self.fullName})',
                          style: GoogleFonts.poppins(
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                          ),
                        ),
                        Text(
                          clockedIn
                              ? 'Currently clocked in • Last event ${_timeFormat.format(last.dateTime)}'
                              : 'Currently clocked out • Last event ${last == null ? '—' : _timeFormat.format(last.dateTime)}',
                          style: GoogleFonts.poppins(
                            fontSize: 11,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: () => _hrSelfPunch(
                      prov: prov,
                      self: self,
                      signIn: !clockedIn,
                    ),
                    style: FilledButton.styleFrom(
                      backgroundColor:
                          clockedIn ? Colors.red.shade700 : AppTheme.gold,
                      foregroundColor: Colors.white,
                    ),
                    icon: Icon(
                      clockedIn ? Icons.logout : Icons.login,
                      size: 18,
                    ),
                    label: Text(clockedIn ? 'Clock out' : 'Clock in'),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

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

  Widget buildSessionsTable(
    List<PunchSession> sessions, {
    bool includePaymentColumns = false,
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
        columns: [
          const DataColumn(label: Text('Date')),
          const DataColumn(label: Text('Full name')),
          const DataColumn(label: Text('ID')),
          const DataColumn(label: Text('Time In')),
          const DataColumn(label: Text('Time Out')),
          const DataColumn(label: Text('Regular hrs')),
          const DataColumn(label: Text('Overtime hrs')),
          const DataColumn(label: Text('Total hrs')),
          if (includePaymentColumns) ...[
            const DataColumn(label: Text('Payment')),
            const DataColumn(label: Text('Overtime Payment')),
            const DataColumn(label: Text('Payment Due')),
          ],
          const DataColumn(label: Text('In location')),
          const DataColumn(label: Text('Out location')),
          const DataColumn(label: Text('Notes')),
        ],
        rows: sessions.take(100).map((s) {
          return DataRow(
            cells: [
              DataCell(Text(_dateFormat.format(s.date))),
              DataCell(Text(s.fullName)),
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
              if (includePaymentColumns) ...[
                DataCell(Text('R ${s.monthlySalary.toStringAsFixed(2)}')),
                DataCell(Text('R ${s.overtimePayment.toStringAsFixed(2)}')),
                DataCell(Text('R ${s.paymentDue.toStringAsFixed(2)}')),
              ],
              DataCell(
                Text(
                  s.signInLocation != null &&
                          s.signInLocation!.trim().isNotEmpty
                      ? s.signInLocation!
                      : (s.signInLatitude != null && s.signInLongitude != null
                            ? '${s.signInLatitude!.toStringAsFixed(5)}, ${s.signInLongitude!.toStringAsFixed(5)}'
                            : '—'),
                  overflow: TextOverflow.ellipsis,
                  maxLines: 2,
                ),
              ),
              DataCell(
                Text(
                  s.signOutLocation != null &&
                          s.signOutLocation!.trim().isNotEmpty
                      ? s.signOutLocation!
                      : (s.signOutLatitude != null && s.signOutLongitude != null
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
          return const PremiumLoadingIndicator(label: 'Loading attendance...');
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
                    'Today overview',
                    style: GoogleFonts.poppins(
                      color: const Color(0xFF111827),
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  buildExportButton(
                    context: context,
                    fileName:
                        'daily_attendance_${DateFormat('yyyy_MM_dd').format(_dailyDate)}',
                    headers: sessionHeaders,
                    rows: sessionRows,
                  ),
                  const Spacer(),
                  OutlinedButton.icon(
                    onPressed: () =>
                        _managerBulkPunch(prov: prov, isSignIn: true),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppTheme.gold),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30),
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      foregroundColor: AppTheme.gold,
                    ),
                    icon: const Icon(Icons.group_add_outlined, size: 16),
                    label: const Text('Manager clock-in'),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: () =>
                        _managerBulkPunch(prov: prov, isSignIn: false),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppTheme.gold),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(30),
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      foregroundColor: AppTheme.gold,
                    ),
                    icon: const Icon(Icons.group_off_outlined, size: 16),
                    label: const Text('Manager clock-out'),
                  ),
                  const SizedBox(width: 8),
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
              _buildManagerSelfRow(prov),
              const SizedBox(height: 16),
              Text(
                'Total punches: ${sessions.length}',
                style: GoogleFonts.poppins(
                  color: const Color(0xFF6B7280),
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
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
                    child: buildSessionsTable(sessions),
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

  Widget _buildAllPunches(TimesheetProvider prov) {
    final employees = {for (var e in prov.employees) e.id: e};
    final sessions = PunchSession.fromPunches(prov.allPunches, employees);
    final headers = [
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
    final rows = sessions
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

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'All Punches',
                style: GoogleFonts.poppins(
                  color: const Color(0xFF111827),
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: 8),
              buildExportButton(
                context: context,
                fileName:
                    'all_punches_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
                headers: headers,
                rows: rows,
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
          const SizedBox(height: 16),
          Text(
            'Total punches: ${sessions.length}',
            style: GoogleFonts.poppins(
              color: const Color(0xFF6B7280),
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 12),
          Card(
            color: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(24),
            ),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: buildSessionsTable(sessions),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    return DefaultTabController(
      length: 4,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            margin: const EdgeInsets.fromLTRB(16, 16, 16, 8),
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
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
              unselectedLabelStyle: GoogleFonts.poppins(
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
              tabs: const [
                Tab(
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 22, vertical: 6),
                    child: Text('Daily', textAlign: TextAlign.center),
                  ),
                ),
                Tab(
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 22, vertical: 6),
                    child: Text('Weekly', textAlign: TextAlign.center),
                  ),
                ),
                Tab(
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 22, vertical: 6),
                    child: Text('Monthly', textAlign: TextAlign.center),
                  ),
                ),
                Tab(
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 22, vertical: 6),
                    child: Text('All Punches', textAlign: TextAlign.center),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Expanded(
            child: TabBarView(
              children: [
                _buildDailyView(prov),
                _buildAllPunches(prov),
                _buildAllPunches(prov),
                _buildAllPunches(prov),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
