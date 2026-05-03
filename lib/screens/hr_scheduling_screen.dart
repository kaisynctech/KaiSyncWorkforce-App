import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/employee.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/export_service.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';

class HrSchedulingScreen extends StatefulWidget {
  final bool embedded;
  const HrSchedulingScreen({super.key, this.embedded = false});

  @override
  State<HrSchedulingScreen> createState() => _HrSchedulingScreenState();
}

class _HrSchedulingScreenState extends State<HrSchedulingScreen> {
  final DateTime _from = DateTime.now().subtract(const Duration(days: 1));
  final DateTime _to = DateTime.now().add(const Duration(days: 14));

  Future<List<String>> _resolveBranchOptions({
    required String companyId,
    required List<Employee> employees,
  }) async {
    final managed = await SupabaseTimesheetStorage.getCompanyBranches(companyId: companyId);
    final inferred = employees
        .map((e) => e.branch.trim())
        .where((b) => b.isNotEmpty);
    final branches = <String>{...managed, ...inferred}.toList()
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return branches;
  }

  Future<void> _addShift() async {
    final pageContext = context;
    final companyId = pageContext.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final employees = pageContext.read<TimesheetProvider>().employees;
    if (employees.isEmpty) {
      showErrorSnack(context, 'No employees loaded. Create employees first.');
      return;
    }

    final titleCtrl = TextEditingController();
    final headcountCtrl = TextEditingController(text: '1');
    final jobs = await SupabaseTimesheetStorage.getJobs(companyId: companyId);

    DateTime start = DateTime.now().add(const Duration(hours: 2));
    DateTime end = start.add(const Duration(hours: 8));
    final selectedEmployeeIds = <String>{};

    final branches = await _resolveBranchOptions(companyId: companyId, employees: employees);
    String selectedBranch = branches.isNotEmpty ? branches.first : '';
    final branchCtrl = TextEditingController();
    String? pickedEmployeeId;
    String? selectedJobId;

    Future<void> pickDateTime({
      required bool isStart,
    }) async {
      final initial = isStart ? start : end;
      final now = DateTime.now();
      final pickedDate = await showDatePicker(
        context: context,
        initialDate: initial,
        firstDate: DateTime(now.year - 1),
        lastDate: DateTime(now.year + 3),
      );
      if (pickedDate == null || !mounted) return;
      final pickedTime = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(initial),
      );
      if (pickedTime == null || !mounted) return;

      final newDt = DateTime(pickedDate.year, pickedDate.month, pickedDate.day, pickedTime.hour, pickedTime.minute);
      if (isStart) {
        start = newDt;
        // Keep a sensible duration if user moved the start past the end.
        if (end.isBefore(start) || end.isAtSameMomentAs(start)) {
          end = start.add(const Duration(hours: 8));
        }
      } else {
        end = newDt;
        if (end.isBefore(start) || end.isAtSameMomentAs(start)) {
          start = end.subtract(const Duration(hours: 8));
        }
      }
    }

