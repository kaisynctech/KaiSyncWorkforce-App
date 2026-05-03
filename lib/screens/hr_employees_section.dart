import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:excel/excel.dart' as ex;
import 'package:file_picker/file_picker.dart';
import 'package:file_saver/file_saver.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'dart:typed_data';

import '../theme/app_theme.dart';
import '../models/employee.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/load_error_panel.dart';
import '../widgets/app_feedback.dart';
import 'hr_create_employee_screen.dart';
import 'hr_employee_dashboard_screen.dart';
import 'hr_work_teams_screen.dart';
import '_dashboard_decorators.dart';

class HrEmployeesSection extends StatefulWidget {
  final bool canViewSensitiveData;
  final String? companyCode;

  const HrEmployeesSection({
    super.key,
    required this.canViewSensitiveData,
    this.companyCode,
  });

  @override
  State<HrEmployeesSection> createState() => _HrEmployeesSectionState();
}

class _HrEmployeesSectionState extends State<HrEmployeesSection> {
  String _employeeFilter = 'all';
  String _branchFilter = 'all';
  String _employeeSearchQuery = '';
  List<String> _managedBranches = const [];
  List<String> _managedEmployeeTypes = const [];
  Map<String, ({DateTime? generatedAt, DateTime? expiresAt})> _tempCodeStatusByEmployee = const {};

