import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/client.dart';
import '../models/employee.dart';
import '../models/job.dart';
import '../models/unit.dart';
import '../services/storage_service.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';

class ClientDetailScreen extends StatefulWidget {
  final String companyId;
  final Client client;

  const ClientDetailScreen({
    super.key,
    required this.companyId,
    required this.client,
  });

  @override
  State<ClientDetailScreen> createState() => _ClientDetailScreenState();
}

class _ClientDetailScreenState extends State<ClientDetailScreen> {
  static const _dealStatuses = ['draft', 'sent', 'negotiation', 'won', 'lost'];
  static const _paymentStatuses = ['pending', 'paid', 'overdue', 'partial'];
  static const _pipelineStatuses = ['draft', 'sent', 'negotiation', 'won', 'lost'];
  String? _editingDealId;
  bool _addingNewDealRow = false;
  static const String _newDealRowId = '__new_deal__';
  final Map<String, String> _rowTitle = {};
  final Map<String, String> _rowDealStatus = {};
  final Map<String, String> _rowOffer = {};
  final Map<String, String> _rowExpected = {};
  final Map<String, String> _rowFinalAgreed = {};
  final Map<String, String> _rowPaymentStatus = {};

  DateTime? _parseDate(dynamic value) {
    if (value == null) return null;
    return DateTime.tryParse(value.toString());
  }

  DateTime? _parseDateText(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return null;
    return DateTime.tryParse(text);
  }

