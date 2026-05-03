import 'package:flutter/material.dart';
import 'package:excel/excel.dart' as ex;
import 'package:file_picker/file_picker.dart';
import 'package:file_saver/file_saver.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'dart:typed_data';

import '../theme/app_theme.dart';
import '../models/employee.dart';
import '../models/inventory_item.dart';
import '../models/inventory_allocation.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import '_dashboard_decorators.dart';

class HrInventorySection extends StatefulWidget {
  const HrInventorySection({super.key});

  @override
  State<HrInventorySection> createState() => _HrInventorySectionState();
}

class _HrInventorySectionState extends State<HrInventorySection> {
  String _excelCellToText(ex.Data? cell) => cell?.value?.toString().trim() ?? '';

  String _normHeader(String value) =>
      value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '');

  double _parseDoubleOrDefault(String raw, double fallback) =>
      double.tryParse(raw.trim().replaceAll(',', '.')) ?? fallback;

  String _toTitleCase(String value) {
    final cleaned = value.trim();
    if (cleaned.isEmpty) return '';
    return cleaned
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .map((w) => '${w[0].toUpperCase()}${w.substring(1).toLowerCase()}')
        .join(' ');
  }

  Map<String, String?> _autoDetectInventoryMapping(List<String> headers) {
    final byNorm = <String, String>{for (final h in headers) _normHeader(h): h};
    String? pick(List<String> aliases) {
      for (final a in aliases) {
        final found = byNorm[_normHeader(a)];
        if (found != null && found.isNotEmpty) return found;
      }
      return null;
    }
    return {
      'name': pick(const ['inventory name', 'name', 'item', 'item name', 'product']),
      'stock_count': pick(const ['stock', 'stock count', 'stock_count', 'quantity', 'qty', 'available']),
      'unit': pick(const ['unit', 'uom', 'measure']),
      'unit_cost': pick(const ['unit cost', 'cost', 'cost per unit', 'price', 'item cost']),
    };
  }

  Future<Map<String, String?>?> _showInventoryMappingDialog({
    required List<String> headers,
    required Map<String, String?> initial,
  }) {
    final mapping = Map<String, String?>.from(initial);
    return showDialog<Map<String, String?>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocalState) => AlertDialog(
          title: const Text('Map inventory columns'),
          content: SizedBox(
            width: 540,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final field in const ['name', 'stock_count', 'unit', 'unit_cost'])
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: DropdownButtonFormField<String>(
                      initialValue: mapping[field],
                      decoration: InputDecoration(
                        labelText: switch (field) {
                          'name' => 'Inventory Name *',
                          'stock_count' => 'Stock Count *',
                          'unit' => 'Unit (optional)',
                          _ => 'Cost per Unit (optional)',
                        },
                        isDense: true,
                      ),
                      items: [
                        const DropdownMenuItem<String>(value: null, child: Text('Not mapped')),
                        ...headers.map((h) => DropdownMenuItem<String>(value: h, child: Text(h))),
                      ],
                      onChanged: (v) => setLocalState(() => mapping[field] = v),
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(null), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () {
                if (mapping['name'] == null || mapping['stock_count'] == null) {
                  showInfoSnack(context, 'Map required fields: Inventory Name and Stock Count.');
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

  Future<void> _downloadInventoryImportTemplate() async {
    try {
      final excel = ex.Excel.createExcel();
      final sheet = excel['Sheet1'];
      sheet.appendRow([
        ex.TextCellValue('inventory_name'),
        ex.TextCellValue('stock_count'),
        ex.TextCellValue('unit'),
        ex.TextCellValue('unit_cost'),
      ]);
      sheet.appendRow([
        ex.TextCellValue('Safety Gloves'),
        ex.TextCellValue('120'),
        ex.TextCellValue('pairs'),
        ex.TextCellValue('25.00'),
      ]);
      final options = excel['Options'];
      options.appendRow([ex.TextCellValue('field'), ex.TextCellValue('allowed/expected values')]);
      options.appendRow([ex.TextCellValue('inventory_name'), ex.TextCellValue('Free text (required)')]);
      options.appendRow([ex.TextCellValue('stock_count'), ex.TextCellValue('Numeric value (required)')]);
      options.appendRow([ex.TextCellValue('unit'), ex.TextCellValue('Optional: pcs, pairs, liters, kg, boxes')]);
      options.appendRow([ex.TextCellValue('unit_cost'), ex.TextCellValue('Optional numeric currency value per unit')]);
      final bytes = excel.encode();
      if (bytes == null || bytes.isEmpty) throw StateError('Could not generate inventory template.');
      await FileSaver.instance.saveFile(
        name: 'inventory_import_template',
        bytes: Uint8List.fromList(bytes),
        fileExtension: 'xlsx',
        mimeType: MimeType.microsoftExcel,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Inventory template downloaded. Use Sheet1 for imports and Options for format guidance.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not download inventory template.'));
    }
  }

  Future<void> _importInventoryFromExcel() async {
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
      showInfoSnack(context, 'The file has no inventory rows to import.');
      return;
    }

    final rawHeaders = rows.first.map(_excelCellToText).toList();
    final headerIndex = <String, int>{for (var i = 0; i < rawHeaders.length; i++) rawHeaders[i]: i};
    final mapping = await _showInventoryMappingDialog(
      headers: rawHeaders,
      initial: _autoDetectInventoryMapping(rawHeaders),
    );
    if (mapping == null || !mounted) return;

    String cellByField(List<ex.Data?> row, String fieldKey) {
      final columnHeader = mapping[fieldKey];
      if (columnHeader == null) return '';
      final idx = headerIndex[columnHeader];
      if (idx == null || idx < 0 || idx >= row.length) return '';
      return _excelCellToText(row[idx]);
    }

    final existingItems = await SupabaseTimesheetStorage.getInventoryItems(companyId: companyId);
    final existingByLower = {
      for (final it in existingItems)
        if (it.name.trim().isNotEmpty) it.name.trim().toLowerCase(): it,
    };

    final drafts = <({int rowNo, InventoryItem item})>[];
    final errors = <String>[];
    for (var i = 1; i < rows.length; i++) {
      final row = rows[i];
      final rowNo = i + 1;
      final nameRaw = cellByField(row, 'name');
      final stockRaw = cellByField(row, 'stock_count');
      final unitRaw = cellByField(row, 'unit');
      final unitCostRaw = cellByField(row, 'unit_cost');
      final name = _toTitleCase(nameRaw);
      final stock = _parseDoubleOrDefault(stockRaw, double.nan);
      final unitCost = unitCostRaw.trim().isEmpty ? null : _parseDoubleOrDefault(unitCostRaw, double.nan);
      final rowErrors = <String>[];
      if (name.isEmpty) rowErrors.add('inventory name is required');
      if (stock.isNaN) rowErrors.add('stock_count must be numeric');
      if (unitCost != null && unitCost.isNaN) rowErrors.add('unit_cost must be numeric');
      if (rowErrors.isNotEmpty) {
        errors.add('Row $rowNo: ${rowErrors.join(', ')}');
        continue;
      }
      final existing = existingByLower[name.toLowerCase()];
      drafts.add((
        rowNo: rowNo,
        item: InventoryItem(
          id: existing?.id ?? '',
          name: name,
          stockCount: stock,
          unit: unitRaw.trim().isEmpty ? null : unitRaw.trim(),
          unitCost: unitCost,
        ),
      ));
    }

    if (!mounted) return;
    final proceed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Import inventory'),
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
        await SupabaseTimesheetStorage.upsertInventoryItem(d.item, companyId: companyId);
        done++;
      } catch (e) {
        failed.add('Row ${d.rowNo}: ${friendlyErrorMessage(e, fallback: 'Upsert failed')}');
      }
    }
    if (!mounted) return;
    setState(() {});
    if (failed.isEmpty) {
      showSuccessSnack(context, 'Imported/updated $done inventory item(s).');
    } else {
      showErrorSnack(context, 'Imported $done items with ${failed.length} failures.');
    }
  }

  Future<void> _showInventoryEditor({InventoryItem? item}) async {
    final nameCtrl = TextEditingController(text: item?.name ?? '');
    final stockCtrl = TextEditingController(text: item != null ? item.stockCount.toStringAsFixed(0) : '');
    final unitCtrl = TextEditingController(text: item?.unit ?? '');
    final unitCostCtrl = TextEditingController(text: item?.unitCost?.toStringAsFixed(2) ?? '');
    final sellCtrl = TextEditingController(text: item?.sellingPrice?.toStringAsFixed(2) ?? '');
    await showDialog<void>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(item == null ? 'Add inventory item' : 'Edit inventory item'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Inventory name')),
                const SizedBox(height: 10),
                TextField(
                  controller: stockCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'Stock count'),
                ),
                const SizedBox(height: 10),
                TextField(controller: unitCtrl, decoration: const InputDecoration(labelText: 'Unit (optional)')),
                const SizedBox(height: 10),
                TextField(
                  controller: unitCostCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Cost per unit (R)',
                    helperText: 'Used for inventory valuation and profitability reporting.',
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: sellCtrl,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'Selling price per unit (R, optional)',
                    helperText: 'Used when recording sales from stock.',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () async {
                final name = nameCtrl.text.trim();
                final stock = double.tryParse(stockCtrl.text.trim()) ?? 0.0;
                final unit = unitCtrl.text.trim().isEmpty ? null : unitCtrl.text.trim();
                final unitCost = unitCostCtrl.text.trim().isEmpty
                    ? null
                    : double.tryParse(unitCostCtrl.text.trim().replaceAll(',', '.'));
                final sellingPrice = sellCtrl.text.trim().isEmpty
                    ? null
                    : double.tryParse(sellCtrl.text.trim().replaceAll(',', '.'));
                if (name.isEmpty) return;
                if (unitCostCtrl.text.trim().isNotEmpty && unitCost == null) {
                  showInfoSnack(context, 'Cost per unit must be a valid number.');
                  return;
                }
                if (sellCtrl.text.trim().isNotEmpty && sellingPrice == null) {
                  showInfoSnack(context, 'Selling price must be a valid number.');
                  return;
                }
                await SupabaseTimesheetStorage.upsertInventoryItem(
                  InventoryItem(
                    id: item?.id ?? '',
                    name: name,
                    stockCount: stock,
                    unit: unit,
                    unitCost: unitCost,
                    sellingPrice: sellingPrice,
                  ),
                  companyId: context.read<TimesheetProvider>().currentCompanyId,
                );
                if (context.mounted) Navigator.pop(context);
              },
              style: ElevatedButton.styleFrom(backgroundColor: AppTheme.gold, foregroundColor: Colors.white),
              child: const Text('Save'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _showAddStockDialog(InventoryItem item) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final qtyCtrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Add stock · ${item.name}'),
        content: TextField(
          controller: qtyCtrl,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(
            labelText: 'Quantity to add',
            suffixText: item.unit,
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              final q = double.tryParse(qtyCtrl.text.trim().replaceAll(',', '.'));
              if (q == null || q <= 0) {
                showInfoSnack(context, 'Enter a positive quantity.');
                return;
              }
              try {
                await SupabaseTimesheetStorage.adjustInventoryStockCount(
                  inventoryItemId: item.id,
                  deltaStock: q,
                  companyId: companyId,
                );
                if (context.mounted) Navigator.pop(context);
                if (mounted) setState(() {});
                if (mounted) {
                  showSuccessSnack(context, 'Added ${q.toString()}${item.unit != null ? ' ${item.unit}' : ''} to stock.');
                }
              } catch (e) {
                if (context.mounted) {
                  showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not update stock.'));
                }
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  Future<void> _showSellStockDialog(InventoryItem item) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final qtyCtrl = TextEditingController();
    final priceCtrl = TextEditingController(
      text: item.sellingPrice != null ? item.sellingPrice!.toStringAsFixed(2) : '',
    );
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Record sale · ${item.name}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'On hand: ${item.stockCount.toStringAsFixed(item.stockCount % 1 == 0 ? 0 : 2)}${item.unit != null ? ' ${item.unit}' : ''}',
              style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF6B7280)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: qtyCtrl,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: 'Quantity sold',
                suffixText: item.unit,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: priceCtrl,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Price per unit (R)',
                helperText: 'Defaults from item selling price; override for this sale.',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              final q = double.tryParse(qtyCtrl.text.trim().replaceAll(',', '.'));
              if (q == null || q <= 0) {
                showInfoSnack(context, 'Enter quantity sold.');
                return;
              }
              if (q > item.stockCount) {
                showInfoSnack(context, 'Cannot sell more than available stock.');
                return;
              }
              final unitPrice = priceCtrl.text.trim().isEmpty
                  ? item.sellingPrice
                  : double.tryParse(priceCtrl.text.trim().replaceAll(',', '.'));
              if (priceCtrl.text.trim().isNotEmpty && unitPrice == null) {
                showInfoSnack(context, 'Price per unit must be a valid number.');
                return;
              }
              final revenue = (unitPrice ?? 0) * q;
              try {
                await SupabaseTimesheetStorage.adjustInventoryStockCount(
                  inventoryItemId: item.id,
                  deltaStock: -q,
                  companyId: companyId,
                );
                if (context.mounted) Navigator.pop(context);
                if (mounted) setState(() {});
                if (mounted) {
                  final revLabel = revenue > 0 ? ' · est. revenue R ${revenue.toStringAsFixed(2)}' : '';
                  showSuccessSnack(
                    context,
                    'Recorded sale of ${q.toString()}${item.unit != null ? ' ${item.unit}' : ''}$revLabel.',
                  );
                }
              } catch (e) {
                if (context.mounted) {
                  showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not update stock.'));
                }
              }
            },
            child: const Text('Record sale'),
          ),
        ],
      ),
    );
  }

  Future<void> _showAllocateDialog(InventoryItem item) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final workers = context.read<TimesheetProvider>().employees;
    if (workers.isEmpty) {
      if (mounted) {
        showInfoSnack(context, 'Add at least one employee or contractor first.');
      }
      return;
    }
    // Pre-load jobs so the optional Job selector has options.
    final jobs = await SupabaseTimesheetStorage.getJobs(companyId: companyId);
    if (!mounted) return;

    final qtyCtrl = TextEditingController();
    final notesCtrl = TextEditingController();
    String? selectedWorkerId = workers.first.id;
    String? selectedJobId; // null = not linked to a specific job

    await showDialog<void>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) {
          // Filter jobs to those assigned to the selected worker, or
          // show all if no worker chosen yet.
          final filteredJobs = selectedWorkerId == null
              ? jobs
              : jobs.where((j) =>
                      j.assignedEmployeeIds.contains(selectedWorkerId) ||
                      j.assigneeEmployeeId == selectedWorkerId ||
                      j.contractorEmployeeId == selectedWorkerId)
                  .toList();
          return AlertDialog(
            title: Text('Allocate ${item.name}'),
            content: SizedBox(
              width: 480,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Stock on hand: ${item.stockCount.toStringAsFixed(item.stockCount % 1 == 0 ? 0 : 2)}${item.unit != null ? ' ${item.unit}' : ''}',
                      style: GoogleFonts.poppins(
                        fontSize: 11,
                        color: const Color(0xFF6B7280),
                      ),
                    ),
                    const SizedBox(height: 14),
                    DropdownButtonFormField<String>(
                      initialValue: selectedWorkerId,
                      items: workers
                          .map((w) => DropdownMenuItem<String>(
                                value: w.id,
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      w.workerType == WorkerType.contractor ||
                                              w.workerType == WorkerType.subcontractor
                                          ? Icons.engineering_outlined
                                          : Icons.person_outline,
                                      size: 14,
                                      color: const Color(0xFF6B7280),
                                    ),
                                    const SizedBox(width: 6),
                                    Flexible(
                                      child: Text(w.fullName, overflow: TextOverflow.ellipsis),
                                    ),
                                  ],
                                ),
                              ))
                          .toList(),
                      onChanged: (v) {
                        setLocal(() {
                          selectedWorkerId = v;
                          selectedJobId = null;
                        });
                      },
                      decoration: const InputDecoration(labelText: 'Allocate to *'),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: qtyCtrl,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(
                        labelText: 'Quantity *',
                        suffixText: item.unit,
                      ),
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String?>(
                      initialValue: selectedJobId,
                      items: [
                        const DropdownMenuItem<String?>(
                          value: null,
                          child: Text('— Not linked to a specific job —'),
                        ),
                        ...filteredJobs.map((j) => DropdownMenuItem<String?>(
                              value: j.id,
                              child: Text(j.title, overflow: TextOverflow.ellipsis),
                            )),
                      ],
                      onChanged: (v) => setLocal(() => selectedJobId = v),
                      decoration: InputDecoration(
                        labelText: 'For job (optional)',
                        helperText: filteredJobs.isEmpty
                            ? 'No jobs assigned to this worker yet.'
                            : 'Restricts the allocation to this job for cost tracking.',
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: notesCtrl,
                      maxLines: 2,
                      decoration: const InputDecoration(labelText: 'Notes (optional)'),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () async {
                  final qty = double.tryParse(qtyCtrl.text.trim().replaceAll(',', '.'));
                  if (qty == null || qty <= 0) {
                    showInfoSnack(context, 'Enter a quantity greater than zero.');
                    return;
                  }
                  if (selectedWorkerId == null) {
                    showInfoSnack(context, 'Pick a worker.');
                    return;
                  }
                  try {
                    await SupabaseTimesheetStorage.insertInventoryAllocation(
                      companyId: companyId,
                      inventoryItemId: item.id,
                      workerEmployeeId: selectedWorkerId!,
                      quantity: qty,
                      jobId: selectedJobId,
                      unit: item.unit,
                      notes: notesCtrl.text.trim().isEmpty ? null : notesCtrl.text.trim(),
                    );
                    if (!context.mounted) return;
                    Navigator.of(context).pop();
                    showSuccessSnack(this.context, 'Allocated ${qty.toString()}${item.unit != null ? ' ${item.unit}' : ''} of ${item.name}.');
                  } catch (e) {
                    if (!context.mounted) return;
                    showErrorSnack(
                      context,
                      friendlyErrorMessage(e, fallback: 'Could not allocate.'),
                    );
                  }
                },
                child: const Text('Allocate'),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _confirmCancelAllocation(InventoryAllocation a) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Cancel allocation?'),
        content: Text(
          'Cancel the ${a.quantityAllocated.toStringAsFixed(a.quantityAllocated % 1 == 0 ? 0 : 2)} ${a.unit ?? ''} of ${a.itemName ?? 'item'} allocated to ${a.workerName ?? 'this worker'}? Recorded usage stays on file.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Keep')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Cancel allocation')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await SupabaseTimesheetStorage.setAllocationStatus(
        allocationId: a.id,
        status: 'cancelled',
      );
      if (mounted) setState(() {});
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, 'Could not cancel: ${friendlyErrorMessage(e, fallback: 'unknown')}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final isCompact = MediaQuery.of(context).size.width < 1180;

    return Stack(
      children: [
        FutureBuilder<List<InventoryItem>>(
          future: SupabaseTimesheetStorage.getInventoryItems(
            companyId: context.read<TimesheetProvider>().currentCompanyId,
          ),
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return LoadErrorPanel(
                message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load inventory.'),
                onRetry: () => setState(() {}),
              );
            }
            if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
              return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
            }
            final items = snapshot.data!..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
            final headers = [
              'Inventory name',
              'Stock available',
              'Unit',
              'Cost per unit',
              'Sell price',
              'Stock value',
            ];
            final rows = items
                .map((it) => [
                      it.name,
                      it.stockCount.toStringAsFixed(it.stockCount % 1 == 0 ? 0 : 2),
                      it.unit ?? '—',
                      it.unitCost != null ? it.unitCost!.toStringAsFixed(2) : '—',
                      it.sellingPrice != null ? it.sellingPrice!.toStringAsFixed(2) : '—',
                      it.unitCost != null ? (it.stockCount * it.unitCost!).toStringAsFixed(2) : '—',
                    ])
                .toList();

            return ListView(
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
                        'Inventory',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF111827),
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(width: 8),
                      buildExportButton(
                        context: context,
                        fileName: 'inventory_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
                        headers: headers,
                        rows: rows,
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton.icon(
                        onPressed: _downloadInventoryImportTemplate,
                        icon: const Icon(Icons.file_download_outlined, size: 16),
                        label: const Text('Template'),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton.icon(
                        onPressed: _importInventoryFromExcel,
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
                          '${items.length} items',
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ),
                if (items.isEmpty)
                  Padding(
                    padding: const EdgeInsets.all(24),
                    child: Center(
                      child: Text(
                        'No inventory items yet.\nTap + to add one.',
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
                          headingRowColor: WidgetStateProperty.all(const Color(0xFFF9FAFB)),
                          headingTextStyle: GoogleFonts.poppins(
                            color: const Color(0xFF111827),
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                          dataTextStyle: GoogleFonts.poppins(color: const Color(0xFF4B5563), fontSize: 12),
                          columnSpacing: isCompact ? 14 : 28,
                          headingRowHeight: isCompact ? 40 : 52,
                          dataRowMinHeight: isCompact ? 38 : 46,
                          dataRowMaxHeight: isCompact ? 52 : 64,
                          dividerThickness: 0.4,
                          columns: const [
                            DataColumn(label: Text('Inventory name')),
                            DataColumn(label: Text('Stock available')),
                            DataColumn(label: Text('Unit')),
                            DataColumn(label: Text('Cost / unit')),
                            DataColumn(label: Text('Sell / unit')),
                            DataColumn(label: Text('Stock value')),
                            DataColumn(label: Text('Actions')),
                          ],
                          rows: items.map((it) {
                            return DataRow(
                              cells: [
                                DataCell(Text(it.name)),
                                DataCell(Text(it.stockCount.toStringAsFixed(it.stockCount % 1 == 0 ? 0 : 2))),
                                DataCell(Text(it.unit ?? '—')),
                                DataCell(Text(it.unitCost != null ? 'R ${it.unitCost!.toStringAsFixed(2)}' : '—')),
                                DataCell(Text(it.sellingPrice != null ? 'R ${it.sellingPrice!.toStringAsFixed(2)}' : '—')),
                                DataCell(
                                  Text(
                                    it.unitCost != null
                                        ? 'R ${(it.stockCount * it.unitCost!).toStringAsFixed(2)}'
                                        : '—',
                                  ),
                                ),
                                DataCell(
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      TextButton(
                                        onPressed: () async {
                                          await _showAddStockDialog(it);
                                          if (mounted) setState(() {});
                                        },
                                        child: Text(
                                          '+Stock',
                                          style: GoogleFonts.poppins(
                                            color: const Color(0xFF059669),
                                            fontWeight: FontWeight.w600,
                                            fontSize: 11,
                                          ),
                                        ),
                                      ),
                                      TextButton(
                                        onPressed: () async {
                                          await _showSellStockDialog(it);
                                          if (mounted) setState(() {});
                                        },
                                        child: Text(
                                          'Sell',
                                          style: GoogleFonts.poppins(
                                            color: const Color(0xFFCA8A04),
                                            fontWeight: FontWeight.w600,
                                            fontSize: 11,
                                          ),
                                        ),
                                      ),
                                      TextButton.icon(
                                        onPressed: () async {
                                          await _showAllocateDialog(it);
                                          if (mounted) setState(() {});
                                        },
                                        icon: const Icon(Icons.outbox_outlined, size: 14),
                                        label: const Text('Allocate'),
                                        style: TextButton.styleFrom(
                                          foregroundColor: const Color(0xFF7C3AED),
                                          textStyle: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                                        ),
                                      ),
                                      const SizedBox(width: 4),
                                      TextButton(
                                        onPressed: () async {
                                          await _showInventoryEditor(item: it);
                                          if (mounted) setState(() {});
                                        },
                                        child: Text('Edit', style: GoogleFonts.poppins(color: AppTheme.gold, fontWeight: FontWeight.w600)),
                                      ),
                                      const SizedBox(width: 4),
                                      TextButton(
                                        onPressed: () async {
                                          await SupabaseTimesheetStorage.deleteInventoryItem(
                                            it.id,
                                            companyId: context.read<TimesheetProvider>().currentCompanyId,
                                          );
                                          if (mounted) setState(() {});
                                        },
                                        child: Text('Delete', style: GoogleFonts.poppins(color: const Color(0xFFDC2626), fontWeight: FontWeight.w600)),
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
                const SizedBox(height: 24),
                _AllocationsCard(
                  isCompact: isCompact,
                  onCancelAllocation: _confirmCancelAllocation,
                ),
              ],
            );
          },
        ),
        Positioned(
          right: 16,
          bottom: 16,
          child: FloatingActionButton(
            onPressed: () async {
              await _showInventoryEditor();
              if (mounted) setState(() {});
            },
            backgroundColor: AppTheme.gold,
            foregroundColor: Colors.white,
            child: const Icon(Icons.add),
          ),
        ),
      ],
    );
  }
}

/// Inline card showing every active inventory allocation across the
/// company. Powered by the `v_inventory_allocations` view, which
/// computes used/extra/remaining quantities. HR can cancel an active
/// allocation from here; closure happens automatically once the
/// allocation is fully consumed by job-card usage.
class _AllocationsCard extends StatelessWidget {
  final bool isCompact;
  final Future<void> Function(InventoryAllocation a) onCancelAllocation;

  const _AllocationsCard({
    required this.isCompact,
    required this.onCancelAllocation,
  });

  @override
  Widget build(BuildContext context) {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return const SizedBox.shrink();
    return FutureBuilder<List<InventoryAllocation>>(
      future: SupabaseTimesheetStorage.getAllocationsForCompany(companyId: companyId),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const SizedBox(
            height: 40,
            child: Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.gold)),
          );
        }
        if (snapshot.hasError) {
          return Padding(
            padding: const EdgeInsets.all(8),
            child: Text(
              'Allocations failed to load: ${friendlyErrorMessage(snapshot.error, fallback: 'unknown')}',
              style: GoogleFonts.poppins(color: const Color(0xFFB91C1C), fontSize: 12),
            ),
          );
        }
        final allocations = snapshot.data ?? const <InventoryAllocation>[];
        return Card(
          color: Colors.white,
          elevation: 4,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: const BorderSide(color: Color(0xFFE5E7EB)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      'Allocations',
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF111827),
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEFF4FF),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '${allocations.where((a) => a.isActive).length} active',
                        style: GoogleFonts.poppins(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF2563EB),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'Tap "Allocate" on any inventory row to issue stock to a worker for a job. Used and remaining quantities update as workers fill in their job cards.',
                  style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                ),
                const SizedBox(height: 10),
                if (allocations.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Center(
                      child: Text(
                        'No allocations yet.',
                        style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                      ),
                    ),
                  )
                else
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(
                      headingRowColor: WidgetStateProperty.all(const Color(0xFFF9FAFB)),
                      headingTextStyle: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 12, fontWeight: FontWeight.w600),
                      dataTextStyle: GoogleFonts.poppins(color: const Color(0xFF4B5563), fontSize: 12),
                      columnSpacing: isCompact ? 14 : 24,
                      headingRowHeight: isCompact ? 40 : 48,
                      dataRowMinHeight: isCompact ? 38 : 46,
                      dataRowMaxHeight: isCompact ? 56 : 64,
                      columns: const [
                        DataColumn(label: Text('Item')),
                        DataColumn(label: Text('Worker')),
                        DataColumn(label: Text('Job')),
                        DataColumn(label: Text('Allocated')),
                        DataColumn(label: Text('Used')),
                        DataColumn(label: Text('Remaining')),
                        DataColumn(label: Text('Status')),
                        DataColumn(label: Text('')),
                      ],
                      rows: allocations.map((a) {
                        final fmt = (double n) => n.toStringAsFixed(n % 1 == 0 ? 0 : 2);
                        final unitSuffix = a.unit != null && a.unit!.isNotEmpty ? ' ${a.unit}' : '';
                        final isContractor = a.workerType == 'contractor' || a.workerType == 'subcontractor';
                        final statusColor = switch (a.status) {
                          'active' => const Color(0xFF059669),
                          'closed' => const Color(0xFF6B7280),
                          'cancelled' => const Color(0xFFDC2626),
                          _ => const Color(0xFF6B7280),
                        };
                        return DataRow(
                          cells: [
                            DataCell(Text(a.itemName ?? '—')),
                            DataCell(
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    isContractor ? Icons.engineering_outlined : Icons.person_outline,
                                    size: 12,
                                    color: const Color(0xFF6B7280),
                                  ),
                                  const SizedBox(width: 4),
                                  Flexible(child: Text(a.workerName ?? '—', overflow: TextOverflow.ellipsis)),
                                ],
                              ),
                            ),
                            DataCell(Text(a.jobTitle ?? '— general —', overflow: TextOverflow.ellipsis)),
                            DataCell(Text('${fmt(a.quantityAllocated)}$unitSuffix')),
                            DataCell(
                              Text(
                                a.isOverConsumed
                                    ? '${fmt(a.quantityUsed)} (+${fmt(a.quantityExtra)})$unitSuffix'
                                    : '${fmt(a.quantityUsed)}$unitSuffix',
                                style: a.isOverConsumed
                                    ? GoogleFonts.poppins(color: const Color(0xFFB91C1C), fontWeight: FontWeight.w600, fontSize: 12)
                                    : null,
                              ),
                            ),
                            DataCell(Text('${fmt(a.quantityRemaining)}$unitSuffix')),
                            DataCell(
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: statusColor.withValues(alpha: 0.10 * 255),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  a.status,
                                  style: GoogleFonts.poppins(
                                    color: statusColor,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ),
                            DataCell(
                              a.isActive
                                  ? IconButton(
                                      tooltip: 'Cancel allocation',
                                      icon: const Icon(Icons.cancel_outlined, size: 18, color: Color(0xFFDC2626)),
                                      onPressed: () => onCancelAllocation(a),
                                    )
                                  : const SizedBox.shrink(),
                            ),
                          ],
                        );
                      }).toList(),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}
