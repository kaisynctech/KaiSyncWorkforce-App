import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/client.dart';
import '../models/contractor.dart';
import '../models/incident_report.dart';
import '../models/job.dart';
import '../models/payment_approval.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/load_error_panel.dart';
import '_dashboard_decorators.dart';

class HrContractorDetailsScreen extends StatefulWidget {
  final Contractor contractor;
  final List<String> memberIds;
  final DateTime initialFrom;
  final DateTime initialTo;

  const HrContractorDetailsScreen({
    super.key,
    required this.contractor,
    required this.memberIds,
    required this.initialFrom,
    required this.initialTo,
  });

  @override
  State<HrContractorDetailsScreen> createState() => _HrContractorDetailsScreenState();
}

class _HrContractorDetailsScreenState extends State<HrContractorDetailsScreen> {
  DateTime _from = DateTime.now();
  DateTime _to = DateTime.now();

  @override
  void initState() {
    super.initState();
    _from = DateTime(widget.initialFrom.year, widget.initialFrom.month, widget.initialFrom.day);
    _to = DateTime(widget.initialTo.year, widget.initialTo.month, widget.initialTo.day);
  }

  Future<void> _pickFrom() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _from,
      firstDate: DateTime(DateTime.now().year - 2),
      lastDate: DateTime.now(),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _from = DateTime(picked.year, picked.month, picked.day);
      if (_from.isAfter(_to)) _to = _from;
    });
  }

  Future<void> _pickTo() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _to,
      firstDate: _from,
      lastDate: DateTime.now(),
    );
    if (picked == null || !mounted) return;
    setState(() => _to = DateTime(picked.year, picked.month, picked.day));
  }

  bool _inRange(DateTime? date) {
    if (date == null) return false;
    final end = DateTime(_to.year, _to.month, _to.day, 23, 59, 59);
    return !date.isBefore(_from) && !date.isAfter(end);
  }

  @override
  Widget build(BuildContext context) {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) {
      return const Scaffold(body: Center(child: Text('No company selected.')));
    }
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        title: Text(
          widget.contractor.displayName,
          style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
      ),
      body: FutureBuilder<List<dynamic>>(
        key: ValueKey(
          'contractor_details_${widget.contractor.id}_${_from.toIso8601String()}_${_to.toIso8601String()}',
        ),
        future: Future.wait([
          SupabaseTimesheetStorage.getJobs(companyId: companyId),
          SupabaseTimesheetStorage.getIncidents(companyId: companyId),
          SupabaseTimesheetStorage.getCompanyClientDeals(companyId: companyId),
          SupabaseTimesheetStorage.getClients(companyId: companyId),
          SupabaseTimesheetStorage.getPaymentApprovalsForRange(_from, _to, companyId: companyId),
          context.read<TimesheetProvider>().getHoursSummaries(
                _from,
                DateTime(_to.year, _to.month, _to.day, 23, 59, 59),
              ),
        ]),
        builder: (context, snap) {
          if (snap.hasError) {
            return LoadErrorPanel(
              message: friendlyErrorMessage(snap.error, fallback: 'Could not load contractor details.'),
              onRetry: () => setState(() {}),
            );
          }
          if (snap.connectionState == ConnectionState.waiting && !snap.hasData) {
            return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
          }

          final jobs = (snap.data?[0] as List?)?.cast<Job>() ?? const <Job>[];
          final incidents = (snap.data?[1] as List?)?.cast<IncidentReport>() ?? const <IncidentReport>[];
          final deals = (snap.data?[2] as List?)?.cast<Map<String, dynamic>>() ?? const <Map<String, dynamic>>[];
          final clients = (snap.data?[3] as List?)?.cast<Client>() ?? const <Client>[];
          final approvals = (snap.data?[4] as List?)?.cast<PaymentApproval>() ?? const <PaymentApproval>[];
          final summaries = (snap.data?[5] as List?)?.cast<EmployeeHoursSummary>() ?? const <EmployeeHoursSummary>[];

          final memberIds = widget.memberIds.toSet();
          final contractorJobs = jobs.where((j) {
            final linkedByParent = j.contractorId == widget.contractor.id;
            final linkedByMember = memberIds.isNotEmpty &&
                (memberIds.contains(j.contractorEmployeeId) ||
                    memberIds.contains(j.assigneeEmployeeId) ||
                    j.assignedEmployeeIds.any(memberIds.contains));
            if (!(linkedByParent || linkedByMember)) return false;
            return _inRange(j.closedAt) || _inRange(j.scheduledStart) || _inRange(j.openedAt);
          }).toList();

          final clientById = {for (final c in clients) c.id: c.name};
          final dealById = {for (final d in deals) d['id']?.toString() ?? '': d};
          final dealIds = contractorJobs.map((j) => j.dealId).whereType<String>().toSet();
          final dealValue = deals
              .where((d) => dealIds.contains(d['id']?.toString()))
              .fold<double>(0, (s, d) => s + (((d['offer_amount'] as num?)?.toDouble()) ?? 0));
          final incidentsCount = incidents
              .where((i) => i.jobId != null && contractorJobs.any((j) => j.id == i.jobId))
              .length;

          approvals.sort((a, b) => a.periodStart.compareTo(b.periodStart));
          final approvalsByEmp = <String, PaymentApproval>{};
          for (final a in approvals) {
            approvalsByEmp[a.employeeId] = a;
          }

          final memberSummaries = summaries.where((s) => memberIds.contains(s.employee.id)).toList();
          final payoutDue = memberSummaries.fold<double>(0, (sum, s) {
            final a = approvalsByEmp[s.employee.id];
            return sum + (a?.editedAmount ?? s.paymentDue);
          });
          final payoutApproved = memberSummaries.fold<double>(0, (sum, s) {
            final a = approvalsByEmp[s.employee.id];
            final status = a?.status ?? (a?.approved == true ? 'approved' : 'pending');
            if (status == 'approved' || status == 'partial') {
              return sum + (a?.editedAmount ?? s.paymentDue);
            }
            return sum;
          });
          final outstanding = (payoutDue - payoutApproved).clamp(0, double.infinity);

          final rows = contractorJobs
            ..sort((a, b) => (b.closedAt ?? b.scheduledStart ?? DateTime(1900))
                .compareTo(a.closedAt ?? a.scheduledStart ?? DateTime(1900)));

          final exportHeaders = const ['Metric', 'Value'];
          final exportRows = [
            ['Contractor', widget.contractor.displayName],
            ['From', DateFormat('dd MMM y').format(_from)],
            ['To', DateFormat('dd MMM y').format(_to)],
            ['Jobs in period', '${rows.length}'],
            ['Linked deal value', 'R ${dealValue.toStringAsFixed(2)}'],
            ['Payout approved', 'R ${payoutApproved.toStringAsFixed(2)}'],
            ['Payout outstanding', 'R ${outstanding.toStringAsFixed(2)}'],
            ['Incidents', '$incidentsCount'],
          ];

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    OutlinedButton.icon(
                      onPressed: _pickFrom,
                      icon: const Icon(Icons.calendar_today_outlined, size: 16),
                      label: Text('From ${DateFormat('dd MMM y').format(_from)}'),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton.icon(
                      onPressed: _pickTo,
                      icon: const Icon(Icons.event_outlined, size: 16),
                      label: Text('To ${DateFormat('dd MMM y').format(_to)}'),
                    ),
                    const Spacer(),
                    buildExportButton(
                      context: context,
                      fileName:
                          'contractor_detail_${DateFormat('yyyyMMdd').format(_from)}_${DateFormat('yyyyMMdd').format(_to)}',
                      headers: exportHeaders,
                      rows: exportRows,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    _MetricCard(label: 'Jobs', value: '${rows.length}'),
                    _MetricCard(label: 'Deal value', value: 'R ${dealValue.toStringAsFixed(2)}'),
                    _MetricCard(label: 'Payout approved', value: 'R ${payoutApproved.toStringAsFixed(2)}'),
                    _MetricCard(label: 'Outstanding', value: 'R ${outstanding.toStringAsFixed(2)}'),
                    _MetricCard(label: 'Incidents', value: '$incidentsCount'),
                    _MetricCard(label: 'Members', value: '${memberIds.length}'),
                  ],
                ),
                const SizedBox(height: 12),
                Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: rows.isEmpty
                        ? const Padding(
                            padding: EdgeInsets.all(18),
                            child: Text('No job activity in this period.'),
                          )
                        : SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: DataTable(
                              columns: const [
                                DataColumn(label: Text('Job')),
                                DataColumn(label: Text('Client')),
                                DataColumn(label: Text('Deal')),
                                DataColumn(label: Text('Status')),
                                DataColumn(label: Text('Actual cost')),
                                DataColumn(label: Text('Closed / planned')),
                              ],
                              rows: rows.map((j) {
                                final deal = j.dealId != null ? dealById[j.dealId!] : null;
                                final dealTitle = (deal?['title']?.toString() ?? deal?['reference_code']?.toString() ?? '—');
                                final dateText = j.closedAt != null
                                    ? DateFormat('dd MMM y').format(j.closedAt!)
                                    : (j.scheduledStart != null ? DateFormat('dd MMM y').format(j.scheduledStart!) : '—');
                                return DataRow(cells: [
                                  DataCell(Text(j.title)),
                                  DataCell(Text(clientById[j.clientId] ?? 'Client #${j.clientId}')),
                                  DataCell(Text(dealTitle)),
                                  DataCell(Text(j.status.name)),
                                  DataCell(Text(j.actualCost != null ? 'R ${j.actualCost!.toStringAsFixed(2)}' : '—')),
                                  DataCell(Text(dateText)),
                                ]);
                              }).toList(),
                            ),
                          ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;

  const _MetricCard({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 190,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFF6B7280))),
          const SizedBox(height: 4),
          Text(value, style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
