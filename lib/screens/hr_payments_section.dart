import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';
import '../models/employee.dart';
import '../models/payment_approval.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/load_error_panel.dart';
import '_dashboard_decorators.dart';
import '../strings/workspace_terms.dart';

class HrPaymentsSection extends StatefulWidget {
  final String? focusedEmployeeId;
  final DateTime? initialPeriodStart;

  const HrPaymentsSection({
    super.key,
    this.focusedEmployeeId,
    this.initialPeriodStart,
  });

  @override
  State<HrPaymentsSection> createState() => _HrPaymentsSectionState();
}

class _HrPaymentsSectionState extends State<HrPaymentsSection> {
  DateTime _rangeStart = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _rangeEnd = DateTime(DateTime.now().year, DateTime.now().month + 1, 0);
  /// Which quick preset is active, if the current range still matches that preset.
  String? _activeQuickRange;
  List<EmployeeHoursSummary> _summaries = [];
  bool _loadingSummaries = false;
  String? _summariesError;
  String _activeTab = 'contractors_out';

  Widget _statusChip(String status) {
    final normalized = status.toLowerCase().trim();
    final (Color color, String label) = switch (normalized) {
      'approved' || 'paid' || 'settled' => (const Color(0xFF059669), normalized),
      'partial' => (const Color(0xFF2563EB), normalized),
      'declined' || 'overdue' => (const Color(0xFFDC2626), normalized),
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

  @override
  void initState() {
    super.initState();
    if (widget.initialPeriodStart != null) {
      final start = DateTime(widget.initialPeriodStart!.year, widget.initialPeriodStart!.month, 1);
      _rangeStart = start;
      _rangeEnd = DateTime(start.year, start.month + 1, 0);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadSummaries());
  }

  Future<void> _reloadForDateRange() async {
    final endOfRange = DateTime(_rangeEnd.year, _rangeEnd.month, _rangeEnd.day, 23, 59, 59);
    await context.read<TimesheetProvider>().loadAllPunches(from: _rangeStart, to: endOfRange);
    await _loadSummaries();
  }

  Future<void> _pickFromDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _rangeStart,
      firstDate: DateTime(DateTime.now().year - 2),
      lastDate: DateTime.now(),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _activeQuickRange = null;
      _rangeStart = DateTime(picked.year, picked.month, picked.day);
      if (_rangeStart.isAfter(_rangeEnd)) _rangeEnd = _rangeStart;
    });
    await _reloadForDateRange();
  }

  Future<void> _pickToDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _rangeEnd,
      firstDate: _rangeStart,
      lastDate: DateTime.now(),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _activeQuickRange = null;
      _rangeEnd = DateTime(picked.year, picked.month, picked.day);
      if (_rangeEnd.isBefore(_rangeStart)) _rangeStart = _rangeEnd;
    });
    await _reloadForDateRange();
  }

  Future<void> _applyQuickRange(String key) async {
    final today = DateTime.now();
    late DateTime from;
    late DateTime to;
    switch (key) {
      case 'this_month':
        from = DateTime(today.year, today.month, 1);
        to = DateTime(today.year, today.month + 1, 0);
        break;
      case 'last_30':
        to = DateTime(today.year, today.month, today.day);
        from = to.subtract(const Duration(days: 29));
        break;
      case 'this_quarter':
        final quarterStartMonth = (((today.month - 1) ~/ 3) * 3) + 1;
        from = DateTime(today.year, quarterStartMonth, 1);
        to = DateTime(today.year, quarterStartMonth + 3, 0);
        break;
      default:
        return;
    }
    setState(() {
      _activeQuickRange = key;
      _rangeStart = from;
      _rangeEnd = to;
    });
    await _reloadForDateRange();
  }

  ButtonStyle _quickRangeStyle(bool selected) {
    if (selected) {
      return FilledButton.styleFrom(
        backgroundColor: AppTheme.gold,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      );
    }
    return OutlinedButton.styleFrom(
      side: const BorderSide(color: Color(0xFFD1D5DB)),
      foregroundColor: const Color(0xFF374151),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    );
  }

  Future<void> _loadSummaries() async {
    setState(() {
      _loadingSummaries = true;
      _summariesError = null;
    });
    try {
      final prov = context.read<TimesheetProvider>();
      final end = DateTime(_rangeEnd.year, _rangeEnd.month, _rangeEnd.day, 23, 59, 59);
      final list = await prov.getHoursSummaries(_rangeStart, end);
      if (!mounted) return;
      setState(() => _summaries = list);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _summaries = [];
        _summariesError = friendlyErrorMessage(
          e,
          fallback: 'Could not load payroll summaries for this period.',
        );
      });
    } finally {
      if (mounted) {
        setState(() => _loadingSummaries = false);
      }
    }
  }

  Future<void> _editPaymentAmount(String employeeId, {required double initial}) async {
    final ctrl = TextEditingController(text: initial.toStringAsFixed(2));
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit payment amount'),
        content: TextField(
          controller: ctrl,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Final payment amount (R)'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.gold, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (ok != true || companyId == null) return;
    final v = double.tryParse(ctrl.text.trim());
    if (v == null) return;
    await SupabaseTimesheetStorage.upsertPaymentApproval(
      PaymentApproval(
        employeeId: employeeId,
        periodStart: _rangeStart,
        editedAmount: v,
        approved: false,
        approvedAt: null,
      ),
      companyId: companyId,
    );
  }

  Widget _buildPaymentsTable(Map<String, PaymentApproval> approvalsByEmp) {
    final isCompact = MediaQuery.of(context).size.width < 1200;
    if (_summaries.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text('No data in this period.', style: GoogleFonts.poppins(color: AppTheme.textGray)),
      );
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingRowColor: WidgetStateProperty.all(const Color(0xFFF9FAFB)),
        headingTextStyle: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 11, fontWeight: FontWeight.w600),
        dataTextStyle: GoogleFonts.poppins(color: const Color(0xFF4B5563), fontSize: 10),
        columnSpacing: isCompact ? 12 : 18,
        headingRowHeight: isCompact ? 40 : 52,
        dataRowMinHeight: isCompact ? 38 : 46,
        dataRowMaxHeight: isCompact ? 52 : 64,
        dividerThickness: 0.4,
        columns: const [
          DataColumn(label: Text('Full Name')),
          DataColumn(label: Text('ID')),
          DataColumn(label: Text('Total Hours')),
          DataColumn(label: Text('Total Overtime Hours')),
          DataColumn(label: Text('Normal salary')),
          DataColumn(label: Text('Overtime salary')),
          DataColumn(label: Text('Final payment')),
          DataColumn(label: Text('Status')),
          DataColumn(label: Text('Actions')),
        ],
        rows: _summaries.map((s) {
          final approval = approvalsByEmp[s.employee.id];
          final edited = approval?.editedAmount;
          final finalAmt = edited ?? s.paymentDue;
          final status = approval?.status ?? (approval?.approved == true ? 'approved' : 'pending');
          final isApproved = status == 'approved';
          final normalSalary = s.regularHours * s.employee.hourlyRate;
          final overtimeSalary = s.overtimeHours * s.employee.hourlyRate * 1.5;

          final isFocused = widget.focusedEmployeeId != null && widget.focusedEmployeeId == s.employee.id;
          return DataRow(
            color: isFocused
                ? WidgetStatePropertyAll(const Color(0xFFFEF3C7).withValues(alpha: 0.65))
                : null,
            cells: [
            DataCell(Text(s.employee.fullName)),
            DataCell(Text(s.employee.employeeCode.isNotEmpty ? s.employee.employeeCode : '—')),
            DataCell(Text(s.totalHours.toStringAsFixed(1))),
            DataCell(Text(s.overtimeHours.toStringAsFixed(1))),
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
                  status,
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
                      await _editPaymentAmount(s.employee.id, initial: finalAmt);
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
                                employeeId: s.employee.id,
                                periodStart: _rangeStart,
                                editedAmount: edited,
                                approved: true,
                                approvedAt: DateTime.now(),
                                status: 'approved',
                              ),
                              companyId: context.read<TimesheetProvider>().currentCompanyId,
                            );
                            if (mounted) setState(() {});
                          },
                  ),
                  IconButton(
                    tooltip: 'Decline payment',
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 26, minHeight: 26),
                    icon: const Icon(
                      Icons.cancel_outlined,
                      size: 18,
                      color: Color(0xFFB45309),
                    ),
                    onPressed: () async {
                      final noteCtrl = TextEditingController();
                      final ok = await showDialog<bool>(
                        context: context,
                        builder: (context) => AlertDialog(
                          title: const Text('Decline payment'),
                          content: TextField(
                            controller: noteCtrl,
                            maxLines: 3,
                            decoration: const InputDecoration(labelText: 'Reason (optional)'),
                          ),
                          actions: [
                            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
                            ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Decline')),
                          ],
                        ),
                      );
                      if (ok != true) return;
                      await SupabaseTimesheetStorage.upsertPaymentApproval(
                        PaymentApproval(
                          employeeId: s.employee.id,
                          periodStart: _rangeStart,
                          editedAmount: edited,
                          approved: false,
                          approvedAt: null,
                          status: 'declined',
                          decisionNote: noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim(),
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
          );
        }).toList(),
      ),
    );
  }

  Widget _buildContractorsPayoutTable(Map<String, PaymentApproval> approvalsByEmp) {
    final contractors = _summaries
        .where((s) =>
            s.employee.workerType == WorkerType.contractor ||
            s.employee.workerType == WorkerType.subcontractor)
        .toList();
    if (contractors.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text('No contractor payouts in this period.', style: GoogleFonts.poppins(color: AppTheme.textGray)),
      );
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        columns: const [
          DataColumn(label: Text('Contractor')),
          DataColumn(label: Text('Type')),
          DataColumn(label: Text('Due')),
          DataColumn(label: Text('Approved/partial')),
          DataColumn(label: Text('Outstanding')),
          DataColumn(label: Text('Status')),
        ],
        rows: contractors.map((s) {
          final a = approvalsByEmp[s.employee.id];
          final due = a?.editedAmount ?? s.paymentDue;
          final status = a?.status ?? (a?.approved == true ? 'approved' : 'pending');
          final paidOut = (status == 'approved' || status == 'partial') ? due : 0.0;
          final outstanding = (due - paidOut).clamp(0, double.infinity);
          return DataRow(cells: [
            DataCell(Text(s.employee.fullName)),
            DataCell(Text(s.employee.workerType.label)),
            DataCell(Text('R ${due.toStringAsFixed(2)}')),
            DataCell(Text('R ${paidOut.toStringAsFixed(2)}')),
            DataCell(Text('R ${outstanding.toStringAsFixed(2)}')),
            DataCell(_statusChip(status)),
          ]);
        }).toList(),
      ),
    );
  }

  Widget _buildClientsCollectionTable({
    required List<Map<String, dynamic>> payments,
    required Map<String, String> clientNameById,
  }) {
    if (payments.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text('No client payments found.', style: GoogleFonts.poppins(color: AppTheme.textGray)),
      );
    }
    final grouped = <String, Map<String, double>>{};
    for (final p in payments) {
      final clientId = p['client_id']?.toString() ?? '';
      final amount = ((p['amount_due'] as num?)?.toDouble()) ?? 0;
      final status = (p['status']?.toString() ?? '').toLowerCase();
      final row = grouped.putIfAbsent(clientId, () => {'billed': 0, 'paid': 0});
      row['billed'] = (row['billed'] ?? 0) + amount;
      if (status == 'paid' || status == 'partial') {
        row['paid'] = (row['paid'] ?? 0) + amount;
      }
    }
    final entries = grouped.entries.toList()
      ..sort((a, b) => (clientNameById[a.key] ?? a.key).compareTo(clientNameById[b.key] ?? b.key));
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        columns: const [
          DataColumn(label: Text('Client')),
          DataColumn(label: Text('Total billed')),
          DataColumn(label: Text('Paid in')),
          DataColumn(label: Text('Outstanding')),
          DataColumn(label: Text('Collection status')),
        ],
        rows: entries.map((e) {
          final billed = e.value['billed'] ?? 0;
          final paid = e.value['paid'] ?? 0;
          final outstanding = (billed - paid).clamp(0, double.infinity);
          final status = outstanding <= 0 ? 'settled' : (paid > 0 ? 'partial' : 'pending');
          return DataRow(cells: [
            DataCell(Text(clientNameById[e.key] ?? 'Client #${e.key}')),
            DataCell(Text('R ${billed.toStringAsFixed(2)}')),
            DataCell(Text('R ${paid.toStringAsFixed(2)}')),
            DataCell(Text('R ${outstanding.toStringAsFixed(2)}')),
            DataCell(_statusChip(status)),
          ]);
        }).toList(),
      ),
    );
  }

  Widget _buildFinancialOverviewTable({
    required double totalPaidIn,
    required double totalPaidOut,
    required double jobActualCost,
    required double grossProfit,
    required double netAfterLabor,
  }) {
    final rows = <(String label, double amount, String note)>[
      ('Total payment in', totalPaidIn, 'Collected from clients'),
      ('Total payment out', totalPaidOut, 'Payroll + contractor payouts'),
      ('Job actual cost', jobActualCost, 'Includes inventory where captured'),
      ('Gross profit', grossProfit, 'Payment in - job actual cost'),
      ('Net after labor', netAfterLabor, 'Gross - payroll - contractors'),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        columns: const [
          DataColumn(label: Text('Metric')),
          DataColumn(label: Text('Amount')),
          DataColumn(label: Text('Notes')),
        ],
        rows: rows.map((r) {
          final isProfitMetric = r.$1 == 'Gross profit' || r.$1 == 'Net after labor';
          final valueColor = isProfitMetric
              ? (r.$2 >= 0 ? const Color(0xFF059669) : const Color(0xFFDC2626))
              : const Color(0xFF111827);
          return DataRow(cells: [
            DataCell(Text(r.$1)),
            DataCell(
              Text(
                'R ${r.$2.toStringAsFixed(2)}',
                style: GoogleFonts.poppins(fontWeight: FontWeight.w700, color: valueColor),
              ),
            ),
            DataCell(Text(r.$3)),
          ]);
        }).toList(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    return FutureBuilder<List<PaymentApproval>>(
      key: ValueKey(
        'payments_${_rangeStart.year}-${_rangeStart.month}-${_rangeStart.day}_${_rangeEnd.year}-${_rangeEnd.month}-${_rangeEnd.day}',
      ),
      future: SupabaseTimesheetStorage.getPaymentApprovalsForRange(
        _rangeStart,
        _rangeEnd,
        companyId: companyId,
      ),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load payment data.'),
            onRetry: () => setState(() {}),
          );
        }
        final approvals = snapshot.data ?? const <PaymentApproval>[];
        approvals.sort((a, b) => a.periodStart.compareTo(b.periodStart));
        final approvalsByEmp = <String, PaymentApproval>{};
        for (final a in approvals) {
          approvalsByEmp[a.employeeId] = a; // latest period in-range wins
        }
        final exportHeaders = const [
          'Full Name', 'ID', 'Total Hours', 'Total Overtime Hours',
          'Normal salary', 'Overtime salary', 'Final payment', 'Status',
        ];
        final exportRows = _summaries.map((s) {
          final approval = approvalsByEmp[s.employee.id];
          final edited = approval?.editedAmount;
          final finalAmt = edited ?? s.paymentDue;
          final status = approval?.status ?? (approval?.approved == true ? 'approved' : 'pending');
          final normalSalary = s.regularHours * s.employee.hourlyRate;
          final overtimeSalary = s.overtimeHours * s.employee.hourlyRate * 1.5;
          return [
            s.employee.fullName,
            s.employee.employeeCode.isNotEmpty ? s.employee.employeeCode : '—',
            s.totalHours.toStringAsFixed(1),
            s.overtimeHours.toStringAsFixed(1),
            normalSalary.toStringAsFixed(2),
            overtimeSalary.toStringAsFixed(2),
            finalAmt.toStringAsFixed(2),
            status,
          ];
        }).toList();
        return SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    'Payments',
                    style: GoogleFonts.poppins(
                      color: const Color(0xFF111827),
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  buildExportButton(
                    context: context,
                    fileName: 'payments_${DateFormat('yyyy_MM').format(_rangeStart)}',
                    headers: exportHeaders,
                    rows: exportRows,
                  ),
                  const Spacer(),
                  OutlinedButton.icon(
                    onPressed: _pickFromDate,
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppTheme.gold),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      foregroundColor: AppTheme.gold,
                    ),
                    icon: const Icon(Icons.calendar_today_outlined, size: 18),
                    label: Text(
                      'From ${DateFormat('dd MMM y').format(_rangeStart)}',
                      style: GoogleFonts.poppins(color: AppTheme.gold, fontSize: 12),
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: _pickToDate,
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppTheme.gold),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      foregroundColor: AppTheme.gold,
                    ),
                    icon: const Icon(Icons.event_outlined, size: 18),
                    label: Text(
                      'To ${DateFormat('dd MMM y').format(_rangeEnd)}',
                      style: GoogleFonts.poppins(color: AppTheme.gold, fontSize: 12),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _activeQuickRange == 'this_month'
                      ? FilledButton(
                          style: _quickRangeStyle(true),
                          onPressed: () => _applyQuickRange('this_month'),
                          child: Text('This month', style: GoogleFonts.poppins(fontSize: 12)),
                        )
                      : OutlinedButton(
                          style: _quickRangeStyle(false),
                          onPressed: () => _applyQuickRange('this_month'),
                          child: Text('This month', style: GoogleFonts.poppins(fontSize: 12)),
                        ),
                  _activeQuickRange == 'last_30'
                      ? FilledButton(
                          style: _quickRangeStyle(true),
                          onPressed: () => _applyQuickRange('last_30'),
                          child: Text('Last 30 days', style: GoogleFonts.poppins(fontSize: 12)),
                        )
                      : OutlinedButton(
                          style: _quickRangeStyle(false),
                          onPressed: () => _applyQuickRange('last_30'),
                          child: Text('Last 30 days', style: GoogleFonts.poppins(fontSize: 12)),
                        ),
                  _activeQuickRange == 'this_quarter'
                      ? FilledButton(
                          style: _quickRangeStyle(true),
                          onPressed: () => _applyQuickRange('this_quarter'),
                          child: Text('This quarter', style: GoogleFonts.poppins(fontSize: 12)),
                        )
                      : OutlinedButton(
                          style: _quickRangeStyle(false),
                          onPressed: () => _applyQuickRange('this_quarter'),
                          child: Text('This quarter', style: GoogleFonts.poppins(fontSize: 12)),
                        ),
                ],
              ),
              const SizedBox(height: 10),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(
                    value: 'contractors_out',
                    icon: Icon(Icons.engineering_outlined, size: 16),
                    label: Text('Payment Out (Contractors)'),
                  ),
                  ButtonSegment(
                    value: 'clients_in',
                    icon: Icon(Icons.payments_outlined, size: 16),
                    label: Text('Payment In (Clients)'),
                  ),
                  ButtonSegment(
                    value: 'employees',
                    icon: Icon(Icons.people_outline, size: 16),
                    label: Text('Employees'),
                  ),
                  ButtonSegment(
                    value: 'overview',
                    icon: Icon(Icons.analytics_outlined, size: 16),
                    label: Text('Overview'),
                  ),
                ],
                selected: {_activeTab},
                onSelectionChanged: (s) {
                  if (s.isEmpty) return;
                  setState(() => _activeTab = s.first);
                },
              ),
              const SizedBox(height: 16),
              if (_summariesError != null) ...[
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    _summariesError!,
                    style: GoogleFonts.poppins(
                      color: const Color(0xFFB91C1C),
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
              if (widget.focusedEmployeeId != null) ...[
                const SizedBox(height: 10),
                Text(
                  'Focused employee context is highlighted in the table.',
                  style: GoogleFonts.poppins(
                    fontSize: 11,
                    color: const Color(0xFF92400E),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              const SizedBox(height: 12),
              FutureBuilder<List<dynamic>>(
                future: companyId == null
                    ? Future.value(const <dynamic>[
                        <Map<String, dynamic>>[],
                        <Map<String, dynamic>>[],
                        <dynamic>[],
                        <dynamic>[],
                      ])
                    : Future.wait([
                        SupabaseTimesheetStorage.getCompanyClientDeals(companyId: companyId),
                        SupabaseTimesheetStorage.getCompanyClientPayments(companyId: companyId),
                        SupabaseTimesheetStorage.getJobs(companyId: companyId),
                        SupabaseTimesheetStorage.getClients(companyId: companyId),
                      ]),
                builder: (context, finSnap) {
                  if (finSnap.connectionState == ConnectionState.waiting) {
                    return const SizedBox(
                      height: 72,
                      child: Center(child: CircularProgressIndicator(color: AppTheme.gold)),
                    );
                  }
                  final deals = (finSnap.data?[0] as List?)?.cast<Map<String, dynamic>>() ?? const [];
                  final payments = (finSnap.data?[1] as List?)?.cast<Map<String, dynamic>>() ?? const [];
                  final jobs = (finSnap.data?[2] as List?) ?? const [];

                  final offerTotal = deals.fold<double>(
                    0,
                    (s, d) => s + (((d['offer_amount'] as num?)?.toDouble()) ?? 0),
                  );
                  final paidTotal = payments
                      .where((p) => (p['status']?.toString() ?? '').toLowerCase() == 'paid')
                      .fold<double>(0, (s, p) => s + (((p['amount_due'] as num?)?.toDouble()) ?? 0));
                  final outstandingTotal = payments
                      .where((p) => (p['status']?.toString() ?? '').toLowerCase() != 'paid')
                      .fold<double>(0, (s, p) => s + (((p['amount_due'] as num?)?.toDouble()) ?? 0));
                  final jobActualCost = jobs.fold<double>(
                    0,
                    (s, j) => s + (((j.actualCost as num?)?.toDouble()) ?? 0),
                  );
                  final grossProfit = paidTotal - jobActualCost;
                  final totalPaidIn = paidTotal;
                  final payrollEmployees = _summaries
                      .where((s) => s.employee.workerType == WorkerType.employee)
                      .fold<double>(0, (sum, s) {
                    final a = approvalsByEmp[s.employee.id];
                    return sum + (a?.editedAmount ?? s.paymentDue);
                  });
                  final contractorPayouts = _summaries
                      .where((s) =>
                          s.employee.workerType == WorkerType.contractor ||
                          s.employee.workerType == WorkerType.subcontractor)
                      .fold<double>(0, (sum, s) {
                    final a = approvalsByEmp[s.employee.id];
                    final status = a?.status ?? (a?.approved == true ? 'approved' : 'pending');
                    if (status == 'approved' || status == 'partial') {
                      return sum + (a?.editedAmount ?? s.paymentDue);
                    }
                    return sum;
                  });
                  final contractorDue = _summaries
                      .where((s) =>
                          s.employee.workerType == WorkerType.contractor ||
                          s.employee.workerType == WorkerType.subcontractor)
                      .fold<double>(0, (sum, s) {
                    final a = approvalsByEmp[s.employee.id];
                    return sum + (a?.editedAmount ?? s.paymentDue);
                  });
                  final contractorOutstanding = (contractorDue - contractorPayouts).clamp(0, double.infinity);
                  final payrollApproved = _summaries
                      .where((s) => s.employee.workerType == WorkerType.employee)
                      .fold<double>(0, (sum, s) {
                    final a = approvalsByEmp[s.employee.id];
                    final status = a?.status ?? (a?.approved == true ? 'approved' : 'pending');
                    if (status == 'approved' || status == 'partial') {
                      return sum + (a?.editedAmount ?? s.paymentDue);
                    }
                    return sum;
                  });
                  final totalPaidOut = payrollApproved + contractorPayouts;
                  final employeeDue = _summaries
                      .where((s) => s.employee.workerType == WorkerType.employee)
                      .fold<double>(0, (sum, s) {
                    final a = approvalsByEmp[s.employee.id];
                    return sum + (a?.editedAmount ?? s.paymentDue);
                  });
                  final netAfterLabor = grossProfit - payrollEmployees - contractorPayouts;
                  final collectionRate = offerTotal > 0 ? (totalPaidIn / offerTotal) * 100 : 0.0;
                  final contractorCount = _summaries
                      .where((s) =>
                          s.employee.workerType == WorkerType.contractor ||
                          s.employee.workerType == WorkerType.subcontractor)
                      .length;
                  final employeeCount =
                      _summaries.where((s) => s.employee.workerType == WorkerType.employee).length;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: [
                            if (_activeTab == 'contractors_out') ...[
                              _SummaryCard(
                                label: 'Contractor payment due',
                                value: 'R ${contractorDue.toStringAsFixed(2)}',
                                subtitle:
                                    '${DateFormat('dd MMM').format(_rangeStart)} – ${DateFormat('dd MMM').format(_rangeEnd)} · $contractorCount contractor(s)',
                                valueColor: AppTheme.gold,
                              ),
                              const SizedBox(width: 12),
                              _SummaryCard(
                                label: 'Paid out (approved/partial)',
                                value: 'R ${contractorPayouts.toStringAsFixed(2)}',
                                subtitle: 'Contractor payouts',
                                valueColor: const Color(0xFF7C3AED),
                              ),
                              const SizedBox(width: 12),
                              _SummaryCard(
                                label: 'Outstanding',
                                value: 'R ${contractorOutstanding.toStringAsFixed(2)}',
                                subtitle: 'Still pending',
                                valueColor: const Color(0xFFB45309),
                              ),
                            ] else if (_activeTab == 'clients_in') ...[
                              _SummaryCard(
                                label: 'Total billed',
                                value: 'R ${offerTotal.toStringAsFixed(2)}',
                                subtitle: WorkspaceTerms.projectCount(deals.length),
                                valueColor: const Color(0xFF111827),
                              ),
                              const SizedBox(width: 12),
                              _SummaryCard(
                                label: 'Client paid in',
                                value: 'R ${totalPaidIn.toStringAsFixed(2)}',
                                subtitle: 'Settled client payments',
                                valueColor: const Color(0xFF059669),
                              ),
                              const SizedBox(width: 12),
                              _SummaryCard(
                                label: 'Client outstanding',
                                value: 'R ${outstandingTotal.toStringAsFixed(2)}',
                                subtitle: '${collectionRate.toStringAsFixed(1)}% collection rate',
                                valueColor: const Color(0xFFB45309),
                              ),
                            ] else if (_activeTab == 'employees') ...[
                              _SummaryCard(
                                label: 'Employee payment due',
                                value: 'R ${employeeDue.toStringAsFixed(2)}',
                                subtitle:
                                    '${DateFormat('dd MMM').format(_rangeStart)} – ${DateFormat('dd MMM').format(_rangeEnd)} · $employeeCount employee(s)',
                                valueColor: AppTheme.gold,
                              ),
                              const SizedBox(width: 12),
                              _SummaryCard(
                                label: 'Approved/partial payroll',
                                value: 'R ${payrollApproved.toStringAsFixed(2)}',
                                subtitle: 'Ready to pay',
                                valueColor: const Color(0xFF059669),
                              ),
                              const SizedBox(width: 12),
                              _SummaryCard(
                                label: 'Pending payroll',
                                value: 'R ${(employeeDue - payrollApproved).clamp(0, double.infinity).toStringAsFixed(2)}',
                                subtitle: 'Awaiting review/approval',
                                valueColor: const Color(0xFFB45309),
                              ),
                            ] else ...[
                              _SummaryCard(
                                label: 'Total payment in',
                                value: 'R ${totalPaidIn.toStringAsFixed(2)}',
                                subtitle: 'Client collections',
                                valueColor: const Color(0xFF059669),
                              ),
                              const SizedBox(width: 12),
                              _SummaryCard(
                                label: 'Total payment out',
                                value: 'R ${totalPaidOut.toStringAsFixed(2)}',
                                subtitle: 'Payroll + contractors',
                                valueColor: const Color(0xFF7C3AED),
                              ),
                              const SizedBox(width: 12),
                              _SummaryCard(
                                label: 'Gross profit',
                                value: 'R ${grossProfit.toStringAsFixed(2)}',
                                subtitle: 'Payment in - job cost',
                                valueColor: grossProfit >= 0 ? const Color(0xFF059669) : const Color(0xFFDC2626),
                              ),
                              const SizedBox(width: 12),
                              _SummaryCard(
                                label: 'Net after labor',
                                value: 'R ${netAfterLabor.toStringAsFixed(2)}',
                                subtitle: 'Gross - payroll - contractors',
                                valueColor: netAfterLabor >= 0 ? const Color(0xFF059669) : const Color(0xFFDC2626),
                              ),
                            ],
                          ],
                        ),
                      ),
                      if (_activeTab == 'overview') ...[
                        const SizedBox(height: 8),
                        Text(
                          'Inventory is counted via job actual cost where captured on each job.',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280),
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ],
                  );
                },
              ),
              const SizedBox(height: 16),
              Card(
                color: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: _loadingSummaries || !snapshot.hasData
                      ? const Center(
                          child: Padding(
                            padding: EdgeInsets.all(24),
                            child: CircularProgressIndicator(color: AppTheme.gold),
                          ),
                        )
                      : FutureBuilder<List<dynamic>>(
                          future: companyId == null
                              ? Future.value(const <dynamic>[<Map<String, dynamic>>[], <dynamic>[], <dynamic>[]])
                              : Future.wait([
                                  SupabaseTimesheetStorage.getCompanyClientPayments(companyId: companyId),
                                  SupabaseTimesheetStorage.getClients(companyId: companyId),
                                  SupabaseTimesheetStorage.getJobs(companyId: companyId),
                                ]),
                          builder: (context, tabSnap) {
                            final tabPayments =
                                (tabSnap.data?[0] as List?)?.cast<Map<String, dynamic>>() ?? const [];
                            final tabClients = (tabSnap.data?[1] as List?)?.cast<dynamic>() ?? const [];
                            final tabJobs = (tabSnap.data?[2] as List?) ?? const [];
                            final tabClientNameById = <String, String>{
                              for (final c in tabClients) c.id.toString(): (c.name?.toString() ?? 'Client'),
                            };
                            if (_activeTab == 'clients_in') {
                              return _buildClientsCollectionTable(
                                payments: tabPayments,
                                clientNameById: tabClientNameById,
                              );
                            }
                            if (_activeTab == 'employees') {
                              return _buildPaymentsTable(approvalsByEmp);
                            }
                            if (_activeTab == 'overview') {
                              final paidIn = tabPayments
                                  .where((p) {
                                    final status = (p['status']?.toString() ?? '').toLowerCase();
                                    return status == 'paid' || status == 'partial';
                                  })
                                  .fold<double>(0, (s, p) => s + (((p['amount_due'] as num?)?.toDouble()) ?? 0));
                              final jobActualCost = tabJobs
                                  .fold<double>(0, (s, j) => s + (((j.actualCost as num?)?.toDouble()) ?? 0));
                              final payrollApproved = _summaries
                                  .where((s) => s.employee.workerType == WorkerType.employee)
                                  .fold<double>(0, (sum, s) {
                                final a = approvalsByEmp[s.employee.id];
                                final status = a?.status ?? (a?.approved == true ? 'approved' : 'pending');
                                if (status == 'approved' || status == 'partial') {
                                  return sum + (a?.editedAmount ?? s.paymentDue);
                                }
                                return sum;
                              });
                              final contractorPaid = _summaries
                                  .where((s) =>
                                      s.employee.workerType == WorkerType.contractor ||
                                      s.employee.workerType == WorkerType.subcontractor)
                                  .fold<double>(0, (sum, s) {
                                final a = approvalsByEmp[s.employee.id];
                                final status = a?.status ?? (a?.approved == true ? 'approved' : 'pending');
                                if (status == 'approved' || status == 'partial') {
                                  return sum + (a?.editedAmount ?? s.paymentDue);
                                }
                                return sum;
                              });
                              final grossProfit = paidIn - jobActualCost;
                              final netAfterLabor = grossProfit - payrollApproved - contractorPaid;
                              return _buildFinancialOverviewTable(
                                totalPaidIn: paidIn,
                                totalPaidOut: payrollApproved + contractorPaid,
                                jobActualCost: jobActualCost,
                                grossProfit: grossProfit,
                                netAfterLabor: netAfterLabor,
                              );
                            }
                            return _buildContractorsPayoutTable(approvalsByEmp);
                          },
                        ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final String label;
  final String value;
  final String subtitle;
  final Color valueColor;

  const _SummaryCard({
    required this.label,
    required this.value,
    required this.subtitle,
    required this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 220,
      padding: const EdgeInsets.all(16),
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
          Text(value, style: GoogleFonts.poppins(color: valueColor, fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(subtitle, style: GoogleFonts.poppins(color: const Color(0xFF9CA3AF), fontSize: 11)),
        ],
      ),
    );
  }
}