  Future<void> _generateAndCopyTempCode(Employee employee) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final generated = await SupabaseTimesheetStorage.generateEmployeeTempLoginCode(
      companyId: companyId,
      employeeId: employee.id,
    );
    if (generated == null) {
      if (!mounted) return;
      showErrorSnack(context, 'Could not generate temporary login code.');
      return;
    }
    final companyCode = (widget.companyCode?.trim().isNotEmpty == true)
        ? widget.companyCode!.trim()
        : await SupabaseTimesheetStorage.getCompanyCodeById(companyId);
    final message = [
      'KaiFlow login details',
      'Company code: ${companyCode?.isNotEmpty == true ? companyCode : 'Ask HR'}',
      'Temporary login code: ${generated.code}',
      'Expires: ${DateFormat('dd MMM y, HH:mm').format(generated.expiresAt)}',
      'Open the app, choose Login code, and enter these details.',
    ].join('\n');
    await Clipboard.setData(ClipboardData(text: message));
    await _loadMetadata();
    if (!mounted) return;
    showSuccessSnack(context, 'Temporary login code generated and copied. Share it via WhatsApp/SMS.');
  }


  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadMetadata());
  }

  Future<void> _loadMetadata() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final branches = await SupabaseTimesheetStorage.getCompanyBranches(companyId: companyId);
    final types = await SupabaseTimesheetStorage.getCompanyEmployeeTypes(companyId: companyId);
    final tempStatus = await SupabaseTimesheetStorage.getEmployeeTempLoginStatusByEmployee(companyId: companyId);
    if (!mounted) return;
    setState(() {
      _managedBranches = branches;
      _managedEmployeeTypes = types;
      _tempCodeStatusByEmployee = tempStatus;
    });
  }

  EmployeeAccessLevel _parseAccessLevel(String raw) {
    final value = raw.trim().toLowerCase().replaceAll(RegExp(r'\s+'), '_');
    if (value == 'manager') return EmployeeAccessLevel.manager;
    if (value == 'hr_admin') return EmployeeAccessLevel.hrAdmin;
    return EmployeeAccessLevel.employee;
  }

  EmploymentType _parseEmploymentType(String raw) {
    final value = raw.trim().toLowerCase();
    if (value.contains('contract')) return EmploymentType.contract;
    if (value.contains('permanent')) return EmploymentType.permanent;
    if (value.contains('student')) return EmploymentType.student;
    return EmploymentType.partTime;
  }

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

  String _excelCellToText(ex.Data? cell) => cell?.value?.toString().trim() ?? '';

  String _normHeader(String value) => value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '');

  Map<String, String?> _autoDetectImportMapping(List<String> headers) {
    final byNorm = <String, String>{for (final h in headers) _normHeader(h): h};
    String? pick(List<String> aliases) {
      for (final a in aliases) {
        final found = byNorm[_normHeader(a)];
        if (found != null && found.isNotEmpty) return found;
      }
      return null;
    }
    return {
      'name': pick(const ['name', 'first name', 'firstname', 'given name']),
      'surname': pick(const ['surname', 'last name', 'lastname', 'family name']),
      'id_number': pick(const ['id number', 'id_number', 'id', 'id no', 'identity number']),
      'position': pick(const ['position', 'job title', 'role', 'job']),
      'branch': pick(const ['branch', 'site', 'location']),
      'employee_type': pick(const ['employee type', 'employment type', 'type']),
      'access_level': pick(const ['access level', 'access', 'permission', 'level']),
      'monthly_salary': pick(const ['monthly salary', 'salary', 'monthly']),
      'work_days_weekly': pick(const ['work days weekly', 'workdays', 'days per week']),
      'daily_hours': pick(const ['daily hours', 'hours per day']),
      'employment_date': pick(const ['employment date', 'start date', 'date started']),
    };
  }

  Future<Map<String, String?>?> _showImportMappingDialog({
    required List<String> headers,
    required Map<String, String?> initial,
  }) {
    final mapping = Map<String, String?>.from(initial);
    String pretty(String key) => switch (key) {
          'id_number' => 'ID Number',
          'employee_type' => 'Employee Type',
          'access_level' => 'Access Level',
          'monthly_salary' => 'Monthly Salary',
          'work_days_weekly' => 'Work Days Weekly',
          'daily_hours' => 'Daily Hours',
          'employment_date' => 'Employment Date',
          _ => _toTitleCase(key.replaceAll('_', ' ')),
        };
    const fields = [
      'name', 'surname', 'id_number', 'access_level', 'position',
      'branch', 'employee_type', 'monthly_salary', 'work_days_weekly',
      'daily_hours', 'employment_date',
    ];
    return showDialog<Map<String, String?>>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocalState) => AlertDialog(
          title: const Text('Map columns'),
          content: SizedBox(
            width: 560,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: fields
                    .map((f) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: DropdownButtonFormField<String>(
                            initialValue: mapping[f],
                            decoration: InputDecoration(
                              labelText:
                                  '${pretty(f)}${const {'name', 'surname', 'id_number', 'access_level'}.contains(f) ? ' *' : ''}',
                              isDense: true,
                            ),
                            items: [
                              const DropdownMenuItem<String>(value: null, child: Text('Not mapped')),
                              ...headers.map((h) => DropdownMenuItem<String>(value: h, child: Text(h))),
                            ],
                            onChanged: (v) => setLocalState(() => mapping[f] = v),
                          ),
                        ))
                    .toList(),
              ),
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(null), child: const Text('Cancel')),
            ElevatedButton(
              onPressed: () {
                if (mapping['name'] == null ||
                    mapping['surname'] == null ||
                    mapping['id_number'] == null ||
                    mapping['access_level'] == null) {
                  showInfoSnack(context, 'Map required fields: Name, Surname, ID Number, Access Level.');
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

  Future<void> _downloadEmployeeImportTemplate() async {
    try {
      final excel = ex.Excel.createExcel();
      final sheet = excel['Sheet1'];
      sheet.appendRow([
        ex.TextCellValue('name'), ex.TextCellValue('surname'), ex.TextCellValue('id_number'),
        ex.TextCellValue('position'), ex.TextCellValue('branch'), ex.TextCellValue('employee_type'),
        ex.TextCellValue('access_level'), ex.TextCellValue('monthly_salary'),
        ex.TextCellValue('work_days_weekly'), ex.TextCellValue('daily_hours'), ex.TextCellValue('employment_date'),
      ]);
      sheet.appendRow([
        ex.TextCellValue('John'), ex.TextCellValue('Doe'), ex.TextCellValue('9001011234088'),
        ex.TextCellValue('Technician'), ex.TextCellValue('Johannesburg'), ex.TextCellValue('Part-time'),
        ex.TextCellValue('employee'), ex.TextCellValue('0'), ex.TextCellValue('5'),
        ex.TextCellValue('8'), ex.DateCellValue.fromDateTime(DateTime.now()),
      ]);
      final options = excel['Options'];
      options.appendRow([
        ex.TextCellValue('branch options'), ex.TextCellValue('employee_type options'), ex.TextCellValue('access_level options'),
      ]);
      final branches = _managedBranches.isEmpty ? [''] : _managedBranches;
      final types = _managedEmployeeTypes.isEmpty ? ['Part-time', 'Contract', 'Permanent'] : _managedEmployeeTypes;
      const accessLevels = ['employee', 'manager', 'hr_admin'];
      final rowCount = [branches.length, types.length, accessLevels.length].reduce((a, b) => a > b ? a : b);
      for (var i = 0; i < rowCount; i++) {
        options.appendRow([
          ex.TextCellValue(i < branches.length ? branches[i] : ''),
          ex.TextCellValue(i < types.length ? types[i] : ''),
          ex.TextCellValue(i < accessLevels.length ? accessLevels[i] : ''),
        ]);
      }
      final bytes = excel.encode();
      if (bytes == null || bytes.isEmpty) throw StateError('Could not generate Excel template.');
      await FileSaver.instance.saveFile(
        name: 'employee_import_template',
        bytes: Uint8List.fromList(bytes),
        fileExtension: 'xlsx',
        mimeType: MimeType.microsoftExcel,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Template downloaded. Use Sheet1 for paste, and Options sheet for allowed values.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not download template.'));
    }
  }

  Future<void> _importEmployeesFromExcel() async {
    final prov = context.read<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    if (companyId == null) { showErrorSnack(context, 'No company selected.'); return; }
    FilePickerResult? picked;
    try {
      picked = await FilePicker.platform.pickFiles(
        withData: true, type: FileType.custom, allowedExtensions: const ['xlsx'],
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
      showErrorSnack(context, 'Invalid .xlsx format. Use the downloaded template and try again.');
      return;
    }
    if (excel.tables.isEmpty) { showErrorSnack(context, 'The selected .xlsx file has no sheets.'); return; }
    final rows = excel.tables.values.first.rows;
    if (rows.length < 2) { showInfoSnack(context, 'The file has no employee rows to import.'); return; }

    final rawHeaders = rows.first.map(_excelCellToText).toList();
    final headerIndex = <String, int>{for (var i = 0; i < rawHeaders.length; i++) rawHeaders[i]: i};
    final mapping = await _showImportMappingDialog(headers: rawHeaders, initial: _autoDetectImportMapping(rawHeaders));
    if (mapping == null || !mounted) return;

    String cellByField(List<ex.Data?> row, String fieldKey) {
      final col = mapping[fieldKey];
      if (col == null) return '';
      final idx = headerIndex[col];
      if (idx == null || idx < 0 || idx >= row.length) return '';
      return _excelCellToText(row[idx]);
    }

    final existingGovIds = prov.employees
        .map((e) => e.employeeCode.trim().toLowerCase())
        .where((v) => v.isNotEmpty)
        .toSet();
    final branchCanonicalByLower = <String, String>{
      for (final b in _managedBranches) if (b.trim().isNotEmpty) b.trim().toLowerCase(): b.trim(),
    };
    final typeCanonicalByLower = <String, String>{
      for (final t in _managedEmployeeTypes) if (t.trim().isNotEmpty) t.trim().toLowerCase(): t.trim(),
    };
    final seenGovIds = <String>{};
    final drafts = <({int rowNo, Employee employee})>[];
    final errors = <String>[];

    for (var i = 1; i < rows.length; i++) {
      final row = rows[i];
      final rowNo = i + 1;
      final name = cellByField(row, 'name');
      final surname = cellByField(row, 'surname');
      final idNumber = cellByField(row, 'id_number');
      final positionRaw = cellByField(row, 'position');
      final branch = cellByField(row, 'branch');
      final typeLabelRaw = cellByField(row, 'employee_type');
      final accessLevelRaw = cellByField(row, 'access_level');
      final monthlyRaw = cellByField(row, 'monthly_salary');
      final workDaysRaw = cellByField(row, 'work_days_weekly');
      final dailyHoursRaw = cellByField(row, 'daily_hours');
      final employmentDateRaw = cellByField(row, 'employment_date');

      final rowErrors = <String>[];
      if (name.isEmpty) rowErrors.add('name is required');
      if (surname.isEmpty) rowErrors.add('surname is required');
      if (idNumber.isEmpty) rowErrors.add('id_number is required');
      final accessNormalized = accessLevelRaw.trim().toLowerCase().replaceAll(RegExp(r'\s+'), '_');
      if (accessNormalized.isEmpty) {
        rowErrors.add('access_level is required (employee, manager, hr_admin)');
      } else if (accessNormalized != 'employee' && accessNormalized != 'manager' && accessNormalized != 'hr_admin') {
        rowErrors.add('access_level must be employee, manager, or hr_admin');
      }
      final normId = idNumber.toLowerCase();
      if (normId.isNotEmpty) {
        if (!seenGovIds.add(normId)) rowErrors.add('duplicate id_number in file');
        if (existingGovIds.contains(normId)) rowErrors.add('id_number already exists in this company');
      }
      if (rowErrors.isNotEmpty) { errors.add('Row $rowNo: ${rowErrors.join(', ')}'); continue; }

      final employmentDate = DateTime.tryParse(employmentDateRaw) ?? DateTime.now();
      final typeLabelSeed = typeLabelRaw.isEmpty ? 'Part-time' : typeLabelRaw.trim();
      final typeLabel = typeCanonicalByLower[typeLabelSeed.toLowerCase()] ?? _toTitleCase(typeLabelSeed);
      drafts.add((
        rowNo: rowNo,
        employee: Employee(
          name: name, surname: surname, id: '', employeeCode: idNumber,
          employmentDate: employmentDate,
          employmentType: _parseEmploymentType(typeLabel),
          employmentTypeLabel: typeLabel,
          position: _toTitleCase(positionRaw),
          monthlySalary: _parseDoubleOrDefault(monthlyRaw, 0),
          hourlyRate: 0,
          workDaysWeekly: _parseDoubleOrDefault(workDaysRaw, 5),
          dailyHours: _parseDoubleOrDefault(dailyHoursRaw, 8),
          branch: branchCanonicalByLower[branch.trim().toLowerCase()] ?? branch.trim(),
          accessLevel: _parseAccessLevel(accessLevelRaw),
        ),
      ));
    }

    if (!mounted) return;
    final proceed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Import employees'),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Ready to import: ${drafts.length}'),
                if (errors.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text('Skipped rows: ${errors.length}',
                      style: GoogleFonts.poppins(color: Colors.red.shade700, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  ...errors.take(12).map((e) => Text('• $e', style: GoogleFonts.poppins(fontSize: 12))),
                  if (errors.length > 12)
                    Text('• ...and ${errors.length - 12} more', style: GoogleFonts.poppins(fontSize: 12)),
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

    final settings = await SupabaseTimesheetStorage.getCompanySettings(companyId: companyId);
    final allowedRemaining = settings == null
        ? 0
        : (settings.isInFreeTrial
            ? (20 - settings.currentUsers)
            : (settings.subscriptionActive ? (settings.maxUsers - settings.currentUsers) : 0));
    if (drafts.length > allowedRemaining) {
      if (!mounted) return;
      showErrorSnack(context,
          'You can add only $allowedRemaining more users on the current plan. Please import fewer rows or upgrade.');
      return;
    }

    var inserted = 0;
    final failed = <String>[];
    for (final draft in drafts) {
      try {
        await SupabaseTimesheetStorage.insertEmployee(draft.employee, companyId: companyId);
        inserted++;
      } catch (e) {
        failed.add('Row ${draft.rowNo}: ${friendlyErrorMessage(e, fallback: 'Insert failed')}');
      }
    }

    await prov.loadEmployees();
    final refreshedBranches = await SupabaseTimesheetStorage.getCompanyBranches(companyId: companyId);
    final refreshedTypes = await SupabaseTimesheetStorage.getCompanyEmployeeTypes(companyId: companyId);
    if (mounted) setState(() { _managedBranches = refreshedBranches; _managedEmployeeTypes = refreshedTypes; });
    if (!mounted) return;
    if (failed.isEmpty) { showSuccessSnack(context, 'Imported $inserted employee(s) successfully.'); return; }
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Import completed with issues'),
        content: SizedBox(
          width: 520,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Imported: $inserted'),
                Text('Failed: ${failed.length}', style: GoogleFonts.poppins(color: Colors.red.shade700)),
                const SizedBox(height: 8),
                ...failed.take(15).map((e) => Text('• $e', style: GoogleFonts.poppins(fontSize: 12))),
                if (failed.length > 15)
                  Text('• ...and ${failed.length - 15} more', style: GoogleFonts.poppins(fontSize: 12)),
              ],
            ),
          ),
        ),
        actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Close'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final isCompact = MediaQuery.of(context).size.width < 1280;
    final all = prov.employees
        .where((e) =>
            e.workerType != WorkerType.contractor &&
            e.workerType != WorkerType.subcontractor)
        .toList();
    final availableTypeKeys = <String>{
      ..._managedEmployeeTypes,
      for (final e in all)
        if ((e.employmentTypeLabel ?? '').trim().isNotEmpty)
          e.employmentTypeLabel!.trim()
        else
          switch (e.employmentType) {
            EmploymentType.contract => 'Contract',
            EmploymentType.permanent => 'Permanent',
            EmploymentType.student => 'Student',
            _ => 'Part-time',
          }
    }.toList()
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    final availableBranches = <String>{
      ..._managedBranches,
      for (final e in all)
        if (e.branch.trim().isNotEmpty) e.branch.trim()
    }.toList()
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    final effectiveTypeFilter =
        _employeeFilter == 'all' || availableTypeKeys.contains(_employeeFilter) ? _employeeFilter : 'all';
    final effectiveBranchFilter =
        _branchFilter == 'all' || availableBranches.contains(_branchFilter) ? _branchFilter : 'all';

    final list = all.where((e) {
      if (effectiveTypeFilter != 'all') {
        final key = (e.employmentTypeLabel?.trim().isNotEmpty == true)
            ? e.employmentTypeLabel!.trim()
            : switch (e.employmentType) {
                EmploymentType.contract => 'Contract',
                EmploymentType.permanent => 'Permanent',
                EmploymentType.student => 'Student',
                _ => 'Part-time',
              };
        if (key != effectiveTypeFilter) return false;
      }
      if (effectiveBranchFilter != 'all' && e.branch.trim() != effectiveBranchFilter) return false;
      if (_employeeSearchQuery.trim().isNotEmpty &&
          !e.fullName.toLowerCase().contains(_employeeSearchQuery.toLowerCase().trim())) {
        return false;
      }
      return true;
    }).toList();

    final headers = <String>[
      'Full name', 'ID', 'Position', 'Access level', 'Employment', 'Branch',
      if (widget.canViewSensitiveData) 'Rate',
    ];
    final rows = list.map((e) {
      final employeeIdValue = e.employeeCode.isNotEmpty ? e.employeeCode : e.id;
      final type = (e.employmentTypeLabel?.trim().isNotEmpty == true)
          ? e.employmentTypeLabel!.trim()
          : switch (e.employmentType) {
              EmploymentType.contract => 'Contract',
              EmploymentType.permanent => 'Permanent',
              EmploymentType.student => 'Student',
              _ => 'Part-time',
            };
      return [
        e.fullName,
        employeeIdValue,
        e.position.isNotEmpty ? e.position : '—',
        switch (e.accessLevel) {
          EmployeeAccessLevel.manager => 'Manager',
          EmployeeAccessLevel.hrAdmin => 'HR Admin',
          _ => 'Employee',
        },
        type,
        e.branch.isNotEmpty ? e.branch : '—',
        if (widget.canViewSensitiveData) e.hourlyRate.toStringAsFixed(2),
      ];
    }).toList();

    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 80),
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 4, right: 4, bottom: 16),
              child: Wrap(
                spacing: 8, runSpacing: 8, crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('Employees',
                      style: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 20, fontWeight: FontWeight.w600)),
                  const SizedBox(width: 8),
                  buildExportButton(
                    context: context,
                    fileName: 'employees_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
                    headers: headers,
                    rows: rows,
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: _downloadEmployeeImportTemplate,
                    icon: const Icon(Icons.file_download_outlined, size: 16),
                    label: const Text('Template'),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    onPressed: _importEmployeesFromExcel,
                    icon: const Icon(Icons.upload_file, size: 16),
                    label: const Text('Import Excel'),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(builder: (_) => const HrWorkTeamsScreen()),
                      );
                    },
                    icon: const Icon(Icons.groups_outlined, size: 16),
                    label: const Text('Work teams'),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(color: AppTheme.darkBlack, borderRadius: BorderRadius.circular(24)),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.people_alt_outlined, size: 16, color: AppTheme.gold),
                        const SizedBox(width: 8),
                        Text('${list.length} shown',
                            style: GoogleFonts.poppins(color: AppTheme.textGray, fontSize: 11)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            LayoutBuilder(
              builder: (context, constraints) {
                final compact = constraints.maxWidth < 900;
                Widget searchField() => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: TextField(
                        onChanged: (v) => setState(() => _employeeSearchQuery = v),
                        decoration: InputDecoration(
                          prefixIcon: const Icon(Icons.search, size: 20),
                          hintText: 'Search employee name',
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: const BorderSide(color: Color(0xFFD1D5DB))),
                          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: const BorderSide(color: Color(0xFFD1D5DB))),
                          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: const BorderSide(color: AppTheme.gold)),
                          fillColor: Colors.white, filled: true,
                        ),
                      ),
                    );
                Widget typeField() => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: DropdownButtonFormField<String>(
                        initialValue: effectiveTypeFilter,
                        decoration: const InputDecoration(labelText: 'Employee type', isDense: true),
                        items: [
                          const DropdownMenuItem<String>(value: 'all', child: Text('All types')),
                          ...availableTypeKeys.map((t) => DropdownMenuItem<String>(value: t, child: Text(t))),
                        ],
                        onChanged: (v) { if (v != null) setState(() => _employeeFilter = v); },
                      ),
                    );
                Widget branchField() => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: DropdownButtonFormField<String>(
                        initialValue: effectiveBranchFilter,
                        decoration: const InputDecoration(labelText: 'Branch', isDense: true),
                        items: [
                          const DropdownMenuItem<String>(value: 'all', child: Text('All branches')),
                          ...availableBranches.map((b) => DropdownMenuItem<String>(value: b, child: Text(b))),
                        ],
                        onChanged: (v) { if (v != null) setState(() => _branchFilter = v); },
                      ),
                    );
                if (compact) {
                  return Column(children: [searchField(), typeField(), branchField()]);
                }
                return Row(children: [
                  Expanded(child: searchField()),
                  const SizedBox(width: 10),
                  Expanded(child: typeField()),
                  const SizedBox(width: 10),
                  Expanded(child: branchField()),
                ]);
              },
            ),
            if (list.isEmpty)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Center(
                  child: Text('No employees found.\nTap + to create one.',
                      style: GoogleFonts.poppins(color: const Color(0xFF6B7280)), textAlign: TextAlign.center),
                ),
              )
            else
              Card(
                color: Colors.white, elevation: 4,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20), side: const BorderSide(color: Color(0xFFE5E7EB))),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(
                      headingRowColor: WidgetStateProperty.all(const Color(0xFFF9FAFB)),
                      headingTextStyle: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 12, fontWeight: FontWeight.w600),
                      dataTextStyle: GoogleFonts.poppins(color: const Color(0xFF4B5563), fontSize: 12),
                      columnSpacing: isCompact ? 14 : 28,
                      headingRowHeight: isCompact ? 40 : 52,
                      dataRowMinHeight: isCompact ? 38 : 46,
                      dataRowMaxHeight: isCompact ? 52 : 64,
                      dividerThickness: 0.4,
                      columns: [
                        const DataColumn(label: Text('Full name')),
                        const DataColumn(label: Text('ID')),
                        const DataColumn(label: Text('Position')),
                        const DataColumn(label: Text('Access level')),
                        const DataColumn(label: Text('Employment')),
                        const DataColumn(label: Text('Branch')),
                        if (widget.canViewSensitiveData) const DataColumn(label: Text('Rate')),
                        const DataColumn(label: Text('')),
                      ],
                      rows: list.map((e) {
                        final employeeIdValue = e.employeeCode.isNotEmpty ? e.employeeCode : e.id;
                        final type = (e.employmentTypeLabel?.trim().isNotEmpty == true)
                            ? e.employmentTypeLabel!.trim()
                            : switch (e.employmentType) {
                                EmploymentType.contract => 'Contract',
                                EmploymentType.permanent => 'Permanent',
                                EmploymentType.student => 'Student',
                                _ => 'Part-time',
                              };
                        return DataRow(cells: [
                          DataCell(Text(e.fullName)),
                          DataCell(Text(employeeIdValue)),
                          DataCell(Text(e.position.isNotEmpty ? e.position : '—')),
                          DataCell(_AccessLevelChip(level: e.accessLevel)),
                          DataCell(Text(type)),
                          DataCell(Text(e.branch.isNotEmpty ? e.branch : '—')),
                          if (widget.canViewSensitiveData)
                            DataCell(Text('R ${e.hourlyRate.toStringAsFixed(2)}/hr')),
                          DataCell(
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                TextButton(
                                  child: const Text('Generate code'),
                                  onPressed: () => _generateAndCopyTempCode(e),
                                ),
                                Builder(
                                  builder: (_) {
                                    final status = _tempCodeStatusByEmployee[e.id];
                                    final expiresAt = status?.expiresAt;
                                    if (expiresAt == null) return const SizedBox.shrink();
                                    final active = expiresAt.isAfter(DateTime.now());
                                    return Padding(
                                      padding: const EdgeInsets.only(right: 2),
                                      child: Tooltip(
                                        message: active
                                            ? 'Temp code active until ${DateFormat('dd MMM y HH:mm').format(expiresAt)}'
                                            : 'Temp code expired at ${DateFormat('dd MMM y HH:mm').format(expiresAt)}',
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                          decoration: BoxDecoration(
                                            color: (active ? const Color(0xFF059669) : const Color(0xFF6B7280))
                                                .withValues(alpha: 0.10),
                                            borderRadius: BorderRadius.circular(999),
                                            border: Border.all(
                                              color: (active ? const Color(0xFF059669) : const Color(0xFF6B7280))
                                                  .withValues(alpha: 0.25),
                                            ),
                                          ),
                                          child: Text(
                                            active ? 'Code active' : 'Code expired',
                                            style: GoogleFonts.poppins(
                                              fontSize: 10,
                                              fontWeight: FontWeight.w600,
                                              color: active ? const Color(0xFF059669) : const Color(0xFF6B7280),
                                            ),
                                          ),
                                        ),
                                      ),
                                    );
                                  },
                                ),
                                const SizedBox(width: 4),
                                TextButton(
                                  child: const Text('View'),
                                  onPressed: () => Navigator.of(context).push(
                                    MaterialPageRoute(builder: (_) => HrEmployeeDashboardScreen(employee: e)),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ]);
                      }).toList(),
                    ),
                  ),
                ),
              ),
          ],
        ),
        Positioned(
          right: 16, bottom: 16,
          child: FloatingActionButton(
            onPressed: () async {
              await Navigator.of(context)
                  .push(MaterialPageRoute(
                builder: (_) => const HrCreateEmployeeScreen(
                  initialWorkerType: WorkerType.employee,
                ),
              ));
              if (!context.mounted) return;
              await context.read<TimesheetProvider>().loadEmployees();
            },
            backgroundColor: AppTheme.gold,
            foregroundColor: AppTheme.black,
            child: const Icon(Icons.add),
          ),
        ),
      ],
    );
  }
}

class _AccessLevelChip extends StatelessWidget {
  final EmployeeAccessLevel level;

  const _AccessLevelChip({required this.level});

  @override
  Widget build(BuildContext context) {
    final (Color color, IconData icon, String label) = switch (level) {
      EmployeeAccessLevel.employee => (
        const Color(0xFF2563EB),
        Icons.badge_outlined,
        'Employee',
      ),
      EmployeeAccessLevel.manager => (
        const Color(0xFF7C3AED),
        Icons.manage_accounts_outlined,
        'Manager',
      ),
      EmployeeAccessLevel.hrAdmin => (
        const Color(0xFF059669),
        Icons.admin_panel_settings_outlined,
        'HR Admin',
      ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
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
            label,
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