  Future<void> _saveDealRow({
    required String dealId,
    required Map<String, dynamic>? originalDeal,
    required List<Map<String, dynamic>> linkedPayments,
  }) async {
    try {
      final newTitle = (_rowTitle[dealId] ?? '').trim();
      if (newTitle.isEmpty) {
        showInfoSnack(context, 'Deal title is required.');
        return;
      }
      final originalOffer = ((originalDeal?['offer_amount'] as num?)?.toDouble() ?? 0);
      final newOffer = double.tryParse((_rowOffer[dealId] ?? '').trim()) ?? originalOffer;
      final newFinal = double.tryParse((_rowFinalAgreed[dealId] ?? '').trim()) ?? newOffer;
      final newStatus = _rowDealStatus[dealId] ?? 'draft';
      final newPaymentStatus = _rowPaymentStatus[dealId] ?? 'pending';
      final expectedDate = _parseDateText(_rowExpected[dealId] ?? '');

      String resolvedDealId = dealId;
      if (dealId == _newDealRowId) {
        resolvedDealId = await SupabaseTimesheetStorage.upsertClientDealReturningId(
          companyId: widget.companyId,
          clientId: widget.client.id,
          title: newTitle,
          status: newStatus,
          offerAmount: newOffer,
          expectedCloseDate: expectedDate,
          notes: null,
        ) ?? '';
        if (resolvedDealId.isEmpty) {
          if (mounted) showErrorSnack(context, 'Deal created but could not resolve its ID. Refresh and try again.');
          return;
        }
      } else {
        await SupabaseTimesheetStorage.upsertClientDeal(
          companyId: widget.companyId,
          clientId: widget.client.id,
          dealId: dealId,
          title: newTitle,
          status: newStatus,
          offerAmount: newOffer,
          jobId: originalDeal?['job_id']?.toString(),
          expectedCloseDate: expectedDate,
          notes: originalDeal?['notes']?.toString(),
        );
      }

      final existingPayment = linkedPayments.isNotEmpty ? linkedPayments.last : null;
      await SupabaseTimesheetStorage.upsertClientPayment(
        companyId: widget.companyId,
        clientId: widget.client.id,
        paymentId: existingPayment?['id']?.toString(),
        dealId: resolvedDealId,
        description: existingPayment?['description']?.toString() ?? 'Payment for $newTitle',
        amountDue: newFinal,
        dueDate: expectedDate,
        paidAt: newPaymentStatus == 'paid' ? DateTime.now() : null,
        status: newPaymentStatus,
      );
      if (!mounted) return;
      setState(() {
        _editingDealId = null;
        _addingNewDealRow = false;
        _rowTitle.remove(_newDealRowId);
        _rowDealStatus.remove(_newDealRowId);
        _rowOffer.remove(_newDealRowId);
        _rowExpected.remove(_newDealRowId);
        _rowFinalAgreed.remove(_newDealRowId);
        _rowPaymentStatus.remove(_newDealRowId);
      });
      showSuccessSnack(context, 'Deal row saved.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not save this row.'));
    }
  }

  bool _isPaymentSettled(Map<String, dynamic> payment) {
    final status = (payment['status']?.toString().toLowerCase() ?? '');
    return status == 'paid';
  }

  bool _isPaymentOverdue(Map<String, dynamic> payment) {
    if (_isPaymentSettled(payment)) return false;
    final due = _parseDate(payment['due_date']);
    if (due == null) return false;
    final today = DateTime.now();
    final d = DateTime(today.year, today.month, today.day);
    return due.isBefore(d);
  }

  bool _isPaymentDueSoon(Map<String, dynamic> payment) {
    if (_isPaymentSettled(payment)) return false;
    final due = _parseDate(payment['due_date']);
    if (due == null) return false;
    final today = DateTime.now();
    final d = DateTime(today.year, today.month, today.day);
    final soon = d.add(const Duration(days: 7));
    return !due.isBefore(d) && !due.isAfter(soon);
  }

  Widget _pill(String label, Color bg, Color fg) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(label, style: GoogleFonts.poppins(color: fg, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }

  Widget _inlineTextField({
    required String? initialValue,
    required ValueChanged<String> onChanged,
    ValueChanged<String>? onSubmitted,
    TextInputType? keyboardType,
    String? hintText,
    double width = 120,
  }) {
    return SizedBox(
      width: width,
      height: 34,
      child: TextFormField(
        initialValue: initialValue,
        onChanged: onChanged,
        onFieldSubmitted: onSubmitted,
        keyboardType: keyboardType,
        style: GoogleFonts.poppins(fontSize: 12),
        decoration: InputDecoration(
          isDense: true,
          hintText: hintText,
          contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          border: const OutlineInputBorder(),
        ),
      ),
    );
  }

  Future<Map<String, dynamic>> _loadAll() async {
    final results = await Future.wait<dynamic>([
      SupabaseTimesheetStorage.getClientById(widget.client.id, companyId: widget.companyId),
      SupabaseTimesheetStorage.getJobsForClient(widget.client.id, companyId: widget.companyId),
      SupabaseTimesheetStorage.getClientDeals(companyId: widget.companyId, clientId: widget.client.id),
      SupabaseTimesheetStorage.getClientPayments(companyId: widget.companyId, clientId: widget.client.id),
      SupabaseTimesheetStorage.getClientNotes(companyId: widget.companyId, clientId: widget.client.id),
      SupabaseTimesheetStorage.getClientFiles(companyId: widget.companyId, clientId: widget.client.id),
      SupabaseTimesheetStorage.getUnitsForClient(
        companyId: widget.companyId,
        clientId: widget.client.id,
      ),
    ]);
    return {
      'client': results[0] as Client?,
      'jobs': results[1] as List<Job>,
      'deals': results[2] as List<Map<String, dynamic>>,
      'payments': results[3] as List<Map<String, dynamic>>,
      'notes': results[4] as List<Map<String, dynamic>>,
      'files': results[5] as List<Map<String, dynamic>>,
      'units': results[6] as List<Unit>,
    };
  }

  Future<void> _showUnitDialogForClient({Unit? existing}) async {
    final result = await showDialog<Unit>(
      context: context,
      builder: (_) => _ClientUnitDialog(existing: existing),
    );
    if (result == null) return;
    try {
      if (existing == null) {
        await SupabaseTimesheetStorage.insertUnitForClient(
          companyId: widget.companyId,
          clientId: widget.client.id,
          unit: result,
        );
      } else {
        await SupabaseTimesheetStorage.updateUnit(unit: result);
      }
      if (mounted) setState(() {});
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, 'Could not save unit: ${friendlyErrorMessage(e, fallback: 'unknown')}');
    }
  }

  Future<void> _confirmDeleteUnit(Unit unit) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Delete unit?'),
        content: Text('Remove unit ${unit.unitNumber}? Residents and jobs linked to this unit will lose the reference.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await SupabaseTimesheetStorage.deleteUnit(unitId: unit.id);
      if (mounted) setState(() {});
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, 'Delete failed: ${friendlyErrorMessage(e, fallback: 'unknown')}');
    }
  }

  Future<void> _editClient(Client current) async {
    final nameCtrl = TextEditingController(text: current.name);
    final addressCtrl = TextEditingController(text: current.address ?? '');
    final contactCtrl = TextEditingController(text: current.contactPerson ?? '');
    final phoneCtrl = TextEditingController(text: current.phone ?? '');
    final emailCtrl = TextEditingController(text: current.email ?? '');
    final notesCtrl = TextEditingController(text: current.notes ?? '');
    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Edit client'),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              children: [
                TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name')),
                TextField(controller: addressCtrl, decoration: const InputDecoration(labelText: 'Address')),
                TextField(controller: contactCtrl, decoration: const InputDecoration(labelText: 'Contact person')),
                TextField(controller: phoneCtrl, decoration: const InputDecoration(labelText: 'Phone')),
                TextField(controller: emailCtrl, decoration: const InputDecoration(labelText: 'Email')),
                TextField(controller: notesCtrl, decoration: const InputDecoration(labelText: 'Notes'), maxLines: 2),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              final name = nameCtrl.text.trim();
              if (name.isEmpty) return;
              await SupabaseTimesheetStorage.upsertClient(
                Client(
                  id: current.id,
                  name: name,
                  address: addressCtrl.text.trim().isEmpty ? null : addressCtrl.text.trim(),
                  contactPerson: contactCtrl.text.trim().isEmpty ? null : contactCtrl.text.trim(),
                  phone: phoneCtrl.text.trim().isEmpty ? null : phoneCtrl.text.trim(),
                  email: emailCtrl.text.trim().isEmpty ? null : emailCtrl.text.trim(),
                  notes: notesCtrl.text.trim().isEmpty ? null : notesCtrl.text.trim(),
                  // Preserve the client's type — to change it, edit from
                  // the main Clients list which has a type selector.
                  clientType: current.clientType,
                ),
                companyId: widget.companyId,
              );
              if (mounted) Navigator.pop(context);
              if (mounted) setState(() {});
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  Future<void> _addNote(List<Map<String, dynamic>> deals, {String? presetDealId}) async {
    final ctrl = TextEditingController();
    String? selectedDealId = presetDealId ?? (deals.isNotEmpty ? deals.first['id']?.toString() : null);
    await showDialog<void>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Add discussion note'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                initialValue: selectedDealId,
                items: [
                  const DropdownMenuItem<String>(value: null, child: Text('General note (not linked)')),
                  ...deals.map((d) => DropdownMenuItem<String>(
                        value: d['id'].toString(),
                        child: Text(d['title']?.toString() ?? 'Deal'),
                      )),
                ],
                onChanged: (v) => setLocal(() => selectedDealId = v),
                decoration: const InputDecoration(labelText: 'Link to deal'),
              ),
              const SizedBox(height: 8),
              TextField(controller: ctrl, maxLines: 4, decoration: const InputDecoration(labelText: 'Note')),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () async {
                if (ctrl.text.trim().isEmpty) return;
                final nav = Navigator.of(context);
                await SupabaseTimesheetStorage.addClientNote(
                  companyId: widget.companyId,
                  clientId: widget.client.id,
                  dealId: selectedDealId,
                  note: ctrl.text.trim(),
                );
                if (nav.mounted) nav.pop();
                if (mounted) setState(() {});
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  String _guessMimeType(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return 'application/octet-stream';
  }

  Future<void> _uploadFile(List<Map<String, dynamic>> deals, {String? presetDealId}) async {
    String? selectedDealId = presetDealId ?? (deals.isNotEmpty ? deals.first['id']?.toString() : null);
    final selected = await showDialog<String?>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Link file to deal'),
          content: DropdownButtonFormField<String>(
            initialValue: selectedDealId,
            items: [
              const DropdownMenuItem<String>(value: null, child: Text('General file (not linked)')),
              ...deals.map((d) => DropdownMenuItem<String>(
                    value: d['id'].toString(),
                    child: Text(d['title']?.toString() ?? 'Deal'),
                  )),
            ],
            onChanged: (v) => setLocal(() => selectedDealId = v),
            decoration: const InputDecoration(labelText: 'Deal'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(null), child: const Text('Cancel')),
            ElevatedButton(onPressed: () => Navigator.of(context).pop(selectedDealId), child: const Text('Continue')),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (selected == null && deals.isNotEmpty) return;
    final picked = await FilePicker.platform.pickFiles(withData: true);
    if (picked == null || picked.files.isEmpty) return;
    final file = picked.files.first;
    final bytes = file.bytes;
    if (bytes == null) return;
    final url = await StorageService.uploadBytes(
      folder: 'client_files/client_${widget.client.id}',
      fileName: '${DateTime.now().millisecondsSinceEpoch}_${file.name}',
      bytes: bytes,
      contentType: _guessMimeType(file.name),
    );
    await SupabaseTimesheetStorage.addClientFile(
      companyId: widget.companyId,
      clientId: widget.client.id,
      dealId: selected,
      fileName: file.name,
      fileUrl: url,
      fileType: _guessMimeType(file.name),
      sizeBytes: bytes.length,
    );
    if (mounted) {
      setState(() {});
      showSuccessSnack(context, 'File uploaded.');
    }
  }

  Future<void> _openFileUrl(String? rawUrl) async {
    final value = rawUrl?.trim() ?? '';
    if (value.isEmpty) {
      showInfoSnack(context, 'File URL is missing.');
      return;
    }
    final uri = Uri.tryParse(value);
    if (uri == null) {
      showErrorSnack(context, 'Invalid file link.');
      return;
    }
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      showErrorSnack(context, 'Could not open file link.');
    }
  }

  Future<void> _showDealNotesDialog(String dealId, List<Map<String, dynamic>> allNotes) async {
    final linked = allNotes.where((n) => n['deal_id']?.toString() == dealId).toList();
    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Deal notes'),
        content: SizedBox(
          width: 520,
          child: linked.isEmpty
              ? const Text('No notes linked to this deal yet.')
              : ListView.separated(
                  shrinkWrap: true,
                  itemBuilder: (_, i) {
                    final n = linked[i];
                    return ListTile(
                      title: Text(n['note']?.toString() ?? ''),
                      subtitle: Text(
                        n['created_at'] == null
                            ? '—'
                            : DateFormat('yyyy-MM-dd HH:mm').format(DateTime.parse(n['created_at'].toString()).toLocal()),
                      ),
                    );
                  },
                  separatorBuilder: (context, index) => const Divider(height: 1),
                  itemCount: linked.length,
                ),
        ),
        actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close'))],
      ),
    );
  }

  Future<void> _showDealFilesDialog(String dealId, List<Map<String, dynamic>> allFiles) async {
    final linked = allFiles.where((f) => f['deal_id']?.toString() == dealId).toList();
    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Deal files'),
        content: SizedBox(
          width: 560,
          child: linked.isEmpty
              ? const Text('No files linked to this deal yet.')
              : ListView.separated(
                  shrinkWrap: true,
                  itemBuilder: (_, i) {
                    final f = linked[i];
                    return ListTile(
                      title: Text(f['file_name']?.toString() ?? 'file'),
                      subtitle: Text(f['file_type']?.toString() ?? ''),
                      trailing: TextButton(
                        onPressed: () => _openFileUrl(f['file_url']?.toString()),
                        child: const Text('Download'),
                      ),
                    );
                  },
                  separatorBuilder: (context, index) => const Divider(height: 1),
                  itemCount: linked.length,
                ),
        ),
        actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close'))],
      ),
    );
  }

  Future<void> _showPaymentHistoryDialog({
    required String dealId,
    required String dealTitle,
    required List<Map<String, dynamic>> allPayments,
    required double finalAgreedAmount,
  }) async {
    final linked = allPayments.where((p) => p['deal_id']?.toString() == dealId).toList()
      ..sort((a, b) {
        final aDt = DateTime.tryParse(a['created_at']?.toString() ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0);
        final bDt = DateTime.tryParse(b['created_at']?.toString() ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0);
        return bDt.compareTo(aDt);
      });
    final paidSoFar = linked.fold<double>(0, (sum, p) {
      final s = (p['status']?.toString().toLowerCase() ?? '');
      if (s == 'paid' || s == 'partial') {
        return sum + ((p['amount_due'] as num?)?.toDouble() ?? 0);
      }
      return sum;
    });
    final balance = (finalAgreedAmount - paidSoFar).clamp(0, double.infinity);

    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Payment history • $dealTitle'),
        content: SizedBox(
          width: 640,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Final agreed: R ${finalAgreedAmount.toStringAsFixed(2)} | Paid: R ${paidSoFar.toStringAsFixed(2)} | Balance: R ${balance.toStringAsFixed(2)}',
                style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF374151)),
              ),
              const SizedBox(height: 10),
              if (linked.isEmpty)
                const Text('No payment entries yet.')
              else
                SizedBox(
                  height: 260,
                  child: ListView.separated(
                    itemCount: linked.length,
                    separatorBuilder: (context, index) => const Divider(height: 1),
                    itemBuilder: (_, i) {
                      final p = linked[i];
                      final amount = ((p['amount_due'] as num?)?.toDouble() ?? 0);
                      final status = (p['status']?.toString().toUpperCase() ?? 'PENDING');
                      final created = DateTime.tryParse(p['created_at']?.toString() ?? '');
                      return ListTile(
                        dense: true,
                        title: Text('R ${amount.toStringAsFixed(2)} • $status'),
                        subtitle: Text(
                          '${p['description'] ?? 'Payment entry'}'
                          '${created != null ? ' • ${DateFormat('yyyy-MM-dd HH:mm').format(created.toLocal())}' : ''}',
                        ),
                      );
                    },
                  ),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close')),
          ElevatedButton.icon(
            onPressed: () async {
              final amountCtrl = TextEditingController();
              final descCtrl = TextEditingController(text: 'Installment for $dealTitle');
              String status = 'partial';
              DateTime? dueDate;
              final ok = await showDialog<bool>(
                context: context,
                builder: (_) => StatefulBuilder(
                  builder: (context, setLocal) => AlertDialog(
                    title: const Text('Add payment installment'),
                    content: SizedBox(
                      width: 460,
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          TextField(
                            controller: amountCtrl,
                            keyboardType: const TextInputType.numberWithOptions(decimal: true),
                            decoration: const InputDecoration(labelText: 'Amount'),
                          ),
                          TextField(
                            controller: descCtrl,
                            decoration: const InputDecoration(labelText: 'Description'),
                          ),
                          DropdownButtonFormField<String>(
                            initialValue: status,
                            items: _paymentStatuses
                                .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                                .toList(),
                            onChanged: (v) => setLocal(() => status = v ?? 'partial'),
                            decoration: const InputDecoration(labelText: 'Status'),
                          ),
                          const SizedBox(height: 8),
                          OutlinedButton.icon(
                            onPressed: () async {
                              final picked = await showDatePicker(
                                context: context,
                                initialDate: dueDate ?? DateTime.now(),
                                firstDate: DateTime(2020),
                                lastDate: DateTime(2100),
                              );
                              if (picked != null) setLocal(() => dueDate = picked);
                            },
                            icon: const Icon(Icons.event),
                            label: Text(dueDate == null ? 'Due date (optional)' : DateFormat('yyyy-MM-dd').format(dueDate!)),
                          ),
                        ],
                      ),
                    ),
                    actions: [
                      TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
                      ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Add')),
                    ],
                  ),
                ),
              );
              if (ok != true) return;
              await SupabaseTimesheetStorage.upsertClientPayment(
                companyId: widget.companyId,
                clientId: widget.client.id,
                dealId: dealId,
                description: descCtrl.text.trim().isEmpty ? 'Installment' : descCtrl.text.trim(),
                amountDue: double.tryParse(amountCtrl.text.trim()) ?? 0,
                dueDate: dueDate,
                paidAt: status == 'paid' ? DateTime.now() : null,
                status: status,
              );
              if (!mounted) return;
              Navigator.of(context).pop();
              setState(() {});
            },
            icon: const Icon(Icons.add, size: 16),
            label: const Text('Add installment'),
          ),
        ],
      ),
    );
  }

  Future<DateTime?> _pickDateTime(DateTime? initial) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: initial ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 2),
    );
    if (date == null || !mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial ?? now),
    );
    if (time == null || !mounted) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  Future<void> _pushDealToJob(Map<String, dynamic> deal) async {
    final employees = await SupabaseTimesheetStorage.getEmployees(companyId: widget.companyId);
    if (!mounted) return;
    final currentUserId = Supabase.instance.client.auth.currentUser?.id;
    String? resolveMyAssignableEmployeeId() {
      if (currentUserId == null || employees.isEmpty) return null;
      for (final e in employees) {
        if (e.id == currentUserId) return e.id;
      }
      for (final e in employees) {
        if (e.managerUserId == currentUserId && e.accessLevel == EmployeeAccessLevel.hrAdmin) {
          return e.id;
        }
      }
      for (final e in employees) {
        if (e.managerUserId == currentUserId && e.accessLevel == EmployeeAccessLevel.manager) {
          return e.id;
        }
      }
      for (final e in employees) {
        if (e.managerUserId == currentUserId) return e.id;
      }
      return null;
    }
    final myEmployeeId = resolveMyAssignableEmployeeId();
    final selectedEmployees = <String>{...?(myEmployeeId != null ? {myEmployeeId} : null)};
    final titleCtrl = TextEditingController(text: deal['title']?.toString() ?? 'Client job');
    final descCtrl = TextEditingController(
      text:
          'Offer amount: R ${((deal['offer_amount'] as num?)?.toDouble() ?? 0).toStringAsFixed(2)}\n${deal['notes'] ?? ''}'.trim(),
    );
    DateTime? scheduledStart;
    DateTime? scheduledEnd;
    final created = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Push deal to job'),
          content: SizedBox(
            width: 620,
            child: SingleChildScrollView(
              child: Column(
                children: [
                  TextField(controller: titleCtrl, decoration: const InputDecoration(labelText: 'Job title')),
                  const SizedBox(height: 8),
                  TextField(
                    controller: descCtrl,
                    maxLines: 3,
                    decoration: const InputDecoration(labelText: 'Job description'),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            final dt = await _pickDateTime(scheduledStart);
                            if (dt != null) setLocal(() => scheduledStart = dt);
                          },
                          icon: const Icon(Icons.schedule, size: 16),
                          label: Text(
                            scheduledStart == null
                                ? 'Start'
                                : DateFormat('yyyy-MM-dd HH:mm').format(scheduledStart!),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            final dt = await _pickDateTime(scheduledEnd);
                            if (dt != null) setLocal(() => scheduledEnd = dt);
                          },
                          icon: const Icon(Icons.schedule_send, size: 16),
                          label: Text(
                            scheduledEnd == null ? 'End' : DateFormat('yyyy-MM-dd HH:mm').format(scheduledEnd!),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Assign employees',
                      style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: () {
                          final myId = resolveMyAssignableEmployeeId();
                          if (myId == null) {
                            showInfoSnack(context, 'Could not find your employee profile to assign.');
                            return;
                          }
                          setLocal(() => selectedEmployees.add(myId));
                        },
                        icon: const Icon(Icons.person_add_alt_1, size: 16),
                        label: const Text('Assign myself'),
                      ),
                      OutlinedButton.icon(
                        onPressed: () => setLocal(selectedEmployees.clear),
                        icon: const Icon(Icons.clear_all, size: 16),
                        label: const Text('Clear'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  if (employees.isEmpty)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text('No employees found.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280))),
                    )
                  else
                    ...employees.map((e) {
                      return CheckboxListTile(
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
                      );
                    }),
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
                    clientId: widget.client.id,
                    siteId: null,
                    scheduledStart: scheduledStart,
                    scheduledEnd: scheduledEnd,
                    status: JobStatus.scheduled,
                    assignedEmployeeIds: selectedEmployees.toList(),
                  ),
                  companyId: widget.companyId,
                );
                if (jobId == null) {
                  if (!context.mounted) return;
                  showErrorSnack(context, 'Could not create job from this deal.');
                  return;
                }
                await SupabaseTimesheetStorage.setClientDealJob(
                  companyId: widget.companyId,
                  dealId: deal['id'].toString(),
                  jobId: jobId,
                );
                if (context.mounted) Navigator.of(context).pop(true);
              },
              child: const Text('Push to jobs'),
            ),
          ],
        ),
      ),
    );
    if (created == true && mounted) {
      setState(() {});
      showSuccessSnack(context, 'Deal pushed to jobs.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        title: Text('Client details', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _loadAll(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return LoadErrorPanel(
              message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load client details.'),
              onRetry: () => setState(() {}),
            );
          }
          if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
            return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
          }
          final client = snapshot.data!['client'] as Client? ?? widget.client;
          final jobs = snapshot.data!['jobs'] as List<Job>;
          final deals = snapshot.data!['deals'] as List<Map<String, dynamic>>;
          final payments = snapshot.data!['payments'] as List<Map<String, dynamic>>;
          final notes = snapshot.data!['notes'] as List<Map<String, dynamic>>;
          final files = snapshot.data!['files'] as List<Map<String, dynamic>>;
          final units = snapshot.data!['units'] as List<Unit>;

          final totalDealsValue = deals.fold<double>(
            0,
            (sum, d) => sum + ((d['offer_amount'] as num?)?.toDouble() ?? 0),
          );
          final totalPaid = payments
              .where((p) => (p['status']?.toString().toLowerCase() ?? '') == 'paid')
              .fold<double>(0, (sum, p) => sum + ((p['amount_due'] as num?)?.toDouble() ?? 0));
          final totalOutstanding = payments
              .where((p) => (p['status']?.toString().toLowerCase() ?? '') != 'paid')
              .fold<double>(0, (sum, p) => sum + ((p['amount_due'] as num?)?.toDouble() ?? 0));
          final completedJobs = jobs.where((j) => j.status == JobStatus.completed).length;
          final openPipelineValue = deals
              .where((d) {
                final s = (d['status']?.toString().toLowerCase() ?? '');
                return s != 'won' && s != 'lost';
              })
              .fold<double>(0, (sum, d) => sum + ((d['offer_amount'] as num?)?.toDouble() ?? 0));
          final overdueCount = payments.where(_isPaymentOverdue).length;
          final dueSoonCount = payments.where(_isPaymentDueSoon).length;
          final collectionRate = (totalPaid + totalOutstanding) > 0
              ? ((totalPaid / (totalPaid + totalOutstanding)) * 100)
              : 0;
          final screenWidth = MediaQuery.of(context).size.width;
          final isCompact = screenWidth < 1100;

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  client.name,
                                  style: GoogleFonts.poppins(fontSize: 20, fontWeight: FontWeight.w700),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: switch (client.clientType) {
                                    ClientType.individual => const Color(0xFF6B7280).withValues(alpha: 0.10 * 255),
                                    ClientType.company => const Color(0xFF2563EB).withValues(alpha: 0.10 * 255),
                                    ClientType.property => const Color(0xFF059669).withValues(alpha: 0.10 * 255),
                                  },
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  client.clientType.label,
                                  style: GoogleFonts.poppins(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: switch (client.clientType) {
                                      ClientType.individual => const Color(0xFF6B7280),
                                      ClientType.company => const Color(0xFF2563EB),
                                      ClientType.property => const Color(0xFF059669),
                                    },
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text('Address: ${client.address ?? '—'}'),
                          Text('Contact: ${client.contactPerson ?? '—'}'),
                          Text('Phone: ${client.phone ?? '—'}'),
                          Text('Email: ${client.email ?? '—'}'),
                        ]),
                      ),
                      OutlinedButton.icon(
                        onPressed: () => _editClient(client),
                        icon: const Icon(Icons.edit),
                        label: const Text('Edit'),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _metricCard('Jobs', jobs.length.toString(), compact: isCompact),
                  _metricCard('Deals value', 'R ${totalDealsValue.toStringAsFixed(2)}', compact: isCompact),
                  _metricCard('Outstanding', 'R ${totalOutstanding.toStringAsFixed(2)}', compact: isCompact),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _metricCard('Total paid', 'R ${totalPaid.toStringAsFixed(2)}', compact: isCompact),
                  _metricCard('Open pipeline', 'R ${openPipelineValue.toStringAsFixed(2)}', compact: isCompact),
                  _metricCard('Collection', '${collectionRate.toStringAsFixed(1)}%', compact: isCompact),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _metricCard('Completed jobs', completedJobs.toString(), compact: isCompact),
                  _metricCard('Overdue invoices', overdueCount.toString(), compact: isCompact),
                  _metricCard('Due in 7 days', dueSoonCount.toString(), compact: isCompact),
                ],
              ),
              if (client.clientType == ClientType.property) ...[
                const SizedBox(height: 14),
                _sectionHeader('Units'),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                units.isEmpty
                                    ? 'No units yet. Add the first unit to start cascading them onto jobs.'
                                    : '${units.length} unit${units.length == 1 ? '' : 's'} registered.',
                                style: GoogleFonts.poppins(
                                  color: const Color(0xFF6B7280),
                                  fontSize: 12,
                                ),
                              ),
                            ),
                            FilledButton.icon(
                              onPressed: () => _showUnitDialogForClient(),
                              icon: const Icon(Icons.add, size: 16),
                              label: const Text('Add unit'),
                            ),
                          ],
                        ),
                        if (units.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          ...units.map((u) {
                            final color = switch (u.occupancyStatus) {
                              'occupied' => const Color(0xFF059669),
                              'vacant' => const Color(0xFF6B7280),
                              'reserved' => const Color(0xFF2563EB),
                              'off_market' => const Color(0xFFB91C1C),
                              _ => const Color(0xFF6B7280),
                            };
                            return Container(
                              margin: const EdgeInsets.only(top: 6),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF9FAFB),
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: const Color(0xFFE5E7EB)),
                              ),
                              child: ListTile(
                                dense: true,
                                title: Wrap(
                                  spacing: 8,
                                  crossAxisAlignment: WrapCrossAlignment.center,
                                  children: [
                                    Text('Unit ${u.unitNumber}',
                                        style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: color.withValues(alpha: 0.10 * 255),
                                        borderRadius: BorderRadius.circular(999),
                                      ),
                                      child: Text(
                                        u.occupancyStatus.replaceAll('_', ' '),
                                        style: GoogleFonts.poppins(
                                          color: color,
                                          fontSize: 10,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                subtitle: Text(
                                  [
                                    if (u.label != null && u.label!.isNotEmpty) u.label!,
                                    if (u.floor != null && u.floor!.isNotEmpty) 'Floor ${u.floor}',
                                  ].join(' · '),
                                  style: GoogleFonts.poppins(
                                    fontSize: 11,
                                    color: const Color(0xFF6B7280),
                                  ),
                                ),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      icon: const Icon(Icons.edit_outlined, size: 16, color: Color(0xFF6B7280)),
                                      onPressed: () => _showUnitDialogForClient(existing: u),
                                    ),
                                    IconButton(
                                      icon: const Icon(Icons.delete_outline, size: 16, color: Color(0xFFB91C1C)),
                                      onPressed: () => _confirmDeleteUnit(u),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          }),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 14),
              _sectionHeader('Deal Pipeline Board'),
              SizedBox(
                height: 240,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _pipelineStatuses.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 10),
                  itemBuilder: (_, i) {
                    final status = _pipelineStatuses[i];
                    final group = deals.where((d) => (d['status']?.toString().toLowerCase() ?? '') == status).toList();
                    final total = group.fold<double>(
                      0,
                      (sum, d) => sum + ((d['offer_amount'] as num?)?.toDouble() ?? 0),
                    );
                    return Container(
                      width: 270,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFFE5E7EB)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(status.toUpperCase(), style: GoogleFonts.poppins(fontWeight: FontWeight.w700)),
                              const Spacer(),
                              _pill('${group.length}', const Color(0xFF111827), Colors.white),
                            ],
                          ),
                          Text('R ${total.toStringAsFixed(2)}',
                              style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12)),
                          const SizedBox(height: 6),
                          Expanded(
                            child: group.isEmpty
                                ? Center(
                                    child: Text('No deals', style: GoogleFonts.poppins(color: const Color(0xFF9CA3AF))),
                                  )
                                : ListView.builder(
                                    itemCount: group.length,
                                    itemBuilder: (_, idx) {
                                      final d = group[idx];
                                      return Card(
                                        elevation: 0,
                                        color: const Color(0xFFF9FAFB),
                                        child: ListTile(
                                          dense: true,
                                          title: Text(d['title']?.toString() ?? 'Deal',
                                              style: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w600)),
                                          subtitle: Text(
                                            'R ${((d['offer_amount'] as num?)?.toDouble() ?? 0).toStringAsFixed(2)}',
                                            style: GoogleFonts.poppins(fontSize: 11),
                                          ),
                                          onTap: () => setState(() => _editingDealId = d['id']?.toString()),
                                        ),
                                      );
                                    },
                                  ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(height: 10),
              _sectionHeader(
                'Deals / Offers',
                onAdd: () {
                  setState(() {
                    _addingNewDealRow = true;
                    _editingDealId = _newDealRowId;
                    _rowTitle[_newDealRowId] = '';
                    _rowDealStatus[_newDealRowId] = 'draft';
                    _rowOffer[_newDealRowId] = '0';
                    _rowExpected[_newDealRowId] = '';
                    _rowFinalAgreed[_newDealRowId] = '0';
                    _rowPaymentStatus[_newDealRowId] = 'pending';
                  });
                },
              ),
              Card(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columnSpacing: isCompact ? 12 : 20,
                    headingRowHeight: isCompact ? 40 : 52,
                    dataRowMinHeight: isCompact ? 38 : 46,
                    dataRowMaxHeight: isCompact ? 52 : 64,
                    columns: const [
                      DataColumn(label: Text('Title')),
                      DataColumn(label: Text('Deal Status')),
                      DataColumn(label: Text('Offer')),
                      DataColumn(label: Text('Final agreed')),
                      DataColumn(label: Text('Payment status')),
                      DataColumn(label: Text('Payment history')),
                      DataColumn(label: Text('Notes')),
                      DataColumn(label: Text('Files')),
                      DataColumn(label: Text('Actions')),
                    ],
                    rows: [
                      ...deals.map((d) {
                      final did = d['id']?.toString() ?? '';
                      final linkedPayments = payments.where((p) => p['deal_id']?.toString() == did).toList();
                      final isEditing = _editingDealId == did;
                      final offerValue = ((d['offer_amount'] as num?)?.toDouble() ?? 0);
                      final finalAgreedValue = linkedPayments.isNotEmpty
                          ? ((linkedPayments.last['amount_due'] as num?)?.toDouble() ?? offerValue)
                          : offerValue;
                      final paidSoFar = linkedPayments.fold<double>(0, (sum, p) {
                        final s = (p['status']?.toString().toLowerCase() ?? '');
                        if (s == 'paid' || s == 'partial') {
                          return sum + ((p['amount_due'] as num?)?.toDouble() ?? 0);
                        }
                        return sum;
                      });
                      final paymentStatus = (() {
                        if (linkedPayments.any((p) => (p['status']?.toString().toLowerCase() ?? '') == 'overdue') &&
                            paidSoFar < finalAgreedValue) {
                          return 'overdue';
                        }
                        if (paidSoFar <= 0) return 'pending';
                        if (paidSoFar >= finalAgreedValue && finalAgreedValue > 0) return 'paid';
                        return 'partial';
                      })();
                      _rowTitle.putIfAbsent(did, () => d['title']?.toString() ?? 'Deal');
                      _rowDealStatus.putIfAbsent(did, () => (d['status']?.toString().toLowerCase() ?? 'draft'));
                      _rowOffer.putIfAbsent(did, () => offerValue.toStringAsFixed(2));
                      _rowExpected.putIfAbsent(did, () => d['expected_close_date']?.toString() ?? '');
                      _rowFinalAgreed.putIfAbsent(did, () => finalAgreedValue.toStringAsFixed(2));
                      _rowPaymentStatus.putIfAbsent(did, () => paymentStatus);
                      return DataRow(cells: [
                        DataCell(
                          isEditing
                              ? _inlineTextField(
                                  width: isCompact ? 130 : 180,
                                  initialValue: _rowTitle[did],
                                  onChanged: (v) => _rowTitle[did] = v,
                                  onSubmitted: (_) => _saveDealRow(
                                    dealId: did,
                                    originalDeal: d,
                                    linkedPayments: linkedPayments,
                                  ),
                                )
                              : InkWell(
                                  onDoubleTap: () => setState(() => _editingDealId = did),
                                  child: Text(d['title']?.toString() ?? 'Deal'),
                                ),
                        ),
                        DataCell(
                          isEditing
                              ? SizedBox(
                                  width: isCompact ? 120 : 150,
                                  child: DropdownButtonFormField<String>(
                                    initialValue: _rowDealStatus[did],
                                    isDense: true,
                                    items: _dealStatuses.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                                    onChanged: (v) => setState(() => _rowDealStatus[did] = v ?? 'draft'),
                                  ),
                                )
                              : Text((d['status'] ?? '').toString().toUpperCase()),
                        ),
                        DataCell(
                          isEditing
                              ? _inlineTextField(
                                  width: isCompact ? 95 : 120,
                                  initialValue: _rowOffer[did],
                                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                  onChanged: (v) => _rowOffer[did] = v,
                                  onSubmitted: (_) => _saveDealRow(
                                    dealId: did,
                                    originalDeal: d,
                                    linkedPayments: linkedPayments,
                                  ),
                                )
                              : Text('R ${offerValue.toStringAsFixed(2)}'),
                        ),
                        DataCell(
                          isEditing
                              ? _inlineTextField(
                                  width: isCompact ? 95 : 120,
                                  initialValue: _rowFinalAgreed[did],
                                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                  onChanged: (v) => _rowFinalAgreed[did] = v,
                                  onSubmitted: (_) => _saveDealRow(
                                    dealId: did,
                                    originalDeal: d,
                                    linkedPayments: linkedPayments,
                                  ),
                                )
                              : Text('R ${finalAgreedValue.toStringAsFixed(2)}'),
                        ),
                        DataCell(
                          isEditing
                              ? SizedBox(
                                  width: isCompact ? 110 : 130,
                                  child: DropdownButtonFormField<String>(
                                    initialValue: _rowPaymentStatus[did],
                                    isDense: true,
                                    items: _paymentStatuses.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                                    onChanged: (v) => setState(() => _rowPaymentStatus[did] = v ?? 'pending'),
                                  ),
                                )
                              : _pill(paymentStatus.toUpperCase(), const Color(0xFF6B7280), Colors.white),
                        ),
                        DataCell(
                          TextButton(
                            onPressed: () => _showPaymentHistoryDialog(
                              dealId: did,
                              dealTitle: d['title']?.toString() ?? 'Deal',
                              allPayments: payments,
                              finalAgreedAmount: finalAgreedValue,
                            ),
                            child: Text('${linkedPayments.length} entries'),
                          ),
                        ),
                        DataCell(Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('${notes.where((n) => n['deal_id']?.toString() == did).length}'),
                            const SizedBox(width: 6),
                            TextButton(
                              onPressed: () => _showDealNotesDialog(did, notes),
                              child: const Text('Open'),
                            ),
                            TextButton(onPressed: () => _addNote(deals, presetDealId: did), child: const Text('Add')),
                          ],
                        )),
                        DataCell(Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('${files.where((f) => f['deal_id']?.toString() == did).length}'),
                            const SizedBox(width: 6),
                            TextButton(
                              onPressed: () {
                                _showDealFilesDialog(did, files);
                              },
                              child: const Text('Open'),
                            ),
                            TextButton(onPressed: () => _uploadFile(deals, presetDealId: did), child: const Text('Add')),
                          ],
                        )),
                        DataCell(Row(mainAxisSize: MainAxisSize.min, children: [
                          if (d['job_id'] == null && !isEditing)
                            TextButton(onPressed: () => _pushDealToJob(d), child: const Text('Push to job')),
                          if (d['job_id'] != null && !isEditing) _pill('Pushed', const Color(0xFF10B981), Colors.white),
                          if (!isEditing)
                            const SizedBox(width: 6),
                          if (isEditing)
                            TextButton(
                              onPressed: () => _saveDealRow(
                                dealId: did,
                                originalDeal: d,
                                linkedPayments: linkedPayments,
                              ),
                              child: const Text('Save'),
                            ),
                          if (isEditing)
                            TextButton(
                              onPressed: () => setState(() => _editingDealId = null),
                              child: const Text('Cancel'),
                            ),
                          if (!isEditing)
                            IconButton(
                              icon: const Icon(Icons.delete_outline, color: Colors.red),
                              onPressed: () async {
                                await SupabaseTimesheetStorage.deleteClientDeal(
                                  companyId: widget.companyId,
                                  dealId: did,
                                );
                                if (mounted) setState(() {});
                              },
                            ),
                        ])),
                      ]);
                    }),
                      if (_addingNewDealRow)
                        DataRow(cells: [
                          DataCell(
                            _inlineTextField(
                              width: isCompact ? 130 : 180,
                              initialValue: _rowTitle[_newDealRowId],
                              onChanged: (v) => _rowTitle[_newDealRowId] = v,
                              onSubmitted: (_) => _saveDealRow(
                                dealId: _newDealRowId,
                                originalDeal: null,
                                linkedPayments: const [],
                              ),
                            ),
                          ),
                          DataCell(
                            SizedBox(
                              width: isCompact ? 120 : 150,
                              child: DropdownButtonFormField<String>(
                                initialValue: _rowDealStatus[_newDealRowId] ?? 'draft',
                                isDense: true,
                                items: _dealStatuses.map((s) => DropdownMenuItem(value: s, child: Text(s))).toList(),
                                onChanged: (v) => setState(() => _rowDealStatus[_newDealRowId] = v ?? 'draft'),
                              ),
                            ),
                          ),
                          DataCell(
                            _inlineTextField(
                              width: isCompact ? 95 : 120,
                              initialValue: _rowOffer[_newDealRowId] ?? '0',
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              onChanged: (v) => _rowOffer[_newDealRowId] = v,
                            ),
                          ),
                          DataCell(
                            _inlineTextField(
                              width: isCompact ? 95 : 120,
                              initialValue: _rowFinalAgreed[_newDealRowId] ?? '0',
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              onChanged: (v) => _rowFinalAgreed[_newDealRowId] = v,
                              onSubmitted: (_) => _saveDealRow(
                                dealId: _newDealRowId,
                                originalDeal: null,
                                linkedPayments: const [],
                              ),
                            ),
                          ),
                          DataCell(
                            SizedBox(
                              width: isCompact ? 110 : 130,
                              child: DropdownButtonFormField<String>(
                                initialValue: _rowPaymentStatus[_newDealRowId] ?? 'pending',
                                isDense: true,
                                items: _paymentStatuses
                                    .map((s) => DropdownMenuItem(value: s, child: Text(s)))
                                    .toList(),
                                onChanged: (v) => setState(() => _rowPaymentStatus[_newDealRowId] = v ?? 'pending'),
                              ),
                            ),
                          ),
                          const DataCell(Text('0 entries')),
                          const DataCell(Text('0')),
                          const DataCell(Text('0')),
                          DataCell(
                            Row(
                              children: [
                                TextButton(
                                  onPressed: () => _saveDealRow(
                                    dealId: _newDealRowId,
                                    originalDeal: null,
                                    linkedPayments: const [],
                                  ),
                                  child: const Text('Save'),
                                ),
                                TextButton(
                                  onPressed: () => setState(() {
                                    _addingNewDealRow = false;
                                    _editingDealId = null;
                                  }),
                                  child: const Text('Cancel'),
                                ),
                              ],
                            ),
                          ),
                        ]),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 10),
              _sectionHeader('Job History'),
              Card(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: DataTable(
                    columnSpacing: isCompact ? 12 : 20,
                    headingRowHeight: isCompact ? 40 : 52,
                    dataRowMinHeight: isCompact ? 38 : 46,
                    dataRowMaxHeight: isCompact ? 52 : 64,
                    columns: const [
                      DataColumn(label: Text('Title')),
                      DataColumn(label: Text('Status')),
                      DataColumn(label: Text('Start')),
                      DataColumn(label: Text('End')),
                    ],
                    rows: jobs
                        .map(
                          (j) => DataRow(cells: [
                            DataCell(Text(j.title)),
                            DataCell(Text(j.status.name)),
                            DataCell(Text(
                              j.scheduledStart != null ? DateFormat('yyyy-MM-dd').format(j.scheduledStart!) : '—',
                            )),
                            DataCell(Text(
                              j.scheduledEnd != null ? DateFormat('yyyy-MM-dd').format(j.scheduledEnd!) : '—',
                            )),
                          ]),
                        )
                        .toList(),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _sectionHeader(String title, {VoidCallback? onAdd}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Text(title, style: GoogleFonts.poppins(fontWeight: FontWeight.w700)),
          const Spacer(),
          if (onAdd != null)
            OutlinedButton.icon(
              onPressed: onAdd,
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Add'),
            ),
        ],
      ),
    );
  }

  Widget _metricCard(String label, String value, {bool compact = false}) {
    return SizedBox(
      width: compact ? 220 : 270,
      child: Card(
        child: Padding(
          padding: EdgeInsets.all(compact ? 10 : 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: GoogleFonts.poppins(fontSize: compact ? 11 : 12, color: const Color(0xFF6B7280)),
              ),
              const SizedBox(height: 4),
              Text(
                value,
                style: GoogleFonts.poppins(fontSize: compact ? 16 : 18, fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Dialog for creating or editing a unit on a property-type client.
class _ClientUnitDialog extends StatefulWidget {
  final Unit? existing;

  const _ClientUnitDialog({this.existing});

  @override
  State<_ClientUnitDialog> createState() => _ClientUnitDialogState();
}

class _ClientUnitDialogState extends State<_ClientUnitDialog> {
  late final TextEditingController _numberCtrl;
  late final TextEditingController _labelCtrl;
  late final TextEditingController _floorCtrl;
  late final TextEditingController _notesCtrl;
  late String _status;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _numberCtrl = TextEditingController(text: e?.unitNumber ?? '');
    _labelCtrl = TextEditingController(text: e?.label ?? '');
    _floorCtrl = TextEditingController(text: e?.floor ?? '');
    _notesCtrl = TextEditingController(text: e?.notes ?? '');
    _status = e?.occupancyStatus ?? 'occupied';
  }

  @override
  void dispose() {
    _numberCtrl.dispose();
    _labelCtrl.dispose();
    _floorCtrl.dispose();
    _notesCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.existing != null;
    return AlertDialog(
      title: Text(isEdit ? 'Edit unit' : 'New unit'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _numberCtrl,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Unit number *',
                  hintText: 'e.g. 12A',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _labelCtrl,
                decoration: const InputDecoration(labelText: 'Label / nickname'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _floorCtrl,
                decoration: const InputDecoration(labelText: 'Floor'),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _status,
                items: const [
                  DropdownMenuItem(value: 'occupied', child: Text('Occupied')),
                  DropdownMenuItem(value: 'vacant', child: Text('Vacant')),
                  DropdownMenuItem(value: 'reserved', child: Text('Reserved')),
                  DropdownMenuItem(value: 'off_market', child: Text('Off market')),
                ],
                onChanged: (v) {
                  if (v == null) return;
                  setState(() => _status = v);
                },
                decoration: const InputDecoration(labelText: 'Occupancy status'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _notesCtrl,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Notes'),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        FilledButton(
          onPressed: () {
            final num = _numberCtrl.text.trim();
            if (num.isEmpty) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Unit number is required.')),
              );
              return;
            }
            final unit = Unit(
              id: widget.existing?.id ?? '',
              siteId: widget.existing?.siteId ?? '',
              unitNumber: num,
              label: _labelCtrl.text.trim().isEmpty ? null : _labelCtrl.text.trim(),
              occupancyStatus: _status,
              floor: _floorCtrl.text.trim().isEmpty ? null : _floorCtrl.text.trim(),
              notes: _notesCtrl.text.trim().isEmpty ? null : _notesCtrl.text.trim(),
            );
            Navigator.of(context).pop(unit);
          },
          child: Text(isEdit ? 'Save' : 'Create'),
        ),
      ],
    );
  }
}