    if (!pageContext.mounted) return;
    final ok = await showDialog<bool>(
      context: pageContext,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setStateDialog) {
            String format(DateTime dt) => DateFormat('EEE d MMM y, h:mm a').format(dt);
            final filteredEmployees = branches.isNotEmpty
                ? employees.where((e) => e.branch.trim() == selectedBranch).toList()
                : employees;

            return AlertDialog(
              title: const Text('Create shift'),
              content: SizedBox(
                width: double.maxFinite,
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(
                        controller: titleCtrl,
                        decoration: const InputDecoration(labelText: 'Shift title'),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Schedule',
                        style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12, color: const Color(0xFF111827)),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () async {
                                await pickDateTime(isStart: true);
                                if (!mounted) return;
                                setStateDialog(() {});
                              },
                              icon: const Icon(Icons.play_arrow_outlined, size: 18),
                              label: Text(
                                'Start: ${format(start)}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () async {
                                await pickDateTime(isStart: false);
                                if (!mounted) return;
                                setStateDialog(() {});
                              },
                              icon: const Icon(Icons.stop_circle_outlined, size: 18),
                              label: Text(
                                'End: ${format(end)}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: headcountCtrl,
                        keyboardType: const TextInputType.numberWithOptions(signed: false, decimal: false),
                        decoration: const InputDecoration(labelText: 'Required headcount'),
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String?>(
                        initialValue: selectedJobId,
                        decoration: const InputDecoration(labelText: 'Linked job (optional)', isDense: true),
                        items: [
                          const DropdownMenuItem<String?>(
                            value: null,
                            child: Text('— Not linked to a job —'),
                          ),
                          ...jobs.map(
                            (j) => DropdownMenuItem<String?>(
                              value: j.id,
                              child: Text(j.title, overflow: TextOverflow.ellipsis),
                            ),
                          ),
                        ],
                        onChanged: (v) => setStateDialog(() => selectedJobId = v),
                      ),
                      const SizedBox(height: 12),
                      if (branches.isNotEmpty) ...[
                        Text(
                          'Priority location (branch)',
                          style: GoogleFonts.poppins(
                            fontWeight: FontWeight.w600,
                            fontSize: 12,
                            color: const Color(0xFF111827),
                          ),
                        ),
                        const SizedBox(height: 8),
                        DropdownButtonFormField<String>(
                          initialValue: selectedBranch,
                          decoration: const InputDecoration(isDense: true),
                          items: branches
                              .map(
                                (b) => DropdownMenuItem<String>(
                                  value: b,
                                  child: Text(b),
                                ),
                              )
                              .toList(),
                          onChanged: (v) {
                            if (v == null) return;
                            setStateDialog(() {
                              selectedBranch = v;
                              // Remove already-picked employees that don't match the new branch.
                              selectedEmployeeIds.removeAll(
                                selectedEmployeeIds.where((id) {
                                  final emp = employees.firstWhere((e) => e.id == id, orElse: () => employees.first);
                                  return emp.branch.trim() != selectedBranch;
                                }),
                              );
                              pickedEmployeeId = null;
                            });
                          },
                        ),
                        const SizedBox(height: 12),
                      ] else
                        TextField(
                          controller: branchCtrl,
                          decoration: const InputDecoration(labelText: 'Branch (optional)'),
                        ),
                      Text(
                        'Assign employees (offered)',
                        style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12, color: const Color(0xFF111827)),
                      ),
                      const SizedBox(height: 8),
                      if (filteredEmployees.isEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: Text(
                            'No employees found for this branch.',
                            style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                          ),
                        )
                      else ...[
                        DropdownButtonFormField<String>(
                          initialValue: pickedEmployeeId,
                          decoration: const InputDecoration(
                            isDense: true,
                            hintText: 'Select employee to add',
                          ),
                          items: filteredEmployees
                              .where((e) => !selectedEmployeeIds.contains(e.id))
                              .map(
                                (e) => DropdownMenuItem<String>(
                                  value: e.id,
                                  child: Text(
                                    e.fullName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: (v) {
                            if (v == null) return;
                            setStateDialog(() {
                              selectedEmployeeIds.add(v);
                              pickedEmployeeId = null;
                            });
                          },
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: selectedEmployeeIds.map((empId) {
                            final emp = employees.firstWhere((e) => e.id == empId, orElse: () => employees.first);
                            return Chip(
                              label: Text(
                                emp.fullName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              onDeleted: () {
                                setStateDialog(() {
                                  selectedEmployeeIds.remove(empId);
                                });
                              },
                            );
                          }).toList(),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
                ElevatedButton(
                  onPressed: () async {
                    final title = titleCtrl.text.trim();
                    final headcount = int.tryParse(headcountCtrl.text.trim()) ?? 1;
                    if (title.isEmpty) {
                      showInfoSnack(context, 'Please enter a shift title.');
                      return;
                    }
                    if (headcount <= 0) {
                      showInfoSnack(context, 'Headcount must be at least 1.');
                      return;
                    }
                    if (end.isAtSameMomentAs(start) || end.isBefore(start)) {
                      showErrorSnack(context, 'End time must be after start time.');
                      return;
                    }
                    if (selectedEmployeeIds.isEmpty) {
                      showInfoSnack(context, 'Select at least one employee to assign.');
                      return;
                    }

                    Navigator.pop(dialogContext, true);
                  },
                  child: const Text('Save'),
                ),
              ],
            );
          },
        );
      },
    );
    if (!mounted) return;
    if (ok != true) return;
    try {
      final title = titleCtrl.text.trim();
      final requiredHeadcount = int.tryParse(headcountCtrl.text.trim()) ?? 1;
      final branch = branches.isNotEmpty
          ? (selectedBranch.isNotEmpty ? selectedBranch : null)
          : (branchCtrl.text.trim().isEmpty ? null : branchCtrl.text.trim());

      final shiftId = await SupabaseTimesheetStorage.upsertShiftReturningId(
        companyId: companyId,
        jobId: selectedJobId,
        title: title,
        startsAt: start,
        endsAt: end,
        requiredHeadcount: requiredHeadcount,
        branch: branch,
      );
      if (shiftId == null) {
        if (!mounted) return;
        showErrorSnack(context, 'Shift created failed (no shift id returned).');
        return;
      }

      final suggestions = await SupabaseTimesheetStorage.suggestAssignmentsForShift(
        companyId: companyId,
        shiftId: shiftId,
      );
      final suggestionByEmpId = <String, Map<String, dynamic>>{
        for (final s in suggestions) s['employee_id'].toString(): s,
      };

      for (final empId in selectedEmployeeIds) {
        final s = suggestionByEmpId[empId];
        await SupabaseTimesheetStorage.upsertShiftAssignment(
          companyId: companyId,
          shiftId: shiftId,
          employeeId: empId,
          status: 'offered',
          score: (s?['score'] as num?)?.toDouble(),
          scoreReason: s?['score_reason']?.toString(),
        );
      }
      if (!mounted) return;
      showSuccessSnack(context, 'Shift created.');
      setState(() {});
    } catch (e) {
      AppTelemetry.logError(screen: 'hr_scheduling_screen', action: 'add_shift', error: e);
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not create shift.'));
    }
  }

  Future<void> _editShift(Map<String, dynamic> shift) async {
    final pageContext = context;
    final companyId = pageContext.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;

    final shiftId = shift['id']?.toString();
    if (shiftId == null || shiftId.isEmpty) return;

    final titleInitial = shift['title']?.toString() ?? '';
    final jobIdInitial = shift['job_id']?.toString();
    final startsInitial = DateTime.tryParse(shift['starts_at']?.toString() ?? '') ?? DateTime.now();
    final endsInitial = DateTime.tryParse(shift['ends_at']?.toString() ?? '') ?? startsInitial.add(const Duration(hours: 8));
    final requiredInitial = int.tryParse(shift['required_headcount']?.toString() ?? '') ?? (shift['required_headcount'] is num ? (shift['required_headcount'] as num).toInt() : 1);
    final statusInitial = shift['status']?.toString() ?? 'open';
    final branchInitial = shift['branch']?.toString();

    final employees = pageContext.read<TimesheetProvider>().employees;
    final jobs = await SupabaseTimesheetStorage.getJobs(companyId: companyId);
    final branches = await _resolveBranchOptions(companyId: companyId, employees: employees);

    final titleCtrl = TextEditingController(text: titleInitial);
    final headcountCtrl = TextEditingController(text: requiredInitial.toString());

    DateTime start = startsInitial;
    DateTime end = endsInitial;
    String? selectedJobId = jobIdInitial;
    String? selectedBranch = branches.isNotEmpty ? (branchInitial?.isNotEmpty == true ? branchInitial : branches.first) : branchInitial;
    final branchCtrl = TextEditingController(text: selectedBranch ?? '');

    Future<void> pickDateTime({required bool isStart}) async {
      final now = DateTime.now();
      final initial = isStart ? start : end;
      final pickedDate = await showDatePicker(
        context: context,
        initialDate: initial,
        firstDate: DateTime(now.year - 1),
        lastDate: DateTime(now.year + 3),
      );
      if (pickedDate == null || !mounted) return;
      final pickedTime = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(initial),
      );
      if (pickedTime == null || !mounted) return;

      final dt = DateTime(pickedDate.year, pickedDate.month, pickedDate.day, pickedTime.hour, pickedTime.minute);
      setState(() {
        if (isStart) {
          start = dt;
          if (end.isBefore(start) || end.isAtSameMomentAs(start)) {
            end = start.add(const Duration(hours: 8));
          }
        } else {
          end = dt;
          if (end.isBefore(start) || end.isAtSameMomentAs(start)) {
            start = end.subtract(const Duration(hours: 8));
          }
        }
      });
    }

    try {
      if (!pageContext.mounted) return;
      final ok = await showDialog<bool>(
        context: pageContext,
        builder: (dialogContext) {
          return StatefulBuilder(
            builder: (context, setStateDialog) {
              String format(DateTime dt) => DateFormat('EEE d MMM y, h:mm a').format(dt);
              return AlertDialog(
                title: const Text('Edit shift'),
                content: SizedBox(
                  width: double.maxFinite,
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        TextField(
                          controller: titleCtrl,
                          decoration: const InputDecoration(labelText: 'Shift title'),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: () async {
                                  await pickDateTime(isStart: true);
                                  setStateDialog(() {});
                                },
                                icon: const Icon(Icons.play_arrow_outlined, size: 18),
                                label: Text(
                                  'Start: ${format(start)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: () async {
                                  await pickDateTime(isStart: false);
                                  setStateDialog(() {});
                                },
                                icon: const Icon(Icons.stop_circle_outlined, size: 18),
                                label: Text(
                                  'End: ${format(end)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: headcountCtrl,
                          keyboardType: const TextInputType.numberWithOptions(signed: false, decimal: false),
                          decoration: const InputDecoration(labelText: 'Required headcount'),
                        ),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String?>(
                          initialValue: selectedJobId,
                          decoration: const InputDecoration(
                            isDense: true,
                            labelText: 'Linked job (optional)',
                          ),
                          items: [
                            const DropdownMenuItem<String?>(
                              value: null,
                              child: Text('— Not linked to a job —'),
                            ),
                            ...jobs.map((j) => DropdownMenuItem<String?>(
                                  value: j.id,
                                  child: Text(j.title, overflow: TextOverflow.ellipsis),
                                )),
                          ],
                          onChanged: (v) => setStateDialog(() => selectedJobId = v),
                        ),
                        const SizedBox(height: 12),
                        if (branches.isNotEmpty)
                          DropdownButtonFormField<String>(
                            initialValue: selectedBranch,
                            decoration: const InputDecoration(isDense: true, labelText: 'Priority location (branch)'),
                            items: branches
                                .map((b) => DropdownMenuItem<String>(value: b, child: Text(b)))
                                .toList(),
                            onChanged: (v) {
                              if (v == null) return;
                              setStateDialog(() => selectedBranch = v);
                            },
                          )
                        else
                          TextField(
                            decoration: const InputDecoration(labelText: 'Branch (optional)'),
                            controller: branchCtrl,
                            onChanged: (v) => selectedBranch = v.trim().isEmpty ? null : v.trim(),
                          ),
                      ],
                    ),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(dialogContext, false),
                    child: const Text('Cancel'),
                  ),
                  ElevatedButton(
                    onPressed: () {
                      final title = titleCtrl.text.trim();
                      final required = int.tryParse(headcountCtrl.text.trim()) ?? requiredInitial;
                      if (title.isEmpty) {
                        showInfoSnack(context, 'Shift title is required.');
                        return;
                      }
                      if (required <= 0) {
                        showInfoSnack(context, 'Headcount must be at least 1.');
                        return;
                      }
                      if (end.isBefore(start) || end.isAtSameMomentAs(start)) {
                        showErrorSnack(context, 'End time must be after start time.');
                        return;
                      }
                      Navigator.pop(dialogContext, true);
                    },
                    child: const Text('Save'),
                  ),
                ],
              );
            },
          );
        },
      );

      if (!mounted) return;
      if (ok != true) return;

      final title = titleCtrl.text.trim();
      final required = int.tryParse(headcountCtrl.text.trim()) ?? requiredInitial;
      if (branches.isEmpty) {
        selectedBranch = branchCtrl.text.trim().isEmpty ? null : branchCtrl.text.trim();
      }
      await SupabaseTimesheetStorage.upsertShift(
        companyId: companyId,
        id: shiftId,
        jobId: selectedJobId,
        title: title,
        startsAt: start,
        endsAt: end,
        requiredHeadcount: required,
        branch: selectedBranch,
        status: statusInitial,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Shift updated.');
      setState(() {});
    } catch (e) {
      AppTelemetry.logError(screen: 'hr_scheduling_screen', action: 'edit_shift', error: e);
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not update shift.'));
    }
  }

