import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../theme/app_theme.dart';
import '../models/employee.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';

class HrEditEmployeeScreen extends StatefulWidget {
  final Employee employee;

  const HrEditEmployeeScreen({super.key, required this.employee});

  @override
  State<HrEditEmployeeScreen> createState() => _HrEditEmployeeScreenState();
}

class _HrEditEmployeeScreenState extends State<HrEditEmployeeScreen> {
  late final TextEditingController _nameController;
  late final TextEditingController _surnameController;
  late final TextEditingController _govIdController;
  late final TextEditingController _phoneController;
  late final TextEditingController _positionController;
  late final TextEditingController _monthlyController;
  late final TextEditingController _workDaysController;
  late final TextEditingController _dailyHoursController;
  String? _selectedBranch;
  late DateTime _employmentDate;
  String? _selectedTypeLabel;
  late EmployeeAccessLevel _accessLevel;
  List<String> _branchOptions = const [];
  List<String> _typeOptions = const [];
  bool _canViewSensitiveData = false;

  @override
  void initState() {
    super.initState();
    final e = widget.employee;
    _nameController = TextEditingController(text: e.name);
    _surnameController = TextEditingController(text: e.surname);
    _govIdController = TextEditingController(text: e.employeeCode);
    _phoneController = TextEditingController(text: e.phone ?? '');
    _positionController = TextEditingController(text: e.position);
    _monthlyController = TextEditingController(text: e.monthlySalary.toString());
    _workDaysController =
        TextEditingController(text: e.workDaysWeekly.toString());
    _dailyHoursController =
        TextEditingController(text: e.dailyHours.toString());
    _selectedBranch = e.branch.trim().isEmpty ? null : e.branch.trim();
    _employmentDate = e.employmentDate;
    _selectedTypeLabel = (e.employmentTypeLabel?.trim().isNotEmpty == true)
        ? e.employmentTypeLabel!.trim()
        : switch (e.employmentType) {
            EmploymentType.contract => 'Contract',
            EmploymentType.permanent => 'Permanent',
            EmploymentType.student => 'Student',
            _ => 'Part-time',
          };
    _accessLevel = e.accessLevel;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await _loadPermissions();
      await _loadBranches();
      await _loadEmployeeTypes();
    });
  }

  Future<void> _loadPermissions() async {
    try {
      final profile = await SupabaseTimesheetStorage.getCurrentHrProfile();
      if (!mounted) return;
      final role = profile?.role ?? 'viewer';
      setState(() => _canViewSensitiveData = role == 'admin' || role == 'owner');
    } catch (_) {}
  }

  Future<void> _loadBranches() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      final branches = await SupabaseTimesheetStorage.getCompanyBranches(companyId: companyId);
      if (!mounted) return;
      setState(() {
        _branchOptions = branches;
        if (_selectedBranch == null && branches.isNotEmpty) _selectedBranch = branches.first;
      });
    } catch (_) {}
  }

  Future<void> _loadEmployeeTypes() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      final types = await SupabaseTimesheetStorage.getCompanyEmployeeTypes(companyId: companyId);
      if (!mounted) return;
      final merged = <String>{
        ...types,
        if ((_selectedTypeLabel ?? '').trim().isNotEmpty) _selectedTypeLabel!.trim(),
      }.toList();
      merged.sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
      setState(() {
        _typeOptions = merged;
        if (_selectedTypeLabel == null && merged.isNotEmpty) _selectedTypeLabel = merged.first;
      });
    } catch (_) {}
  }

  Future<void> _addEmployeeType() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final ctrl = TextEditingController();
    final added = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add employee type'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Type name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(ctrl.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    if (added == null || added.isEmpty) return;
    await SupabaseTimesheetStorage.upsertCompanyEmployeeType(companyId: companyId, name: added);
    await _loadEmployeeTypes();
    if (!mounted) return;
    setState(() => _selectedTypeLabel = added);
  }

  @override
  void dispose() {
    _nameController.dispose();
    _surnameController.dispose();
    _govIdController.dispose();
    _phoneController.dispose();
    _positionController.dispose();
    _monthlyController.dispose();
    _workDaysController.dispose();
    _dailyHoursController.dispose();
    super.dispose();
  }

  static final _dateFormat = DateFormat('yyyy-MM-dd');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text('Edit employee', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppTheme.gold),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Card(
          color: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          elevation: 4,
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _nameController,
                  decoration: const InputDecoration(labelText: 'Name'),
                  style: const TextStyle(color: Color(0xFF111827)),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _surnameController,
                  decoration: const InputDecoration(labelText: 'Surname'),
                  style: const TextStyle(color: Color(0xFF111827)),
                ),
                const SizedBox(height: 12),
                if (_canViewSensitiveData) ...[
                  TextField(
                    controller: _govIdController,
                    decoration: const InputDecoration(labelText: 'ID number'),
                    style: const TextStyle(color: Color(0xFF111827)),
                  ),
                  const SizedBox(height: 12),
                ],
                TextField(
                  controller: _phoneController,
                  decoration: const InputDecoration(
                    labelText: 'Phone number',
                    hintText: '+27...',
                    helperText: 'Used for optional phone OTP login.',
                  ),
                  keyboardType: TextInputType.phone,
                  autocorrect: false,
                  style: const TextStyle(color: Color(0xFF111827)),
                ),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title:
                      Text('Employment date', style: GoogleFonts.poppins(color: AppTheme.gold, fontSize: 12)),
                  subtitle: Text(_dateFormat.format(_employmentDate),
                      style: GoogleFonts.poppins(color: AppTheme.textGray)),
                  trailing: const Icon(Icons.calendar_today, color: AppTheme.gold, size: 20),
                  onTap: () async {
                    final d = await showDatePicker(
                      context: context,
                      initialDate: _employmentDate,
                      firstDate: DateTime(2000),
                      lastDate: DateTime.now(),
                    );
                    if (d != null) setState(() => _employmentDate = d);
                  },
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _selectedTypeLabel,
                        decoration: const InputDecoration(labelText: 'Employee type'),
                        items: _typeOptions
                            .map((t) => DropdownMenuItem<String>(value: t, child: Text(t)))
                            .toList(),
                        onChanged: (v) => setState(() => _selectedTypeLabel = v),
                      ),
                    ),
                    const SizedBox(width: 10),
                    OutlinedButton.icon(
                      onPressed: _addEmployeeType,
                      icon: const Icon(Icons.add),
                      label: const Text('Add type'),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _positionController,
                  decoration: const InputDecoration(labelText: 'Position'),
                  style: const TextStyle(color: Color(0xFF111827)),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<EmployeeAccessLevel>(
                  initialValue: _accessLevel,
                  items: const [
                    DropdownMenuItem(
                      value: EmployeeAccessLevel.employee,
                      child: Text('Employee'),
                    ),
                    DropdownMenuItem(
                      value: EmployeeAccessLevel.manager,
                      child: Text('Manager'),
                    ),
                    DropdownMenuItem(
                      value: EmployeeAccessLevel.hrAdmin,
                      child: Text('HR Admin'),
                    ),
                  ],
                  onChanged: (v) {
                    if (v == null) return;
                    setState(() => _accessLevel = v);
                  },
                  decoration: const InputDecoration(labelText: 'Access level'),
                ),
                const SizedBox(height: 12),
                if (_canViewSensitiveData) ...[
                  TextField(
                    controller: _monthlyController,
                    decoration: const InputDecoration(labelText: 'Monthly salary'),
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    style: const TextStyle(color: Color(0xFF111827)),
                  ),
                  const SizedBox(height: 12),
                ],
                TextField(
                  controller: _workDaysController,
                  decoration: const InputDecoration(labelText: 'Work days per week'),
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Color(0xFF111827)),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _dailyHoursController,
                  decoration: const InputDecoration(labelText: 'Daily hours'),
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  style: const TextStyle(color: Color(0xFF111827)),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _selectedBranch,
                  decoration: const InputDecoration(labelText: 'Branch'),
                  items: _branchOptions
                      .map((b) => DropdownMenuItem<String>(value: b, child: Text(b)))
                      .toList(),
                  onChanged: (v) => setState(() => _selectedBranch = v),
                ),
                const SizedBox(height: 32),
                Consumer<TimesheetProvider>(
                  builder: (context, prov, _) {
                    return ElevatedButton(
                      onPressed: prov.isLoading
                          ? null
                          : () async {
                              final name = _nameController.text.trim();
                              final surname = _surnameController.text.trim();
                              final govId = _govIdController.text.trim();
                              final phone = _phoneController.text.trim();
                              if (name.isEmpty && surname.isEmpty) {
                                showInfoSnack(context, 'Enter at least name or surname.');
                                return;
                              }
                              if ((_selectedBranch ?? '').trim().isEmpty) {
                                showInfoSnack(context, 'Select a branch.');
                                return;
                              }
                              if ((_selectedTypeLabel ?? '').trim().isEmpty) {
                                showInfoSnack(context, 'Select an employee type.');
                                return;
                              }
                              if (_canViewSensitiveData && govId.isEmpty) {
                                showInfoSnack(context, 'Enter ID number.');
                                return;
                              }
                              final monthly = _canViewSensitiveData
                                  ? (double.tryParse(_monthlyController.text.trim()) ?? 0)
                                  : widget.employee.monthlySalary;
                              final workDays =
                                  double.tryParse(_workDaysController.text.trim()) ?? 5;
                              final dailyHours =
                                  double.tryParse(_dailyHoursController.text.trim()) ?? 8;
                              final emp = widget.employee.copyWith(
                                name: name,
                                surname: surname,
                                employeeCode:
                                    _canViewSensitiveData ? govId : widget.employee.employeeCode,
                                phone: phone.isEmpty ? null : phone,
                                employmentDate: _employmentDate,
                                employmentType: (_selectedTypeLabel ?? '').toLowerCase().contains('contract')
                                    ? EmploymentType.contract
                                    : (_selectedTypeLabel ?? '').toLowerCase().contains('permanent')
                                        ? EmploymentType.permanent
                                        : (_selectedTypeLabel ?? '').toLowerCase().contains('student')
                                            ? EmploymentType.student
                                            : EmploymentType.partTime,
                                employmentTypeLabel: _selectedTypeLabel,
                                position: _positionController.text.trim(),
                                monthlySalary: monthly,
                                hourlyRate: 0,
                                workDaysWeekly: workDays,
                                dailyHours: dailyHours,
                                branch: _selectedBranch ?? '',
                                accessLevel: _accessLevel,
                              );
                              try {
                                await prov.updateEmployee(emp);
                                if (context.mounted) {
                                  showSuccessSnack(context, 'Employee updated.');
                                  AppTelemetry.logInfo(screen: 'hr_edit_employee_screen', action: 'employee_updated');
                                  Navigator.of(context).pop(emp);
                                }
                              } catch (e) {
                                if (context.mounted) {
                                  AppTelemetry.logError(screen: 'hr_edit_employee_screen', action: 'save_employee', error: e);
                                  showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Failed to save employee.'));
                                }
                              }
                            },
                      child: prov.isLoading
                          ? const SizedBox(
                              height: 24,
                              width: 24,
                              child: CircularProgressIndicator(
                                color: AppTheme.black,
                                strokeWidth: 2,
                              ),
                            )
                          : const Text('Save changes'),
                    );
                  },
                ),
          ],
        ),
      ),
     )
      )
    );
  }
}
