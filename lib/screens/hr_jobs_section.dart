import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme/app_theme.dart';
import '../models/employee.dart';
import '../models/job.dart';
import '../models/client.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/load_error_panel.dart';
import '../widgets/app_feedback.dart';
import 'hr_create_job_screen.dart';
import 'hr_job_details_screen.dart';
import 'client_detail_screen.dart';
import '_dashboard_decorators.dart';
import '../strings/workspace_terms.dart';

class HrJobsSection extends StatefulWidget {
  const HrJobsSection({super.key});

  @override
  State<HrJobsSection> createState() => _HrJobsSectionState();
}

class _HrJobsSectionState extends State<HrJobsSection> {
  String _jobView = 'all';
  String? _editingGlobalDealId;
  bool _addingGlobalDealRow = false;
  static const String _newGlobalDealRowId = '__new_global_deal__';
  String? _newGlobalDealClientId;
  final Map<String, String> _dealRowTitle = {};
  final Map<String, String> _dealRowStatus = {};
  final Map<String, String> _dealRowOffer = {};
  final Map<String, String> _dealRowFinal = {};
  final Map<String, String> _dealRowPaymentStatus = {};

  Widget _statusChip(String status) {
    final normalized = status.toLowerCase().trim();
    final (Color color, String label) = switch (normalized) {
      'approved' || 'paid' || 'won' => (const Color(0xFF059669), normalized),
      'partial' || 'sent' || 'accepted' => (const Color(0xFF2563EB), normalized),
      'declined' || 'rejected' || 'lost' || 'overdue' => (const Color(0xFFDC2626), normalized),
      _ => (const Color(0xFFB45309), normalized.isEmpty ? 'pending' : normalized),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        label,
        style: GoogleFonts.poppins(
          color: color,
          fontWeight: FontWeight.w700,
          fontSize: 10,
        ),
      ),
    );
  }

  void _showDealError(Object error, {String fallback = 'Project action failed.'}) {
    final msg = friendlyErrorMessage(error, fallback: fallback);
    showErrorSnack(context, '$msg\nTip: check DB migrations + RLS policies.');
  }

  String? _resolveMyAssignableEmployeeId(List<Employee> employees) {
    final currentUserId = Supabase.instance.client.auth.currentUser?.id;
    if (currentUserId == null || employees.isEmpty) return null;
    for (final e in employees) {
      if (e.id == currentUserId) return e.id;
    }
    for (final e in employees) {
      if (e.managerUserId == currentUserId && e.accessLevel == EmployeeAccessLevel.hrAdmin) return e.id;
    }
    for (final e in employees) {
      if (e.managerUserId == currentUserId && e.accessLevel == EmployeeAccessLevel.manager) return e.id;
    }
    for (final e in employees) {
      if (e.managerUserId == currentUserId) return e.id;
    }
    return null;
  }

  Future<DateTime?> _pickJobDateTime(BuildContext context, DateTime? initial) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: initial ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 2),
    );
    if (date == null || !mounted) return null;
    if (!context.mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial ?? now),
    );
    if (time == null || !mounted) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  Future<void> _pushDealToJobFromDealsTable({
    required String companyId,
    required Client client,
    required Map<String, dynamic> deal,
    required List<Employee> employees,
  }) async {
    final selectedEmployees = <String>{};
    final myId = _resolveMyAssignableEmployeeId(employees);
    if (myId != null) selectedEmployees.add(myId);
    final titleCtrl = TextEditingController(text: deal['title']?.toString() ?? 'Client job');
    final descCtrl = TextEditingController(
      text: 'Offer amount: R ${((deal['offer_amount'] as num?)?.toDouble() ?? 0).toStringAsFixed(2)}\n${deal['notes'] ?? ''}'.trim(),
    );
    DateTime? scheduledStart;
    DateTime? scheduledEnd;

    if (!mounted) return;
    final created = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Create job from project'),
          content: SizedBox(
            width: 620,
            child: SingleChildScrollView(
              child: Column(
                children: [
                  TextField(controller: titleCtrl, decoration: const InputDecoration(labelText: 'Job title')),
                  const SizedBox(height: 8),
                  TextField(controller: descCtrl, maxLines: 3, decoration: const InputDecoration(labelText: 'Job description')),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            final dt = await _pickJobDateTime(context, scheduledStart);
                            if (dt != null) setLocal(() => scheduledStart = dt);
                          },
                          icon: const Icon(Icons.schedule, size: 16),
                          label: Text(scheduledStart == null
                              ? 'Start'
                              : DateFormat('yyyy-MM-dd HH:mm').format(scheduledStart!)),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            final dt = await _pickJobDateTime(context, scheduledEnd);
                            if (dt != null) setLocal(() => scheduledEnd = dt);
                          },
                          icon: const Icon(Icons.schedule_outlined, size: 16),
                          label: Text(scheduledEnd == null
                              ? 'End'
                              : DateFormat('yyyy-MM-dd HH:mm').format(scheduledEnd!)),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text('Assign employees:', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 13)),
                  OutlinedButton.icon(
                    onPressed: () {
                      final id = _resolveMyAssignableEmployeeId(employees);
                      if (id != null) setLocal(() => selectedEmployees.add(id));
                    },
                    icon: const Icon(Icons.person_add_outlined, size: 16),
                    label: const Text('Add me'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => setLocal(() => selectedEmployees.clear()),
                    icon: const Icon(Icons.clear, size: 16),
                    label: const Text('Clear'),
                  ),
                  const SizedBox(height: 6),
                  if (employees.isEmpty)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text('No employees found.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280))),
                    )
                  else
                    ...employees.map((e) => CheckboxListTile(
                          value: selectedEmployees.contains(e.id),
                          onChanged: (v) {
                            setLocal(() {
                              if (v == true) {
                                selectedEmployees.add(e.id);
                              } else {
                                selectedEmployees.remove(e.id);
                              }
                            });
                          },
                          title: Text(e.fullName),
                          subtitle: Text(e.employeeCode.isNotEmpty ? e.employeeCode : e.id),
                        )),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () async {
                if (titleCtrl.text.trim().isEmpty) {
                  showInfoSnack(context, 'Job title is required.');
                  return;
                }
                final jobId = await SupabaseTimesheetStorage.createJobReturningId(
                  Job(
                    id: '',
                    title: titleCtrl.text.trim(),
                    description: descCtrl.text.trim().isEmpty ? null : descCtrl.text.trim(),
                    clientId: client.id,
                    siteId: null,
                    scheduledStart: scheduledStart,
                    scheduledEnd: scheduledEnd,
                    status: JobStatus.scheduled,
                    assignedEmployeeIds: selectedEmployees.toList(),
                  ),
                  companyId: companyId,
                );
                if (jobId == null) {
                  if (!context.mounted) return;
                  showErrorSnack(context, 'Could not create job from this project.');
                  return;
                }
                await SupabaseTimesheetStorage.setClientDealJob(
                  companyId: companyId,
                  dealId: deal['id'].toString(),
                  jobId: jobId,
                );
                if (context.mounted) Navigator.of(context).pop(true);
              },
              child: const Text('Create job'),
            ),
          ],
        ),
      ),
    );
    if (created == true && mounted) {
      setState(() {});
      showSuccessSnack(context, 'Job created and linked to the project.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final currentUserId = Supabase.instance.client.auth.currentUser?.id;

    return Stack(
      children: [
        FutureBuilder<List<dynamic>>(
          future: Future.wait([
            SupabaseTimesheetStorage.getJobs(companyId: companyId),
            if (companyId != null)
              SupabaseTimesheetStorage.getEmployeeJobRequests(companyId: companyId)
            else
              Future.value(<Map<String, dynamic>>[]),
            if (companyId != null)
              SupabaseTimesheetStorage.getSubmissionRecipientsForType(
                  companyId: companyId, submissionType: 'job_request')
            else
              Future.value(<String, List<String>>{}),
            if (companyId != null)
              SupabaseTimesheetStorage.getClients(companyId: companyId)
            else
              Future.value(<Client>[]),
            if (companyId != null)
              SupabaseTimesheetStorage.getCompanyClientDeals(companyId: companyId)
            else
              Future.value(<Map<String, dynamic>>[]),
            if (companyId != null)
              SupabaseTimesheetStorage.getCompanyClientPayments(companyId: companyId)
            else
              Future.value(<Map<String, dynamic>>[]),
          ]),
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return LoadErrorPanel(
                message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load jobs.'),
                onRetry: () => setState(() {}),
              );
            }
            if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
              return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
            }
            final jobs = snapshot.data![0] as List<Job>;
            final requestsRaw = snapshot.data![1] as List<Map<String, dynamic>>;
            final requestRecipients = snapshot.data![2] as Map<String, List<String>>;
            final clients = snapshot.data![3] as List<Client>;
            final companyDeals = snapshot.data![4] as List<Map<String, dynamic>>;
            final companyPayments = snapshot.data![5] as List<Map<String, dynamic>>;
            final clientNameById = {for (final c in clients) c.id: c.name};

            final myEmployeeIds = prov.employees
                .where((e) =>
                    currentUserId != null && (e.id == currentUserId || e.managerUserId == currentUserId))
                .map((e) => e.id)
                .toSet();
            final filteredJobs = _jobView == 'my_jobs' && myEmployeeIds.isNotEmpty
                ? jobs.where((j) => j.assignedEmployeeIds.any(myEmployeeIds.contains)).toList()
                : (_jobView == 'my_jobs' ? <Job>[] : jobs);

            final dealsRows = companyDeals.map((d) {
              final clientId = d['client_id']?.toString() ?? '';
              return [
                d['title']?.toString() ?? WorkspaceTerms.untitledProject,
                clientNameById[clientId] ?? 'Client #$clientId',
                (d['status']?.toString() ?? '').toUpperCase(),
                'R ${((d['offer_amount'] as num?)?.toDouble() ?? 0).toStringAsFixed(2)}',
                d['expected_close_date']?.toString() ?? '—',
                d['job_id'] != null ? 'Linked' : 'Not linked',
              ];
            }).toList();

            final requests = requestsRaw
                .where((r) => (r['status']?.toString().toLowerCase().trim() ?? '') == 'submitted')
                .where((r) {
                  if (_jobView != 'my_jobs') return true;
                  if (currentUserId == null) return false;
                  final submissionId = r['id']?.toString();
                  if (submissionId == null || submissionId.isEmpty) return false;
                  return (requestRecipients[submissionId] ?? const []).contains(currentUserId);
                })
                .toList();

            final jobHeaders = ['Title', 'Status', 'Assigned employees', 'Client ID', 'Site ID'];
            final jobRows = filteredJobs
                .map((j) => [j.title, j.status.name, j.assignedEmployeeIds.length.toString(), j.clientId, j.siteId ?? '—'])
                .toList();

            return ListView(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 80),
              children: [
                Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  color: const Color(0xFFF8FAFC),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                    side: const BorderSide(color: Color(0xFFE2E8F0)),
                  ),
                  child: ExpansionTile(
                    tilePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    title: Text(
                      'How time & attendance relate to jobs',
                      style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 13),
                    ),
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                        child: Text(
                          'Clock in/out captures shift attendance and can store GPS when the device allows it. '
                          'That drives hourly pay and attendance reports. Job assignments show who should work a ticket; '
                          'optional labor entries can allocate hours to a specific job for costing when your team records them.',
                          style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF475569), height: 1.35),
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(left: 4, right: 4, bottom: 16),
                  child: Wrap(
                    spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(WorkspaceTerms.jobsAndProjects,
                          style: GoogleFonts.poppins(
                              color: const Color(0xFF111827), fontSize: 20, fontWeight: FontWeight.w600)),
                      const SizedBox(width: 8),
                      SegmentedButton<String>(
                        segments: const [
                          ButtonSegment(value: 'all', label: Text('Jobs')),
                          ButtonSegment(value: 'my_jobs', label: Text('My jobs')),
                          ButtonSegment(value: 'deals', label: Text('Projects')),
                        ],
                        selected: {_jobView},
                        onSelectionChanged: (v) => setState(() => _jobView = v.first),
                        style: ButtonStyle(
                          visualDensity: VisualDensity.compact,
                          side: WidgetStateProperty.all(const BorderSide(color: Color(0xFFE5E7EB))),
                        ),
                      ),
                      if (_jobView == 'deals')
                        OutlinedButton.icon(
                          onPressed: () {
                            if (_addingGlobalDealRow) return;
                            setState(() {
                              _addingGlobalDealRow = true;
                              _editingGlobalDealId = _newGlobalDealRowId;
                              _newGlobalDealClientId = clients.isNotEmpty ? clients.first.id : null;
                              _dealRowTitle[_newGlobalDealRowId] = WorkspaceTerms.newProject;
                              _dealRowStatus[_newGlobalDealRowId] = 'draft';
                              _dealRowOffer[_newGlobalDealRowId] = '0';
                              _dealRowFinal[_newGlobalDealRowId] = '0';
                              _dealRowPaymentStatus[_newGlobalDealRowId] = 'pending';
                            });
                          },
                          icon: const Icon(Icons.add, size: 16),
                          label: Text(WorkspaceTerms.addProject),
                        ),
                      buildExportButton(
                        context: context,
                        fileName: _jobView == 'deals'
                            ? 'projects_${DateFormat('yyyy_MM_dd').format(DateTime.now())}'
                            : 'jobs_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
                        headers: _jobView == 'deals'
                            ? const ['Title', 'Client', 'Status', 'Offer', 'Expected close', 'Job link']
                            : jobHeaders,
                        rows: _jobView == 'deals' ? dealsRows : jobRows,
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(24),
                            border: Border.all(color: const Color(0xFFE5E7EB))),
                        child: Text(
                          _jobView == 'my_jobs'
                              ? '${filteredJobs.length} my jobs'
                              : _jobView == 'deals'
                                  ? WorkspaceTerms.projectCount(companyDeals.length)
                                  : '${jobs.length} total',
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_jobView == 'deals') ...[
                  if (companyDeals.isEmpty && !_addingGlobalDealRow)
                    Padding(
                      padding: const EdgeInsets.all(24),
                      child: Center(
                        child: Text('No projects found yet from your clients.',
                            style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                            textAlign: TextAlign.center),
                      ),
                    )
                  else
                    Card(
                      elevation: 1,
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: DataTable(
                          columnSpacing: 12,
                          headingRowHeight: 40,
                          dataRowMinHeight: 36,
                          dataRowMaxHeight: 50,
                          columns: const [
                            DataColumn(label: Text('Title')),
                            DataColumn(label: Text('Client')),
                            DataColumn(label: Text(WorkspaceTerms.projectStatus)),
                            DataColumn(label: Text('Offer')),
                            DataColumn(label: Text('Final agreed')),
                            DataColumn(label: Text('Payment status')),
                            DataColumn(label: Text('Expected close')),
                            DataColumn(label: Text('Job')),
                            DataColumn(label: Text('Actions')),
                          ],
                          rows: [
                            ...companyDeals.map((d) {
                              final dealId = d['id']?.toString() ?? '';
                              final clientId = d['client_id']?.toString() ?? '';
                              final linkedPayments =
                                  companyPayments.where((p) => p['deal_id']?.toString() == dealId).toList();
                              final offerValue = ((d['offer_amount'] as num?)?.toDouble() ?? 0);
                              final paidSoFar = linkedPayments.fold<double>(0, (sum, p) {
                                final s = (p['status']?.toString().toLowerCase() ?? '');
                                if (s == 'paid' || s == 'partial') {
                                  return sum + ((p['amount_due'] as num?)?.toDouble() ?? 0);
                                }
                                return sum;
                              });
                              final finalAgreedValue = linkedPayments.isNotEmpty
                                  ? ((linkedPayments.last['amount_due'] as num?)?.toDouble() ?? offerValue)
                                  : offerValue;
                              final paymentStatus = (() {
                                if (linkedPayments.any((p) =>
                                        (p['status']?.toString().toLowerCase() ?? '') == 'overdue') &&
                                    paidSoFar < finalAgreedValue) {
                                  return 'overdue';
                                }
                                if (paidSoFar <= 0) return 'pending';
                                if (paidSoFar >= finalAgreedValue && finalAgreedValue > 0) return 'paid';
                                return 'partial';
                              })();
                              _dealRowTitle.putIfAbsent(
                                  dealId, () => d['title']?.toString() ?? WorkspaceTerms.untitledProject);
                              _dealRowStatus.putIfAbsent(dealId, () => (d['status']?.toString().toLowerCase() ?? 'draft'));
                              _dealRowOffer.putIfAbsent(dealId, () => offerValue.toStringAsFixed(2));
                              _dealRowFinal.putIfAbsent(dealId, () => finalAgreedValue.toStringAsFixed(2));
                              _dealRowPaymentStatus.putIfAbsent(dealId, () => paymentStatus);
                              final isEditing = _editingGlobalDealId == dealId;
                              return DataRow(cells: [
                                DataCell(isEditing
                                    ? SizedBox(
                                        width: 170,
                                        child: TextFormField(
                                          initialValue: _dealRowTitle[dealId],
                                          onChanged: (v) => _dealRowTitle[dealId] = v,
                                        ),
                                      )
                                    : InkWell(
                                        onDoubleTap: () => setState(() => _editingGlobalDealId = dealId),
                                        child: Text(d['title']?.toString() ?? WorkspaceTerms.untitledProject),
                                      )),
                                DataCell(Text(clientNameById[clientId] ?? 'Client #$clientId')),
                                DataCell(isEditing
                                    ? SizedBox(
                                        width: 120,
                                        child: DropdownButtonFormField<String>(
                                          initialValue: _dealRowStatus[dealId],
                                          isDense: true,
                                          items: const ['draft', 'sent', 'accepted', 'rejected', 'won', 'lost']
                                              .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                                              .toList(),
                                          onChanged: (v) =>
                                              setState(() => _dealRowStatus[dealId] = v ?? 'draft'),
                                        ),
                                      )
                                    : _statusChip(d['status']?.toString() ?? 'draft')),
                                DataCell(isEditing
                                    ? SizedBox(
                                        width: 90,
                                        child: TextFormField(
                                          initialValue: _dealRowOffer[dealId],
                                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                          onChanged: (v) => _dealRowOffer[dealId] = v,
                                        ),
                                      )
                                    : Text('R ${offerValue.toStringAsFixed(2)}')),
                                DataCell(isEditing
                                    ? SizedBox(
                                        width: 100,
                                        child: TextFormField(
                                          initialValue: _dealRowFinal[dealId],
                                          keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                          onChanged: (v) => _dealRowFinal[dealId] = v,
                                        ),
                                      )
                                    : Text('R ${finalAgreedValue.toStringAsFixed(2)}')),
                                DataCell(isEditing
                                    ? SizedBox(
                                        width: 120,
                                        child: DropdownButtonFormField<String>(
                                          initialValue: _dealRowPaymentStatus[dealId],
                                          isDense: true,
                                          items: const ['pending', 'partial', 'paid', 'overdue']
                                              .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                                              .toList(),
                                          onChanged: (v) => setState(
                                              () => _dealRowPaymentStatus[dealId] = v ?? 'pending'),
                                        ),
                                      )
                                    : _statusChip(paymentStatus)),
                                DataCell(Text(d['expected_close_date']?.toString() ?? '—')),
                                DataCell(Text(d['job_id'] == null ? 'Not linked' : 'Linked')),
                                DataCell(Wrap(
                                  spacing: 6,
                                  children: [
                                    if (isEditing) ...[
                                      TextButton(
                                        onPressed: () async {
                                          final t = (_dealRowTitle[dealId] ?? '').trim();
                                          if (t.isEmpty) {
                                            showInfoSnack(context, 'Project title is required.');
                                            return;
                                          }
                                          final newOffer = double.tryParse((_dealRowOffer[dealId] ?? '').trim()) ?? offerValue;
                                          final newFinal = double.tryParse((_dealRowFinal[dealId] ?? '').trim()) ?? finalAgreedValue;
                                          final expectedRaw = d['expected_close_date']?.toString();
                                          final expectedDate = expectedRaw == null || expectedRaw.isEmpty
                                              ? null
                                              : DateTime.tryParse(expectedRaw);
                                          try {
                                            await SupabaseTimesheetStorage.upsertClientDeal(
                                              companyId: companyId!,
                                              clientId: clientId,
                                              dealId: dealId,
                                              title: t,
                                              status: _dealRowStatus[dealId] ?? 'draft',
                                              offerAmount: newOffer,
                                              jobId: d['job_id']?.toString(),
                                              expectedCloseDate: expectedDate,
                                              notes: d['notes']?.toString(),
                                            );
                                            await SupabaseTimesheetStorage.upsertClientPayment(
                                              companyId: companyId,
                                              clientId: clientId,
                                              paymentId: linkedPayments.isNotEmpty
                                                  ? linkedPayments.last['id']?.toString()
                                                  : null,
                                              dealId: dealId,
                                              description:
                                                  (linkedPayments.isNotEmpty
                                                              ? linkedPayments.last['description']
                                                              : null)
                                                          ?.toString() ??
                                                      'Payment for $t',
                                              amountDue: newFinal,
                                              dueDate: expectedDate,
                                              paidAt: (_dealRowPaymentStatus[dealId] ?? 'pending') == 'paid'
                                                  ? DateTime.now()
                                                  : null,
                                              status: _dealRowPaymentStatus[dealId] ?? 'pending',
                                            );
                                          } catch (e) {
                                            if (!mounted) return;
                                            _showDealError(e, fallback: 'Could not update project.');
                                            return;
                                          }
                                          if (!mounted) return;
                                          setState(() => _editingGlobalDealId = null);
                                          showSuccessSnack(this.context, 'Project updated.');
                                        },
                                        child: const Text('Save'),
                                      ),
                                      TextButton(
                                        onPressed: () => setState(() => _editingGlobalDealId = null),
                                        child: const Text('Cancel'),
                                      ),
                                    ] else ...[
                                      TextButton(
                                        onPressed: d['job_id'] != null
                                            ? null
                                            : () async {
                                                final c = clients.firstWhere(
                                                  (x) => x.id == clientId,
                                                  orElse: () => Client(
                                                      id: clientId,
                                                      name: clientNameById[clientId] ?? 'Client'),
                                                );
                                                await _pushDealToJobFromDealsTable(
                                                  companyId: companyId!,
                                                  client: c,
                                                  deal: d,
                                                  employees: prov.employees,
                                                );
                                              },
                                        child: const Text('Create job'),
                                      ),
                                      TextButton(
                                        onPressed: () async {
                                          final c = clients.firstWhere(
                                            (x) => x.id == clientId,
                                            orElse: () => Client(
                                                id: clientId,
                                                name: clientNameById[clientId] ?? 'Client'),
                                          );
                                          await Navigator.of(context).push(MaterialPageRoute(
                                            builder: (_) => ClientDetailScreen(companyId: companyId!, client: c),
                                          ));
                                          if (mounted) setState(() {});
                                        },
                                        child: const Text('Open'),
                                      ),
                                      IconButton(
                                        icon: const Icon(Icons.delete_outline, color: Colors.red),
                                        onPressed: () async {
                                          await SupabaseTimesheetStorage.deleteClientDeal(
                                              companyId: companyId!, dealId: dealId);
                                          if (mounted) setState(() {});
                                        },
                                      ),
                                    ],
                                  ],
                                )),
                              ]);
                            }),
                            if (_addingGlobalDealRow)
                              DataRow(cells: [
                                DataCell(SizedBox(
                                  width: 170,
                                  child: TextFormField(
                                    initialValue: _dealRowTitle[_newGlobalDealRowId] ?? '',
                                    onChanged: (v) => _dealRowTitle[_newGlobalDealRowId] = v,
                                  ),
                                )),
                                DataCell(SizedBox(
                                  width: 170,
                                  child: DropdownButtonFormField<String>(
                                    initialValue: _newGlobalDealClientId,
                                    isDense: true,
                                    items: clients
                                        .map((c) => DropdownMenuItem<String>(value: c.id, child: Text(c.name)))
                                        .toList(),
                                    onChanged: (v) => setState(() => _newGlobalDealClientId = v),
                                  ),
                                )),
                                DataCell(SizedBox(
                                  width: 120,
                                  child: DropdownButtonFormField<String>(
                                    initialValue: _dealRowStatus[_newGlobalDealRowId] ?? 'draft',
                                    isDense: true,
                                    items: const ['draft', 'sent', 'accepted', 'rejected', 'won', 'lost']
                                        .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                                        .toList(),
                                    onChanged: (v) =>
                                        setState(() => _dealRowStatus[_newGlobalDealRowId] = v ?? 'draft'),
                                  ),
                                )),
                                DataCell(SizedBox(
                                  width: 90,
                                  child: TextFormField(
                                    initialValue: _dealRowOffer[_newGlobalDealRowId] ?? '0',
                                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                    onChanged: (v) => _dealRowOffer[_newGlobalDealRowId] = v,
                                  ),
                                )),
                                DataCell(SizedBox(
                                  width: 100,
                                  child: TextFormField(
                                    initialValue: _dealRowFinal[_newGlobalDealRowId] ?? '0',
                                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                    onChanged: (v) => _dealRowFinal[_newGlobalDealRowId] = v,
                                  ),
                                )),
                                DataCell(SizedBox(
                                  width: 120,
                                  child: DropdownButtonFormField<String>(
                                    initialValue: _dealRowPaymentStatus[_newGlobalDealRowId] ?? 'pending',
                                    isDense: true,
                                    items: const ['pending', 'partial', 'paid', 'overdue']
                                        .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                                        .toList(),
                                    onChanged: (v) => setState(
                                        () => _dealRowPaymentStatus[_newGlobalDealRowId] = v ?? 'pending'),
                                  ),
                                )),
                                const DataCell(Text('—')),
                                const DataCell(Text('Not linked')),
                                DataCell(Wrap(
                                  spacing: 6,
                                  children: [
                                    TextButton(
                                      onPressed: () async {
                                        final title = (_dealRowTitle[_newGlobalDealRowId] ?? '').trim();
                                        if (title.isEmpty) {
                                          showInfoSnack(context, 'Project title is required.');
                                          return;
                                        }
                                        if (_newGlobalDealClientId == null || _newGlobalDealClientId!.isEmpty) {
                                          showInfoSnack(context, 'Please select a client.');
                                          return;
                                        }
                                        final offer = double.tryParse(
                                                (_dealRowOffer[_newGlobalDealRowId] ?? '').trim()) ??
                                            0;
                                        final finalAgreed = double.tryParse(
                                                (_dealRowFinal[_newGlobalDealRowId] ?? '').trim()) ??
                                            offer;
                                        String? newDealId;
                                        try {
                                          newDealId =
                                              await SupabaseTimesheetStorage.upsertClientDealReturningId(
                                            companyId: companyId!,
                                            clientId: _newGlobalDealClientId!,
                                            title: title,
                                            status: _dealRowStatus[_newGlobalDealRowId] ?? 'draft',
                                            offerAmount: offer,
                                          );
                                        } catch (e) {
                                          if (!mounted) return;
                                          _showDealError(e, fallback: 'Could not create project.');
                                          return;
                                        }
                                        if (newDealId != null && newDealId.isNotEmpty) {
                                          try {
                                            await SupabaseTimesheetStorage.upsertClientPayment(
                                              companyId: companyId,
                                              clientId: _newGlobalDealClientId!,
                                              dealId: newDealId,
                                              description: 'Payment for $title',
                                              amountDue: finalAgreed,
                                              paidAt:
                                                  (_dealRowPaymentStatus[_newGlobalDealRowId] ?? 'pending') ==
                                                          'paid'
                                                      ? DateTime.now()
                                                      : null,
                                              status:
                                                  _dealRowPaymentStatus[_newGlobalDealRowId] ?? 'pending',
                                            );
                                          } catch (e) {
                                            if (!mounted) return;
                                            _showDealError(
                                              e,
                                              fallback: 'Project created, but payment row failed.',
                                            );
                                            return;
                                          }
                                        }
                                        if (!mounted) return;
                                        setState(() {
                                          _addingGlobalDealRow = false;
                                          _editingGlobalDealId = null;
                                          _newGlobalDealClientId = null;
                                          _dealRowTitle.remove(_newGlobalDealRowId);
                                          _dealRowStatus.remove(_newGlobalDealRowId);
                                          _dealRowOffer.remove(_newGlobalDealRowId);
                                          _dealRowFinal.remove(_newGlobalDealRowId);
                                          _dealRowPaymentStatus.remove(_newGlobalDealRowId);
                                        });
                                        showSuccessSnack(this.context, 'Project created.');
                                      },
                                      child: const Text('Save'),
                                    ),
                                    TextButton(
                                      onPressed: () {
                                        setState(() {
                                          _addingGlobalDealRow = false;
                                          _editingGlobalDealId = null;
                                          _newGlobalDealClientId = null;
                                          _dealRowTitle.remove(_newGlobalDealRowId);
                                          _dealRowStatus.remove(_newGlobalDealRowId);
                                          _dealRowOffer.remove(_newGlobalDealRowId);
                                          _dealRowFinal.remove(_newGlobalDealRowId);
                                          _dealRowPaymentStatus.remove(_newGlobalDealRowId);
                                        });
                                      },
                                      child: const Text('Cancel'),
                                    ),
                                  ],
                                )),
                              ]),
                          ],
                        ),
                      ),
                    ),
                ] else if (filteredJobs.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Center(
                      child: Text(
                        _jobView == 'my_jobs'
                            ? 'No jobs currently assigned to you.'
                            : 'No jobs created yet.\nTap + to create one.',
                        style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                else
                  ...filteredJobs.map((j) => Card(
                        color: Colors.white, elevation: 2,
                        margin: const EdgeInsets.only(bottom: 8),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                            side: const BorderSide(color: Color(0xFFE5E7EB))),
                        child: ListTile(
                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          onTap: () => Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => HrJobDetailsScreen(job: j, employees: prov.employees),
                          )),
                          title: Text(j.title,
                              style: GoogleFonts.poppins(
                                  color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                          subtitle: Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              'Status: ${j.status.name} · Assigned: ${j.assignedEmployeeIds.length}',
                              style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                            ),
                          ),
                        ),
                      )),
                if (_jobView != 'deals' && requests.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  Text('Employee added jobs',
                      style: GoogleFonts.poppins(
                          color: const Color(0xFF111827), fontSize: 14, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  ...requests.take(20).map((r) {
                    final title = r['title']?.toString().trim();
                    final desc = r['description']?.toString().trim();
                    final status = r['status']?.toString().trim();
                    final createdAt = DateTime.tryParse(r['created_at']?.toString() ?? '');
                    return Card(
                      color: Colors.white,
                      margin: const EdgeInsets.only(bottom: 8),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                          side: const BorderSide(color: Color(0xFFE5E7EB))),
                      child: ListTile(
                        title: Text(
                          (title == null || title.isEmpty) ? 'Untitled job' : title,
                          style: GoogleFonts.poppins(
                              color: const Color(0xFF111827), fontWeight: FontWeight.w600, fontSize: 13),
                        ),
                        subtitle: Text(
                          '${createdAt != null ? DateFormat('MMM d, y • h:mm a').format(createdAt) : 'Unknown time'}'
                          '${status != null && status.isNotEmpty ? ' • ${status.toUpperCase()}' : ''}'
                          '${desc != null && desc.isNotEmpty ? '\n$desc' : ''}',
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                        ),
                        isThreeLine: desc != null && desc.isNotEmpty,
                      ),
                    );
                  }),
                ],
              ],
            );
          },
        ),
        Positioned(
          right: 16, bottom: 16,
          child: FloatingActionButton(
            onPressed: () => Navigator.of(context)
                .push(MaterialPageRoute(builder: (_) => const HrCreateJobScreen()))
                .then((_) => setState(() {})),
            backgroundColor: AppTheme.gold,
            foregroundColor: Colors.white,
            child: const Icon(Icons.add),
          ),
        ),
      ],
    );
  }
}