  Future<void> _exportSchedule(List<Map<String, dynamic>> shifts) async {
    try {
      await ExportService.exportTable(
        fileBaseName: 'schedule_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
        headers: const ['Title', 'Starts', 'Ends', 'Status', 'Headcount', 'Branch'],
        rows: shifts
            .map((s) => [
                  s['title']?.toString() ?? '',
                  s['starts_at']?.toString() ?? '',
                  s['ends_at']?.toString() ?? '',
                  s['status']?.toString() ?? '',
                  s['required_headcount']?.toString() ?? '',
                  s['branch']?.toString() ?? '—',
                ])
            .toList(),
        format: ExportFormat.csv,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Schedule export completed.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Schedule export failed.'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final companyId = context.watch<TimesheetProvider>().currentCompanyId;
    if (companyId == null) {
      if (widget.embedded) {
        return const Center(child: Text('No company selected.'));
      }
      return Scaffold(
        appBar: AppBar(title: const Text('Scheduling')),
        body: const Center(child: Text('No company selected.')),
      );
    }
    final content = FutureBuilder<List<Map<String, dynamic>>>(
      future: SupabaseTimesheetStorage.getShifts(
        companyId: companyId,
        from: _from,
        to: _to,
      ),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load shifts.'),
            onRetry: () => setState(() {}),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
        }
        final shifts = snapshot.data ?? const <Map<String, dynamic>>[];
        final fillRate = shifts.isEmpty
            ? 0.0
            : shifts.where((s) => s['status'] == 'filled' || s['status'] == 'completed').length / shifts.length;
        final horizontalPadding = Responsive.horizontalPadding(context);
        return ListView(
          padding: EdgeInsets.all(horizontalPadding),
          children: [
            Wrap(
              spacing: 10,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  'Schedule board',
                  style: GoogleFonts.poppins(fontSize: 20, fontWeight: FontWeight.w600),
                ),
                Text(
                  'Fill rate ${(fillRate * 100).toStringAsFixed(0)}%',
                  style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                ),
                OutlinedButton.icon(
                  onPressed: () => _exportSchedule(shifts),
                  icon: const Icon(Icons.download_outlined, size: 18),
                  label: const Text('Export'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (shifts.isEmpty)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('No shifts yet.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280))),
                ),
              )
            else
              Card(
                color: Colors.white,
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    headingRowColor: WidgetStateProperty.all(const Color(0xFFF9FAFB)),
                    columnSpacing: 22,
                    columns: const [
                      DataColumn(label: Text('Title')),
                      DataColumn(label: Text('Job')),
                      DataColumn(label: Text('Starts')),
                      DataColumn(label: Text('Ends')),
                      DataColumn(label: Text('Status')),
                      DataColumn(label: Text('Needed')),
                      DataColumn(label: Text('Branch')),
                      DataColumn(label: Text('Actions')),
                    ],
                    rows: shifts.map((s) {
                      final start = DateTime.tryParse(s['starts_at']?.toString() ?? '');
                      final end = DateTime.tryParse(s['ends_at']?.toString() ?? '');
                      return DataRow(
                        cells: [
                          DataCell(Text(s['title']?.toString() ?? 'Shift')),
                          DataCell(Text(s['job_id']?.toString() ?? '—')),
                          DataCell(
                            Text(
                              start != null ? DateFormat('EEE d MMM h:mm a').format(start) : '—',
                            ),
                          ),
                          DataCell(
                            Text(
                              end != null ? DateFormat('EEE d MMM h:mm a').format(end) : '—',
                            ),
                          ),
                          DataCell(Text(s['status']?.toString() ?? '—')),
                          DataCell(Text(s['required_headcount']?.toString() ?? '—')),
                          DataCell(Text(s['branch']?.toString() ?? '—')),
                          DataCell(
                            Align(
                              alignment: Alignment.centerLeft,
                              child: IconButton(
                                tooltip: 'Edit shift',
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
                                onPressed: () => _editShift(s),
                                icon: const Icon(Icons.edit_outlined, size: 18, color: AppTheme.gold),
                              ),
                            ),
                          ),
                        ],
                      );
                    }).toList(),
                  ),
                ),
              ),
          ],
        );
      },
    );
    if (widget.embedded) {
      return Stack(
        children: [
          content,
          Positioned(
            right: 16,
            bottom: 16,
            child: FloatingActionButton(
              tooltip: 'Add shift',
              onPressed: _addShift,
              backgroundColor: AppTheme.gold,
              foregroundColor: Colors.black,
              child: const Icon(Icons.add),
            ),
          ),
        ],
      );
    }
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text('Smart Scheduling', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
        actions: [
          if (Responsive.isPhone(context))
            IconButton(
              tooltip: 'Add shift',
              onPressed: _addShift,
              icon: const Icon(Icons.add_circle_outline, color: AppTheme.gold),
            )
          else
            TextButton.icon(
              onPressed: _addShift,
              icon: const Icon(Icons.add, color: AppTheme.gold, size: 18),
              label: Text(
                'Add shift',
                style: GoogleFonts.poppins(
                  color: const Color(0xFF111827),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
        ],
      ),
      body: content,
    );
  }
}
