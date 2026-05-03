import 'package:flutter/material.dart';
import 'package:excel/excel.dart' as ex;
import 'package:file_picker/file_picker.dart';
import 'package:file_saver/file_saver.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'dart:typed_data';

import '../theme/app_theme.dart';
import '../models/client.dart';
import '../models/job.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import '_dashboard_decorators.dart';
import 'client_detail_screen.dart';

class HrClientsSection extends StatefulWidget {
  const HrClientsSection({super.key});

  @override
  State<HrClientsSection> createState() => _HrClientsSectionState();
}

class _HrClientsSectionState extends State<HrClientsSection> {
  String _clientTypeFilter = 'all';
  String _excelCellToText(ex.Data? cell) => cell?.value?.toString().trim() ?? '';

  String _normHeader(String value) =>
      value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '');

  String _toTitleCase(String value) {
    final cleaned = value.trim();
    if (cleaned.isEmpty) return '';
    return cleaned
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .map((w) => '${w[0].toUpperCase()}${w.substring(1).toLowerCase()}')
        .join(' ');
  }

  Map<String, String?> _autoDetectClientMapping(List<String> headers) {
    final byNorm = <String, String>{for (final h in headers) _normHeader(h): h};
    String? pick(List<String> aliases) {
      for (final a in aliases) {
        final found = byNorm[_normHeader(a)];
        if (found != null && found.isNotEmpty) return found;
      }
      return null;
    }
    return {
      'name': pick(const ['client name', 'name', 'customer', 'customer name']),
      'client_type': pick(const ['client type', 'type', 'customer type']),
      'address': pick(const ['address', 'client address', 'location']),
      'contact_person': pick(const ['contact person', 'contact', 'contact name']),
      'phone': pick(const ['phone', 'mobile', 'telephone', 'cell']),
      'email': pick(const ['email', 'mail']),
      'notes': pick(const ['notes', 'comment', 'comments']),
    };
  }

  Future<Map<String, String?>?> _showClientMappingDialog({
    required List<String> headers,
    required Map<String, String?> initial,
  }) {
    final mapping = Map<String, String?>.from(initial);
    const fields = ['name', 'client_type', 'address', 'contact_person', 'phone', 'email', 'notes'];
    return showDialog<Map<String, String?>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocalState) => AlertDialog(
          title: const Text('Map client columns'),
          content: SizedBox(
            width: 560,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: fields
                    .map(
                      (f) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: DropdownButtonFormField<String>(
                          initialValue: mapping[f],
                          decoration: InputDecoration(
                            labelText: '${_toTitleCase(f.replaceAll('_', ' '))}${f == 'name' ? ' *' : ''}',
                            isDense: true,
                          ),
                          items: [
                            const DropdownMenuItem<String>(value: null, child: Text('Not mapped')),
                            ...headers.map((h) => DropdownMenuItem<String>(value: h, child: Text(h))),
                          ],
                          onChanged: (v) => setLocalState(() => mapping[f] = v),
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(null), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () {
                if (mapping['name'] == null) {
                  showInfoSnack(context, 'Map required field: Client Name.');
                  return;
                }
                Navigator.of(context).pop(mapping);
              },
              child: const Text('Continue'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _downloadClientImportTemplate() async {
    try {
      final excel = ex.Excel.createExcel();
      final sheet = excel['Sheet1'];
      sheet.appendRow([
        ex.TextCellValue('client_name'),
        ex.TextCellValue('client_type'),
        ex.TextCellValue('address'),
        ex.TextCellValue('contact_person'),
        ex.TextCellValue('phone'),
        ex.TextCellValue('email'),
        ex.TextCellValue('notes'),
      ]);
      sheet.appendRow([
        ex.TextCellValue('ABC Properties'),
        ex.TextCellValue('property'),
        ex.TextCellValue('123 Main Rd, Pretoria'),
        ex.TextCellValue('Jane Smith'),
        ex.TextCellValue('0712345678'),
        ex.TextCellValue('jane@abcproperties.co.za'),
        ex.TextCellValue('Preferred daytime scheduling'),
      ]);
      final options = excel['Options'];
      options.appendRow([ex.TextCellValue('client_type allowed values')]);
      options.appendRow([ex.TextCellValue('company')]);
      options.appendRow([ex.TextCellValue('individual')]);
      options.appendRow([ex.TextCellValue('property')]);
      final bytes = excel.encode();
      if (bytes == null || bytes.isEmpty) throw StateError('Could not generate client template.');
      await FileSaver.instance.saveFile(
        name: 'client_import_template',
        bytes: Uint8List.fromList(bytes),
        fileExtension: 'xlsx',
        mimeType: MimeType.microsoftExcel,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Client template downloaded. Use Sheet1 for imports and Options for allowed type values.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not download client template.'));
    }
  }

  Future<void> _importClientsFromExcel() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) {
      showErrorSnack(context, 'No company selected.');
      return;
    }
    FilePickerResult? picked;
    try {
      picked = await FilePicker.platform.pickFiles(
        withData: true,
        type: FileType.custom,
        allowedExtensions: const ['xlsx'],
      );
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not open file picker.'));
      return;
    }
    if (!mounted || picked == null || picked.files.isEmpty) return;
    final bytes = picked.files.first.bytes;
    if (bytes == null || bytes.isEmpty) {
      showErrorSnack(context, 'Could not read file data. Please pick a local .xlsx file.');
      return;
    }
    ex.Excel excel;
    try {
      excel = ex.Excel.decodeBytes(bytes);
    } catch (_) {
      showErrorSnack(context, 'Invalid .xlsx format.');
      return;
    }
    if (excel.tables.isEmpty) {
      showErrorSnack(context, 'The selected .xlsx file has no sheets.');
      return;
    }
    final rows = excel.tables.values.first.rows;
    if (rows.length < 2) {
      showInfoSnack(context, 'The file has no client rows to import.');
      return;
    }

    final rawHeaders = rows.first.map(_excelCellToText).toList();
    final headerIndex = <String, int>{for (var i = 0; i < rawHeaders.length; i++) rawHeaders[i]: i};
    final mapping = await _showClientMappingDialog(
      headers: rawHeaders,
      initial: _autoDetectClientMapping(rawHeaders),
    );
    if (mapping == null || !mounted) return;

    String cellByField(List<ex.Data?> row, String fieldKey) {
      final columnHeader = mapping[fieldKey];
      if (columnHeader == null) return '';
      final idx = headerIndex[columnHeader];
      if (idx == null || idx < 0 || idx >= row.length) return '';
      return _excelCellToText(row[idx]);
    }

    final existing = await SupabaseTimesheetStorage.getClients(companyId: companyId);
    final existingByLower = {
      for (final c in existing)
        if (c.name.trim().isNotEmpty) c.name.trim().toLowerCase(): c,
    };
    final drafts = <({int rowNo, Client client})>[];
    final errors = <String>[];
    for (var i = 1; i < rows.length; i++) {
      final row = rows[i];
      final rowNo = i + 1;
      final name = _toTitleCase(cellByField(row, 'name'));
      if (name.isEmpty) {
        errors.add('Row $rowNo: client name is required');
        continue;
      }
      final typeRaw = cellByField(row, 'client_type').trim().toLowerCase();
      final type = switch (typeRaw) {
        'individual' || 'person' => ClientType.individual,
        'property' || 'estate' || 'building' => ClientType.property,
        _ => ClientType.company,
      };
      final existingClient = existingByLower[name.toLowerCase()];
      drafts.add((
        rowNo: rowNo,
        client: Client(
          id: existingClient?.id ?? '',
          name: name,
          clientType: type,
          address: cellByField(row, 'address').trim().isEmpty ? null : cellByField(row, 'address').trim(),
          contactPerson: cellByField(row, 'contact_person').trim().isEmpty
              ? null
              : _toTitleCase(cellByField(row, 'contact_person')),
          phone: cellByField(row, 'phone').trim().isEmpty ? null : cellByField(row, 'phone').trim(),
          email: cellByField(row, 'email').trim().isEmpty ? null : cellByField(row, 'email').trim(),
          notes: cellByField(row, 'notes').trim().isEmpty ? null : cellByField(row, 'notes').trim(),
        ),
      ));
    }

    if (!mounted) return;
    final proceed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Import clients'),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Ready to import/update: ${drafts.length}'),
                if (errors.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text('Skipped rows: ${errors.length}',
                      style: GoogleFonts.poppins(color: Colors.red.shade700, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  ...errors.take(12).map((e) => Text('• $e', style: GoogleFonts.poppins(fontSize: 12))),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: drafts.isEmpty ? null : () => Navigator.of(context).pop(true),
            child: const Text('Import'),
          ),
        ],
      ),
    );
    if (proceed != true || !mounted) return;

    var done = 0;
    final failed = <String>[];
    for (final d in drafts) {
      try {
        await SupabaseTimesheetStorage.upsertClient(d.client, companyId: companyId);
        done++;
      } catch (e) {
        failed.add('Row ${d.rowNo}: ${friendlyErrorMessage(e, fallback: 'Upsert failed')}');
      }
    }
    if (!mounted) return;
    setState(() {});
    if (failed.isEmpty) {
      showSuccessSnack(context, 'Imported/updated $done client(s).');
    } else {
      showErrorSnack(context, 'Imported $done clients with ${failed.length} failures.');
    }
  }

  Future<void> _showClientEditor({Client? client}) async {
    final nameCtrl = TextEditingController(text: client?.name ?? '');
    final addressCtrl = TextEditingController(text: client?.address ?? '');
    final contactCtrl = TextEditingController(text: client?.contactPerson ?? '');
    final phoneCtrl = TextEditingController(text: client?.phone ?? '');
    final emailCtrl = TextEditingController(text: client?.email ?? '');
    final notesCtrl = TextEditingController(text: client?.notes ?? '');
    ClientType selectedType = client?.clientType ?? ClientType.company;
    await showDialog<void>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocalState) => AlertDialog(
          title: Text(client == null ? 'Add client' : 'Edit client'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Client type — drives whether units cascade onto jobs.
                  SegmentedButton<ClientType>(
                    segments: const [
                      ButtonSegment(
                        value: ClientType.individual,
                        label: Text('Individual'),
                        icon: Icon(Icons.person_outline, size: 16),
                      ),
                      ButtonSegment(
                        value: ClientType.company,
                        label: Text('Company'),
                        icon: Icon(Icons.business_outlined, size: 16),
                      ),
                      ButtonSegment(
                        value: ClientType.property,
                        label: Text('Property'),
                        icon: Icon(Icons.apartment_outlined, size: 16),
                      ),
                    ],
                    selected: {selectedType},
                    onSelectionChanged: (s) {
                      if (s.isEmpty) return;
                      setLocalState(() => selectedType = s.first);
                    },
                  ),
                  const SizedBox(height: 6),
                  Text(
                    selectedType == ClientType.property
                        ? 'A specific building or estate. Add unit numbers in the client detail screen — they will cascade onto jobs.'
                        : selectedType == ClientType.company
                            ? 'A business or organisation. Can have multiple sites.'
                            : 'A single person — no units underneath.',
                    style: const TextStyle(fontSize: 11, color: Color(0xFF6B7280)),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: nameCtrl,
                    decoration: InputDecoration(
                      labelText: selectedType == ClientType.property
                          ? 'Estate / building name'
                          : selectedType == ClientType.individual
                              ? 'Full name'
                              : 'Company name',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(controller: addressCtrl, decoration: const InputDecoration(labelText: 'Address')),
                  const SizedBox(height: 10),
                  TextField(
                    controller: contactCtrl,
                    decoration: InputDecoration(
                      labelText: selectedType == ClientType.individual
                          ? 'Alternative contact person (optional)'
                          : 'Contact person',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: phoneCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Phone',
                      helperText: 'Used for client feedback after job close.',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: emailCtrl,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Email'),
                  ),
                  const SizedBox(height: 10),
                  TextField(controller: notesCtrl, decoration: const InputDecoration(labelText: 'Notes'), maxLines: 2),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () async {
                final name = nameCtrl.text.trim();
                if (name.isEmpty) {
                  showInfoSnack(context, 'Client name is required.');
                  return;
                }
                final companyId = context.read<TimesheetProvider>().currentCompanyId;
                await SupabaseTimesheetStorage.upsertClient(
                  Client(
                    id: client?.id ?? '',
                    name: name,
                    address: addressCtrl.text.trim().isEmpty ? null : addressCtrl.text.trim(),
                    contactPerson: contactCtrl.text.trim().isEmpty ? null : contactCtrl.text.trim(),
                    phone: phoneCtrl.text.trim().isEmpty ? null : phoneCtrl.text.trim(),
                    email: emailCtrl.text.trim().isEmpty ? null : emailCtrl.text.trim(),
                    notes: notesCtrl.text.trim().isEmpty ? null : notesCtrl.text.trim(),
                    clientType: selectedType,
                  ),
                  companyId: companyId,
                );
                if (context.mounted) Navigator.of(context).pop();
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    final isCompact = MediaQuery.of(context).size.width < 1180;

    if (companyId == null) {
      return Center(
        child: Text('No company selected.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280))),
      );
    }

    return FutureBuilder<List<dynamic>>(
      future: Future.wait([
        SupabaseTimesheetStorage.getClients(companyId: companyId),
        SupabaseTimesheetStorage.getJobs(companyId: companyId),
      ]),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load clients.'),
            onRetry: () => setState(() {}),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
        }
        final allClients = (snapshot.data![0] as List<Client>)
          ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
        final clients = allClients.where((c) {
          if (_clientTypeFilter == 'all') return true;
          return c.clientType.wireValue == _clientTypeFilter;
        }).toList();
        final jobs = snapshot.data![1] as List<Job>;
        final jobsByClient = <String, int>{};
        for (final j in jobs) {
          jobsByClient[j.clientId] = (jobsByClient[j.clientId] ?? 0) + 1;
        }
        final headers = ['Name', 'Address', 'Contact', 'Phone', 'Jobs'];
        final rows = clients
            .map((c) => [
                  c.name,
                  c.address ?? '—',
                  c.contactPerson ?? '—',
                  c.phone ?? '—',
                  (jobsByClient[c.id] ?? 0).toString(),
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
                        'Clients',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF111827),
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: 8),
                      buildExportButton(
                        context: context,
                        fileName: 'clients_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
                        headers: headers,
                        rows: rows,
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton.icon(
                        onPressed: _downloadClientImportTemplate,
                        icon: const Icon(Icons.file_download_outlined, size: 16),
                        label: const Text('Template'),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton.icon(
                        onPressed: _importClientsFromExcel,
                        icon: const Icon(Icons.upload_file, size: 16),
                        label: const Text('Import Excel'),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(24),
                          border: Border.all(color: const Color(0xFFE5E7EB)),
                        ),
                        child: Text(
                          '${clients.length} clients',
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(left: 4, right: 4, bottom: 12),
                  child: SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'all',
                        label: Text('All'),
                        icon: Icon(Icons.grid_view_outlined, size: 16),
                      ),
                      ButtonSegment(
                        value: 'property',
                        label: Text('Property'),
                        icon: Icon(Icons.apartment_outlined, size: 16),
                      ),
                      ButtonSegment(
                        value: 'company',
                        label: Text('Company'),
                        icon: Icon(Icons.business_outlined, size: 16),
                      ),
                      ButtonSegment(
                        value: 'individual',
                        label: Text('Individual'),
                        icon: Icon(Icons.person_outline, size: 16),
                      ),
                    ],
                    selected: {_clientTypeFilter},
                    onSelectionChanged: (s) {
                      if (s.isEmpty) return;
                      setState(() => _clientTypeFilter = s.first);
                    },
                  ),
                ),
                if (clients.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Center(
                      child: Text(
                        'No clients yet.\nTap + to add one.',
                        style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                        textAlign: TextAlign.center,
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
                          columnSpacing: isCompact ? 14 : 24,
                          headingRowHeight: isCompact ? 40 : 52,
                          dataRowMinHeight: isCompact ? 38 : 46,
                          dataRowMaxHeight: isCompact ? 52 : 64,
                          columns: const [
                            DataColumn(label: Text('Name')),
                            DataColumn(label: Text('Type')),
                            DataColumn(label: Text('Address')),
                            DataColumn(label: Text('Contact')),
                            DataColumn(label: Text('Phone')),
                            DataColumn(label: Text('Jobs')),
                            DataColumn(label: Text('Actions')),
                          ],
                          rows: clients.map((c) {
                            return DataRow(
                              cells: [
                                DataCell(Text(c.name)),
                                DataCell(_ClientTypeChip(type: c.clientType)),
                                DataCell(Text(c.address?.trim().isNotEmpty == true ? c.address! : '—')),
                                DataCell(Text(c.contactPerson?.trim().isNotEmpty == true ? c.contactPerson! : '—')),
                                DataCell(Text(c.phone?.trim().isNotEmpty == true ? c.phone! : '—')),
                                DataCell(Text((jobsByClient[c.id] ?? 0).toString())),
                                DataCell(
                                  Row(
                                    children: [
                                      TextButton(
                                        onPressed: () async {
                                          await Navigator.of(context).push(
                                            MaterialPageRoute(
                                              builder: (_) => ClientDetailScreen(companyId: companyId, client: c),
                                            ),
                                          );
                                          if (mounted) setState(() {});
                                        },
                                        child: const Text('Open'),
                                      ),
                                      TextButton(
                                        onPressed: () async {
                                          await _showClientEditor(client: c);
                                          if (mounted) setState(() {});
                                        },
                                        child: const Text('Edit'),
                                      ),
                                      TextButton(
                                        onPressed: () async {
                                          await SupabaseTimesheetStorage.deleteClient(c.id, companyId: companyId);
                                          if (mounted) setState(() {});
                                        },
                                        child: const Text('Delete'),
                                      ),
                                    ],
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
                onPressed: () async {
                  await _showClientEditor();
                  if (mounted) setState(() {});
                },
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

/// Small color-coded badge showing the client's type. Used in the
/// clients DataTable so HR can see at a glance whether a row is an
/// individual, a company, or a property/estate.
class _ClientTypeChip extends StatelessWidget {
  final ClientType type;

  const _ClientTypeChip({required this.type});

  @override
  Widget build(BuildContext context) {
    final (Color color, IconData icon) = switch (type) {
      ClientType.individual => (const Color(0xFF6B7280), Icons.person_outline),
      ClientType.company => (const Color(0xFF2563EB), Icons.business_outlined),
      ClientType.property => (const Color(0xFF059669), Icons.apartment_outlined),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(
            type.label,
            style: GoogleFonts.poppins(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
