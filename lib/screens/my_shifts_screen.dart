import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';

class MyShiftsScreen extends StatefulWidget {
  final bool embedded;

  const MyShiftsScreen({super.key, this.embedded = false});

  @override
  State<MyShiftsScreen> createState() => _MyShiftsScreenState();
}

class _MyShiftsScreenState extends State<MyShiftsScreen> {
  Future<void> _respond(String assignmentId, String shiftId, String status) async {
    final timesheet = context.read<TimesheetProvider>();
    final companyId = timesheet.currentCompanyId;
    final employeeId = timesheet.currentEmployee?.id;
    if (companyId == null || employeeId == null) return;
    await SupabaseTimesheetStorage.upsertShiftAssignment(
      companyId: companyId,
      shiftId: shiftId,
      employeeId: employeeId,
      status: status,
    );
    if (!mounted) return;
    showSuccessSnack(context, 'Shift ${status == 'accepted' ? 'accepted' : 'declined'}.');
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = Responsive.horizontalPadding(context);
    final timesheet = context.watch<TimesheetProvider>();
    final companyId = timesheet.currentCompanyId;
    final employeeId = timesheet.currentEmployee?.id;
    if (companyId == null || employeeId == null) {
      return Center(child: Text('No employee selected.', style: GoogleFonts.poppins()));
    }
    final list = FutureBuilder<List<Map<String, dynamic>>>(
      future: SupabaseTimesheetStorage.getShiftAssignmentsForEmployee(
        companyId: companyId,
        employeeId: employeeId,
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
        final assignments = snapshot.data ?? const <Map<String, dynamic>>[];
        if (assignments.isEmpty) {
          return Center(
            child: Text('No shifts assigned yet.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280))),
          );
        }
        return ListView(
          padding: EdgeInsets.all(horizontalPadding),
          children: assignments.map((a) {
            final shift = Map<String, dynamic>.from((a['shifts'] as Map?) ?? const {});
            final start = DateTime.tryParse(shift['starts_at']?.toString() ?? '');
            final end = DateTime.tryParse(shift['ends_at']?.toString() ?? '');
            final status = a['status']?.toString() ?? 'offered';
            final isOffer = status == 'offered';
            return Card(
              child: ListTile(
                title: Text(shift['title']?.toString() ?? 'Shift'),
                subtitle: Text(
                  '${start != null ? DateFormat('EEE d MMM h:mm a').format(start) : '—'}'
                  ' -> ${end != null ? DateFormat('h:mm a').format(end) : '—'} | '
                  'Status: $status',
                ),
                trailing: isOffer
                    ? Wrap(
                        spacing: 4,
                        children: [
                          TextButton(
                            onPressed: () => _respond(a['id'].toString(), a['shift_id'].toString(), 'accepted'),
                            child: const Text('Accept'),
                          ),
                          TextButton(
                            onPressed: () => _respond(a['id'].toString(), a['shift_id'].toString(), 'declined'),
                            child: const Text('Decline'),
                          ),
                        ],
                      )
                    : null,
              ),
            );
          }).toList(),
        );
      },
    );

    if (widget.embedded) {
      return Padding(
        padding: EdgeInsets.all(horizontalPadding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Shifts', style: GoogleFonts.poppins(fontSize: 20, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Expanded(
              child: Card(
                child: list,
              ),
            ),
          ],
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Shifts')),
      body: list,
    );
  }
}
