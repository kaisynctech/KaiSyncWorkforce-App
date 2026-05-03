import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme/app_theme.dart';
import '../models/incident_report.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import '_dashboard_decorators.dart';
import 'hr_incident_details_screen.dart';

class HrIncidentsSection extends StatefulWidget {
  const HrIncidentsSection({super.key});

  @override
  State<HrIncidentsSection> createState() => _HrIncidentsSectionState();
}

class _HrIncidentsSectionState extends State<HrIncidentsSection> {
  String _incidentView = 'all';

  Future<void> _showCreateIncidentDialog() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final employees = context.read<TimesheetProvider>().employees;
    if (employees.isEmpty) {
      showInfoSnack(context, 'Create employees first.');
      return;
    }
    String selectedEmployeeId = employees.first.id;
    String selectedSeverity = 'medium';
    final descCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setStateDialog) => AlertDialog(
          title: const Text('New incident'),
          content: SizedBox(
            width: 460,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: selectedEmployeeId,
                  decoration: const InputDecoration(labelText: 'Employee'),
                  items: employees
                      .map((e) => DropdownMenuItem(value: e.id, child: Text(e.fullName)))
                      .toList(),
                  onChanged: (v) {
                    if (v == null) return;
                    setStateDialog(() => selectedEmployeeId = v);
                  },
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: selectedSeverity,
                  decoration: const InputDecoration(labelText: 'Severity'),
                  items: const [
                    DropdownMenuItem(value: 'low', child: Text('Low')),
                    DropdownMenuItem(value: 'medium', child: Text('Medium')),
                    DropdownMenuItem(value: 'high', child: Text('High')),
                  ],
                  onChanged: (v) {
                    if (v == null) return;
                    setStateDialog(() => selectedSeverity = v);
                  },
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: descCtrl,
                  maxLines: 4,
                  decoration: const InputDecoration(labelText: 'Description'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
            ElevatedButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Submit')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    if (!mounted) return;
    final desc = descCtrl.text.trim();
    if (desc.isEmpty) {
      showInfoSnack(context, 'Description is required.');
      return;
    }
    await SupabaseTimesheetStorage.insertIncident(
      IncidentReport(
        id: '',
        employeeId: selectedEmployeeId,
        description: desc,
        severity: selectedSeverity,
        createdAt: DateTime.now(),
      ),
      companyId: companyId,
    );
    if (!mounted) return;
    showSuccessSnack(context, 'Incident added.');
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    final currentUserId = Supabase.instance.client.auth.currentUser?.id;
    final isCompact = MediaQuery.of(context).size.width < 1180;

    return FutureBuilder<List<dynamic>>(
      future: Future.wait([
        SupabaseTimesheetStorage.getIncidents(companyId: companyId),
        if (companyId != null)
          SupabaseTimesheetStorage.getSubmissionRecipientsForType(
            companyId: companyId,
            submissionType: 'incident',
          )
        else
          Future.value(<String, List<String>>{}),
      ]),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load incidents.'),
            onRetry: () => setState(() {}),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
        }
        final allIncidents = snapshot.data![0] as List<IncidentReport>;
        final recipientsMap = snapshot.data![1] as Map<String, List<String>>;
        final incidents = _incidentView == 'assigned_to_me' && currentUserId != null
            ? allIncidents.where((i) => (recipientsMap[i.id] ?? const []).contains(currentUserId)).toList()
            : allIncidents;
        final headers = ['Employee ID', 'Severity', 'Created at', 'Description'];
        final rows = incidents
            .map((inc) => [
                  inc.employeeId,
                  inc.severity ?? '—',
                  DateFormat('yyyy-MM-dd HH:mm').format(inc.createdAt),
                  inc.description,
                ])
            .toList();

        return Stack(
          children: [
            ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
              children: [
                Padding(
                  padding: const EdgeInsets.only(left: 4, right: 4, bottom: 16),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        'Incidents',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF111827),
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: 8),
                      buildExportButton(
                        context: context,
                        fileName: 'incidents_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
                        headers: headers,
                        rows: rows,
                      ),
                      const SizedBox(width: 8),
                      SegmentedButton<String>(
                        segments: const [
                          ButtonSegment(value: 'all', label: Text('All')),
                          ButtonSegment(value: 'assigned_to_me', label: Text('Assigned')),
                        ],
                        selected: {_incidentView},
                        onSelectionChanged: (v) => setState(() => _incidentView = v.first),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(24),
                          border: Border.all(color: const Color(0xFFE5E7EB)),
                        ),
                        child: Text(
                          '${incidents.length} total',
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ),
                if (incidents.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Center(
                      child: Text(
                        'No incidents reported.',
                        style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                      ),
                    ),
                  )
                else
                  Card(
                    color: Colors.white,
                    elevation: 4,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: const BorderSide(color: Color(0xFFE5E7EB)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: DataTable(
                          headingRowColor: WidgetStateProperty.all(const Color(0xFFF9FAFB)),
                          columnSpacing: isCompact ? 12 : 20,
                          headingRowHeight: isCompact ? 40 : 52,
                          dataRowMinHeight: isCompact ? 38 : 46,
                          dataRowMaxHeight: isCompact ? 52 : 64,
                          columns: const [
                            DataColumn(label: Text('Employee ID')),
                            DataColumn(label: Text('Severity')),
                            DataColumn(label: Text('Created at')),
                            DataColumn(label: Text('Description')),
                            DataColumn(label: Text('')),
                          ],
                          rows: incidents.map((inc) {
                            return DataRow(
                              cells: [
                                DataCell(Text(inc.employeeId)),
                                DataCell(Text(inc.severity ?? '—')),
                                DataCell(Text(DateFormat('yyyy-MM-dd HH:mm').format(inc.createdAt))),
                                DataCell(
                                  SizedBox(
                                    width: 340,
                                    child: Text(
                                      inc.description,
                                      overflow: TextOverflow.ellipsis,
                                      maxLines: 2,
                                    ),
                                  ),
                                ),
                                DataCell(
                                  IconButton(
                                    tooltip: 'Open',
                                    icon: const Icon(Icons.chevron_right, color: AppTheme.gold),
                                    onPressed: () => Navigator.of(context).push(
                                      MaterialPageRoute(
                                        builder: (_) => HrIncidentDetailsScreen(
                                          incident: inc,
                                          employees: context.read<TimesheetProvider>().employees,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            );
                          }).toList(),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            Positioned(
              right: 16,
              bottom: 16,
              child: FloatingActionButton(
                onPressed: _showCreateIncidentDialog,
                backgroundColor: AppTheme.gold,
                foregroundColor: Colors.white,
                child: const Icon(Icons.add),
              ),
            ),
          ],
        );
      },
    );
  }
}
