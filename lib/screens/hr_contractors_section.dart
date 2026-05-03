import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/employee.dart';
import '../models/contractor.dart';
import '../models/contractor_member_link.dart';
import '../models/job.dart';
import '../models/incident_report.dart';
import '../models/payment_approval.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import 'hr_create_employee_screen.dart';
import '_dashboard_decorators.dart';
import 'hr_contractor_details_screen.dart';

class HrContractorsSection extends StatefulWidget {
  const HrContractorsSection({super.key});

  @override
  State<HrContractorsSection> createState() => _HrContractorsSectionState();
}

class _HrContractorsSectionState extends State<HrContractorsSection> {
  static String _sessionRelationshipStatusFilter = 'all';
  static String _sessionRelationshipSearch = '';
  static String _sessionRelationshipSortBy = 'updated';
  static bool _sessionRelationshipSortAsc = false;
  static int _sessionRelationshipPage = 0;
  DateTime _rangeStart = DateTime(DateTime.now().year, DateTime.now().month, 1);
  DateTime _rangeEnd = DateTime(DateTime.now().year, DateTime.now().month + 1, 0);
  String _activeTab = 'entities';
  String _activityContractorFilter = 'all';
  String _relationshipStatusFilter = _sessionRelationshipStatusFilter;
  String _relationshipSearch = _sessionRelationshipSearch;
  String _relationshipSortBy = _sessionRelationshipSortBy;
  bool _relationshipSortAsc = _sessionRelationshipSortAsc;
  int _relationshipPage = _sessionRelationshipPage;
  static const int _relationshipPageSize = 10;
  bool _loading = false;
  List<EmployeeHoursSummary> _rows = [];
  List<Employee> _contractors = const [];
  List<Contractor> _contractorEntities = const [];
  Map<String, List<ContractorMemberLink>> _contractorMembers = const {};
  List<Job> _jobs = const [];
  List<IncidentReport> _incidents = const [];
  List<Map<String, dynamic>> _deals = const [];
  final Map<String, double?> _feedbackAverageCache = {};
  List<Map<String, dynamic>> _incomingRelationshipRequests = const [];
  List<Map<String, dynamic>> _relationshipHistory = const [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _reload());
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
      _rangeStart = DateTime(picked.year, picked.month, picked.day);
      if (_rangeStart.isAfter(_rangeEnd)) _rangeEnd = _rangeStart;
    });
    await _reload();
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
      _rangeEnd = DateTime(picked.year, picked.month, picked.day);
      if (_rangeEnd.isBefore(_rangeStart)) _rangeStart = _rangeEnd;
    });
    await _reload();
  }

  Future<void> _reload() async {
    final prov = context.read<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    if (companyId == null) return;
    setState(() => _loading = true);
    try {
      final end = DateTime(_rangeEnd.year, _rangeEnd.month, _rangeEnd.day, 23, 59, 59);
      final summaries = await prov.getHoursSummaries(_rangeStart, end);
      final contractors = prov.employees
          .where((e) =>
              e.workerType == WorkerType.contractor ||
              e.workerType == WorkerType.subcontractor)
          .toList();
      final contractorIds = contractors.map((e) => e.id).toSet();
      final contractorSummaries =
          summaries.where((s) => contractorIds.contains(s.employee.id)).toList();
      final jobs = await SupabaseTimesheetStorage.getJobs(companyId: companyId);
      final incidents = await SupabaseTimesheetStorage.getIncidents(companyId: companyId);
      final deals = await SupabaseTimesheetStorage.getCompanyClientDeals(companyId: companyId);
      final entities = await SupabaseTimesheetStorage.getContractors(companyId: companyId);
      final membersByContractor =
          await SupabaseTimesheetStorage.getContractorMembersByContractor(companyId: companyId);
      final incomingRelationships = await SupabaseTimesheetStorage.getCompanyRelationshipsDetailed(
        companyId: companyId,
        asRequester: false,
      );
      if (!mounted) return;
      setState(() {
        _contractors = contractors;
        _rows = contractorSummaries;
        _jobs = jobs;
        _incidents = incidents;
        _deals = deals;
        _contractorEntities = entities;
        _contractorMembers = membersByContractor;
        _incomingRelationshipRequests = incomingRelationships
            .where((r) => (r['status']?.toString() ?? '') == 'pending')
            .toList();
        _relationshipHistory = incomingRelationships
            .where((r) => (r['status']?.toString() ?? '') != 'pending')
            .toList();
        _feedbackAverageCache.clear();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  void _syncRelationshipSessionState() {
    _sessionRelationshipStatusFilter = _relationshipStatusFilter;
    _sessionRelationshipSearch = _relationshipSearch;
    _sessionRelationshipSortBy = _relationshipSortBy;
    _sessionRelationshipSortAsc = _relationshipSortAsc;
    _sessionRelationshipPage = _relationshipPage;
  }

  Future<void> _setApproval({
    required Employee employee,
    required DateTime periodStart,
    required String status,
    double? editedAmount,
    String? decisionNote,
  }) async {
    final approved = status == 'approved';
    await SupabaseTimesheetStorage.upsertPaymentApproval(
      PaymentApproval(
        employeeId: employee.id,
        periodStart: periodStart,
        editedAmount: editedAmount,
        approved: approved,
        approvedAt: approved ? DateTime.now() : null,
        status: status,
        decisionNote: decisionNote,
      ),
      companyId: context.read<TimesheetProvider>().currentCompanyId,
    );
    if (!mounted) return;
    showSuccessSnack(
      context,
      status == 'approved'
          ? 'Payment approved for ${employee.fullName}.'
          : status == 'declined'
              ? 'Payment declined for ${employee.fullName}.'
              : 'Payment marked $status for ${employee.fullName}.',
    );
    setState(() {});
  }

  Future<void> _addOrEditContractor({Contractor? existing}) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final nameCtrl = TextEditingController(text: existing?.displayName ?? '');
    final contactCtrl = TextEditingController(text: existing?.contactPerson ?? '');
    final emailCtrl = TextEditingController(text: existing?.email ?? '');
    final phoneCtrl = TextEditingController(text: existing?.phone ?? '');
    String type = existing?.contractorType ?? 'company';
    final selectedMemberIds = <String>{
      ...(_contractorMembers[existing?.id ?? ''] ?? const <ContractorMemberLink>[])
          .map((m) => m.employeeId),
    };
    bool allowAllJobs = existing?.allowMembersViewAllJobs ?? true;

    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(existing == null ? 'Add contractor' : 'Edit contractor'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: type,
                    decoration: const InputDecoration(labelText: 'Contractor type'),
                    items: const [
                      DropdownMenuItem(value: 'company', child: Text('Company')),
                      DropdownMenuItem(value: 'individual', child: Text('Individual')),
                    ],
                    onChanged: (v) {
                      if (v != null) setLocal(() => type = v);
                    },
                  ),
                  const SizedBox(height: 10),
                  TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name')),
                  const SizedBox(height: 10),
                  TextField(
                    controller: contactCtrl,
                    decoration: const InputDecoration(labelText: 'Contact person (optional)'),
                  ),
                  const SizedBox(height: 10),
                  TextField(controller: emailCtrl, decoration: const InputDecoration(labelText: 'Email (optional)')),
                  const SizedBox(height: 10),
                  TextField(controller: phoneCtrl, decoration: const InputDecoration(labelText: 'Phone (optional)')),
                  const SizedBox(height: 10),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    value: allowAllJobs,
                    title: const Text('Members can view all contractor jobs'),
                    subtitle: const Text('If off, members only see jobs directly assigned to them.'),
                    onChanged: (v) => setLocal(() => allowAllJobs = v),
                  ),
                  const SizedBox(height: 14),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Contractor login members',
                      style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 6),
                  ..._contractors.map((e) {
                    final selected = selectedMemberIds.contains(e.id);
                    return CheckboxListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(e.fullName),
                      subtitle: Text(e.workerType.label),
                      value: selected,
                      onChanged: (v) {
                        setLocal(() {
                          if (v == true) {
                            selectedMemberIds.add(e.id);
                          } else {
                            selectedMemberIds.remove(e.id);
                          }
                        });
                      },
                    );
                  }),
                ],
              ),
            ),
          ),
          actions: [
            OutlinedButton.icon(
              onPressed: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const HrCreateEmployeeScreen(
                      initialWorkerType: WorkerType.contractor,
                    ),
                  ),
                );
                if (!mounted) return;
                await context.read<TimesheetProvider>().loadEmployees();
                await _reload();
              },
              icon: const Icon(Icons.person_add_alt_1_outlined, size: 16),
              label: const Text('Create member'),
            ),
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Save')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    if (nameCtrl.text.trim().isEmpty) {
      if (!mounted) return;
      showErrorSnack(context, 'Contractor name is required.');
      return;
    }

    final id = await SupabaseTimesheetStorage.upsertContractor(
      companyId: companyId,
      id: existing?.id,
      contractorType: type,
      displayName: nameCtrl.text.trim(),
      contactPerson: contactCtrl.text.trim(),
      email: emailCtrl.text.trim(),
      phone: phoneCtrl.text.trim(),
      allowMembersViewAllJobs: allowAllJobs,
    );
    if (id != null) {
      final existingDetails = (_contractorMembers[existing?.id ?? id] ?? const <ContractorMemberLink>[])
          .fold<Map<String, ContractorMemberLink>>(
        <String, ContractorMemberLink>{},
        (acc, m) => {...acc, m.employeeId: m},
      );
      final rows = selectedMemberIds
          .map(
            (employeeId) => ContractorMemberLink(
              contractorId: id,
              employeeId: employeeId,
              roleLabel: existingDetails[employeeId]?.roleLabel,
              isPrimary: existingDetails[employeeId]?.isPrimary ?? false,
            ),
          )
          .toList();
      await SupabaseTimesheetStorage.setContractorMembersDetailed(
        companyId: companyId,
        contractorId: id,
        members: rows,
      );
    }
    await _reload();
  }

  Future<void> _manageContractorMembers(Contractor contractor) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final currentMembers = _contractorMembers[contractor.id] ?? const <ContractorMemberLink>[];
    final selectedMemberIds = <String>{...currentMembers.map((m) => m.employeeId)};
    final roleByEmployee = <String, String?>{
      for (final m in currentMembers) m.employeeId: m.roleLabel,
    };
    final primaryByEmployee = <String, bool>{
      for (final m in currentMembers) m.employeeId: m.isPrimary,
    };
    Future<void> createMemberAndLink() async {
      final nameCtrl = TextEditingController();
      final surnameCtrl = TextEditingController();
      final emailCtrl = TextEditingController();
      final phoneCtrl = TextEditingController();
      WorkerType workerType = WorkerType.contractor;
      final create = await showDialog<bool>(
        context: context,
        builder: (context) => StatefulBuilder(
          builder: (context, setLocal) => AlertDialog(
            title: const Text('Add contractor member'),
            content: SizedBox(
              width: 460,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name *')),
                    const SizedBox(height: 10),
                    TextField(controller: surnameCtrl, decoration: const InputDecoration(labelText: 'Surname *')),
                    const SizedBox(height: 10),
                    TextField(
                      controller: emailCtrl,
                      keyboardType: TextInputType.emailAddress,
                      decoration: const InputDecoration(labelText: 'Email (for login)'),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: phoneCtrl,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: 'Phone (optional)'),
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<WorkerType>(
                      initialValue: workerType,
                      items: const [
                        DropdownMenuItem(value: WorkerType.contractor, child: Text('Contractor member')),
                        DropdownMenuItem(value: WorkerType.subcontractor, child: Text('Subcontractor member')),
                      ],
                      onChanged: (v) {
                        if (v != null) setLocal(() => workerType = v);
                      },
                      decoration: const InputDecoration(labelText: 'Member type'),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
              ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Create')),
            ],
          ),
        ),
      );
      if (create != true) return;
      final name = nameCtrl.text.trim();
      final surname = surnameCtrl.text.trim();
      final email = emailCtrl.text.trim().toLowerCase();
      final phone = phoneCtrl.text.trim();
      if (name.isEmpty || surname.isEmpty) {
        if (mounted) showInfoSnack(context, 'Name and surname are required.');
        return;
      }
      if (email.isNotEmpty && !RegExp(r'^[^@]+@[^@]+\.[^@]+').hasMatch(email)) {
        if (mounted) showInfoSnack(context, 'Enter a valid email.');
        return;
      }
      final memberId = await SupabaseTimesheetStorage.insertEmployeeReturningId(
        Employee(
          id: '',
          name: name,
          surname: surname,
          employeeCode: '',
          employmentDate: DateTime.now(),
          employmentType: EmploymentType.contract,
          employmentTypeLabel: 'Contractor member',
          position: 'Contractor member',
          monthlySalary: 0,
          hourlyRate: 0,
          workDaysWeekly: 0,
          dailyHours: 0,
          branch: '',
          accessLevel: EmployeeAccessLevel.employee,
          workerType: workerType,
          email: email.isEmpty ? null : email,
          phone: phone.isEmpty ? null : phone,
        ),
        companyId: companyId,
      );
      if (memberId != null) {
        selectedMemberIds.add(memberId);
        roleByEmployee[memberId] = 'member';
        primaryByEmployee[memberId] = false;
      }
      await context.read<TimesheetProvider>().loadEmployees();
      await _reload();
      if (!mounted) return;
      showSuccessSnack(
        context,
        email.isNotEmpty
            ? 'Member created and linked. They can sign in with email OTP code.'
            : 'Member created and linked.',
      );
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text('Manage members • ${contractor.displayName}'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_contractors.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8),
                      child: Text('No contractor members found yet.'),
                    ),
                  ..._contractors.map((e) {
                    final selected = selectedMemberIds.contains(e.id);
                    final role = (roleByEmployee[e.id] ?? 'member').toLowerCase();
                    return Column(
                      children: [
                        CheckboxListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(e.fullName),
                          subtitle: Text(e.workerType.label),
                          value: selected,
                          onChanged: (v) {
                            setLocal(() {
                              if (v == true) {
                                selectedMemberIds.add(e.id);
                                roleByEmployee[e.id] = roleByEmployee[e.id] ?? 'member';
                                primaryByEmployee[e.id] = primaryByEmployee[e.id] ?? false;
                              } else {
                                selectedMemberIds.remove(e.id);
                              }
                            });
                          },
                        ),
                        if (selected)
                          Padding(
                            padding: const EdgeInsets.only(left: 8, right: 8, bottom: 8),
                            child: Row(
                              children: [
                                Expanded(
                                  child: DropdownButtonFormField<String>(
                                    initialValue: role == 'owner' || role == 'manager' ? role : 'member',
                                    isDense: true,
                                    decoration: const InputDecoration(labelText: 'Access role'),
                                    items: const [
                                      DropdownMenuItem(value: 'owner', child: Text('Owner')),
                                      DropdownMenuItem(value: 'manager', child: Text('Manager')),
                                      DropdownMenuItem(value: 'member', child: Text('Member')),
                                    ],
                                    onChanged: (v) {
                                      if (v == null) return;
                                      setLocal(() => roleByEmployee[e.id] = v);
                                    },
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: CheckboxListTile(
                                    dense: true,
                                    contentPadding: EdgeInsets.zero,
                                    value: primaryByEmployee[e.id] ?? false,
                                    title: const Text('Primary lead'),
                                    onChanged: (v) => setLocal(
                                      () => primaryByEmployee[e.id] = v == true,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    );
                  }),
                ],
              ),
            ),
          ),
          actions: [
            OutlinedButton.icon(
              onPressed: createMemberAndLink,
              icon: const Icon(Icons.person_add_alt_1_outlined, size: 16),
              label: const Text('Create member'),
            ),
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Save members')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final rows = selectedMemberIds
        .map(
          (employeeId) => ContractorMemberLink(
            contractorId: contractor.id,
            employeeId: employeeId,
            roleLabel: roleByEmployee[employeeId],
            isPrimary: primaryByEmployee[employeeId] ?? false,
          ),
        )
        .toList();
    await SupabaseTimesheetStorage.setContractorMembersDetailed(
      companyId: companyId,
      contractorId: contractor.id,
      members: rows,
    );
    await _reload();
  }

  Future<void> _linkContractorToExistingCompany(Contractor contractor) async {
    final requesterCompanyId = context.read<TimesheetProvider>().currentCompanyId;
    if (requesterCompanyId == null) return;
    final companyCodeCtrl = TextEditingController();
    bool autoCreateClient = true;
    bool requireApproval = true;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text('Link ${contractor.displayName} to registered company'),
          content: SizedBox(
            width: 460,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: companyCodeCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Recipient company code',
                    helperText: 'The contractor company code in KaiFlow.',
                  ),
                ),
                const SizedBox(height: 10),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  value: autoCreateClient,
                  title: const Text('Auto-create this company as a client there'),
                  subtitle: const Text('Creates/updates your company in recipient client list.'),
                  onChanged: (v) => setLocal(() => autoCreateClient = v),
                ),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  value: requireApproval,
                  title: const Text('Require recipient approval'),
                  subtitle: const Text('Sends pending request instead of immediate active link.'),
                  onChanged: (v) => setLocal(() => requireApproval = v),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Link')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final code = companyCodeCtrl.text.trim();
    if (code.isEmpty) {
      if (mounted) showInfoSnack(context, 'Please enter a company code.');
      return;
    }
    final res = requireApproval
        ? await SupabaseTimesheetStorage.requestContractorCompanyLink(
            requesterCompanyId: requesterCompanyId,
            contractorId: contractor.id,
            recipientCompanyCode: code,
          )
        : await SupabaseTimesheetStorage.linkContractorToRegisteredCompany(
            requesterCompanyId: requesterCompanyId,
            contractorId: contractor.id,
            recipientCompanyCode: code,
            autoCreateClient: autoCreateClient,
          );
    if (!mounted) return;
    if (res['ok'] == true) {
      showSuccessSnack(
        context,
        requireApproval ? 'Link request sent for approval.' : 'Company linked successfully.',
      );
      await _reload();
      return;
    }
    final reason = (res['reason'] ?? 'Linking failed').toString();
    showErrorSnack(context, 'Could not link company: $reason');
  }

  Future<bool> _decideRelationship(
    Map<String, dynamic> relationship,
    bool approve, {
    bool silent = false,
  }) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return false;
    final res = await SupabaseTimesheetStorage.decideCompanyRelationshipRequest(
      recipientCompanyId: companyId,
      relationshipId: relationship['id']?.toString() ?? '',
      approve: approve,
      autoCreateClient: true,
    );
    if (!mounted) return false;
    if (res['ok'] == true) {
      if (!silent) {
        showSuccessSnack(context, approve ? 'Relationship approved.' : 'Relationship rejected.');
        await _reload();
      }
      return true;
    }
    if (!silent) {
      showErrorSnack(context, 'Could not update relationship request.');
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) {
      return const Center(child: Text('No company selected.'));
    }
    return FutureBuilder<List<PaymentApproval>>(
      key: ValueKey(
        'contractor_approvals_${_rangeStart.year}_${_rangeStart.month}_${_rangeStart.day}_${_rangeEnd.year}_${_rangeEnd.month}_${_rangeEnd.day}',
      ),
      future: SupabaseTimesheetStorage.getPaymentApprovalsForRange(
        _rangeStart,
        _rangeEnd,
        companyId: companyId,
      ),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load contractor data.'),
            onRetry: _reload,
          );
        }
        final approvals = snapshot.data ?? const <PaymentApproval>[];
        approvals.sort((a, b) => a.periodStart.compareTo(b.periodStart));
        final approvalsByEmp = <String, PaymentApproval>{};
        for (final a in approvals) {
          approvalsByEmp[a.employeeId] = a;
        }
        final totalDue = _rows.fold<double>(0, (sum, r) {
          final a = approvalsByEmp[r.employee.id];
          return sum + (a?.editedAmount ?? r.paymentDue);
        });
        final approvedCount = _rows.where((r) => approvalsByEmp[r.employee.id]?.approved == true).length;
        final pendingCount = _rows.length - approvedCount;
        final isCompact = MediaQuery.of(context).size.width < 1200;

        int jobsForEmployee(String employeeId) {
          return _jobs.where((j) {
            final assigned = j.assignedEmployeeIds.toSet();
            final assignee = j.assigneeEmployeeId;
            final contractor = j.contractorEmployeeId;
            return assigned.contains(employeeId) || assignee == employeeId || contractor == employeeId;
          }).length;
        }

        bool inRange(DateTime? date) {
          if (date == null) return false;
          final start = DateTime(_rangeStart.year, _rangeStart.month, _rangeStart.day);
          final end = DateTime(_rangeEnd.year, _rangeEnd.month, _rangeEnd.day, 23, 59, 59);
          return !date.isBefore(start) && !date.isAfter(end);
        }

        List<Job> jobsForContractorInRange(String employeeId) {
          return _jobs.where((j) {
            final linked = j.assignedEmployeeIds.contains(employeeId) ||
                j.assigneeEmployeeId == employeeId ||
                j.contractorEmployeeId == employeeId;
            if (!linked) return false;
            return inRange(j.closedAt) || inRange(j.scheduledStart) || inRange(j.openedAt);
          }).toList();
        }

        final rowsForView = _activityContractorFilter == 'all'
            ? _rows
            : _rows.where((r) => r.employee.id == _activityContractorFilter).toList();

        return Stack(
          children: [
            SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 88),
              child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    'Contractors',
                    style: GoogleFonts.poppins(fontSize: 20, fontWeight: FontWeight.w600, color: const Color(0xFF111827)),
                  ),
                  const Spacer(),
                  OutlinedButton.icon(
                    onPressed: _pickFromDate,
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppTheme.gold),
                      foregroundColor: AppTheme.gold,
                    ),
                    icon: const Icon(Icons.calendar_today_outlined, size: 18),
                    label: Text('From ${DateFormat('dd MMM y').format(_rangeStart)}'),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: _pickToDate,
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppTheme.gold),
                      foregroundColor: AppTheme.gold,
                    ),
                    icon: const Icon(Icons.event_outlined, size: 18),
                    label: Text('To ${DateFormat('dd MMM y').format(_rangeEnd)}'),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(
                    value: 'entities',
                    icon: Icon(Icons.apartment_outlined, size: 16),
                    label: Text('All contractors'),
                  ),
                  ButtonSegment(
                    value: 'activity',
                    icon: Icon(Icons.insights_outlined, size: 16),
                    label: Text('Contractor activity'),
                  ),
                  ButtonSegment(
                    value: 'relationships',
                    icon: Icon(Icons.hub_outlined, size: 16),
                    label: Text('Relationships'),
                  ),
                ],
                selected: {_activeTab},
                onSelectionChanged: (v) {
                  if (v.isEmpty) return;
                  setState(() {
                    _activeTab = v.first;
                    if (_activeTab == 'relationships') {
                      _relationshipPage = 0;
                    }
                    _syncRelationshipSessionState();
                  });
                },
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  _MetricCard(label: 'Contractors', value: '${_contractors.length}'),
                  _MetricCard(label: 'Payment due', value: 'R ${totalDue.toStringAsFixed(2)}'),
                  _MetricCard(label: 'Approved', value: '$approvedCount'),
                  _MetricCard(label: 'Pending/declined', value: '$pendingCount'),
                ],
              ),
              const SizedBox(height: 14),
              if (_activeTab == 'entities')
                Card(
                color: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (_incomingRelationshipRequests.isNotEmpty) ...[
                        Card(
                          color: const Color(0xFFF8FAFC),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                            side: const BorderSide(color: Color(0xFFE2E8F0)),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(10),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Incoming company link requests',
                                  style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                                ),
                                const SizedBox(height: 8),
                                ..._incomingRelationshipRequests.map((r) => Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            '${r['requester_company_name'] ?? 'Requester company'} '
                                            '(${r['requester_company_code'] ?? 'no-code'}) requested contractor link',
                                            style: GoogleFonts.poppins(fontSize: 12),
                                          ),
                                        ),
                                        TextButton(
                                          onPressed: () => _decideRelationship(r, false),
                                          child: const Text('Reject'),
                                        ),
                                        ElevatedButton(
                                          onPressed: () => _decideRelationship(r, true),
                                          child: const Text('Approve'),
                                        ),
                                      ],
                                    )),
                                if (_relationshipHistory.isNotEmpty) ...[
                                  const SizedBox(height: 8),
                                  Text(
                                    'Recent relationship decisions',
                                    style: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w600),
                                  ),
                                  const SizedBox(height: 6),
                                  ..._relationshipHistory.take(6).map(
                                        (r) => Text(
                                          '${r['requester_company_name'] ?? r['requester_company_id']} '
                                          '(${r['requester_company_code'] ?? 'no-code'}) - ${r['status']}',
                                          style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFF6B7280)),
                                        ),
                                      ),
                                ],
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                      ],
                      Row(
                        children: [
                          Text(
                            'Contractor entities',
                            style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      if (_contractorEntities.isEmpty)
                        Text(
                          'No contractor companies/individuals yet.',
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                        )
                      else
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: DataTable(
                            columns: const [
                              DataColumn(label: Text('Contractor')),
                              DataColumn(label: Text('Link status')),
                              DataColumn(label: Text('Type')),
                              DataColumn(label: Text('Members')),
                              DataColumn(label: Text('Contact')),
                              DataColumn(label: Text('Actions')),
                            ],
                            rows: _contractorEntities.map((c) {
                              final members = _contractorMembers[c.id] ?? const <ContractorMemberLink>[];
                              return DataRow(
                                cells: [
                                  DataCell(Text(c.displayName)),
                                  DataCell(_buildLinkedCompanyStatusChip(c.linkedCompanyStatus)),
                                  DataCell(Text(c.contractorType)),
                                  DataCell(Text('${members.length}')),
                                  DataCell(Text(c.contactPerson?.trim().isNotEmpty == true ? c.contactPerson! : '—')),
                                  DataCell(
                                    Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        TextButton.icon(
                                          onPressed: () => _manageContractorMembers(c),
                                          icon: const Icon(Icons.group_add_outlined, size: 16),
                                          label: const Text('Members'),
                                        ),
                                        const SizedBox(width: 4),
                                        TextButton.icon(
                                          onPressed: () => _addOrEditContractor(existing: c),
                                          icon: const Icon(Icons.edit_outlined, size: 16),
                                          label: const Text('Edit'),
                                        ),
                                        const SizedBox(width: 4),
                                        TextButton.icon(
                                          onPressed: () => _linkContractorToExistingCompany(c),
                                          icon: const Icon(Icons.link_outlined, size: 16),
                                          label: const Text('Link company'),
                                        ),
                                        const SizedBox(width: 4),
                                        TextButton.icon(
                                          onPressed: () => Navigator.of(context).push(
                                            MaterialPageRoute(
                                              builder: (_) => HrContractorDetailsScreen(
                                                contractor: c,
                                                memberIds: members.map((m) => m.employeeId).toList(),
                                                initialFrom: _rangeStart,
                                                initialTo: _rangeEnd,
                                              ),
                                            ),
                                          ),
                                          icon: const Icon(Icons.open_in_new_outlined, size: 16),
                                          label: const Text('Open'),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              );
                            }).toList(),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
              if (_activeTab == 'relationships')
                Card(
                  color: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Builder(
                          builder: (context) {
                            List<Map<String, dynamic>> applyFilter(List<Map<String, dynamic>> rows) {
                              return rows.where((r) {
                                final status = (r['status'] ?? '').toString().toLowerCase();
                                final name = (r['requester_company_name'] ?? '').toString().toLowerCase();
                                final code = (r['requester_company_code'] ?? '').toString().toLowerCase();
                                final matchStatus =
                                    _relationshipStatusFilter == 'all' || status == _relationshipStatusFilter;
                                final matchSearch = _relationshipSearch.isEmpty ||
                                    name.contains(_relationshipSearch) ||
                                    code.contains(_relationshipSearch);
                                return matchStatus && matchSearch;
                              }).toList();
                            }

                            int compareRows(Map<String, dynamic> a, Map<String, dynamic> b) {
                              int cmp;
                              switch (_relationshipSortBy) {
                                case 'requester':
                                  cmp = (a['requester_company_name'] ?? a['requester_company_id'])
                                      .toString()
                                      .compareTo((b['requester_company_name'] ?? b['requester_company_id']).toString());
                                  break;
                                case 'status':
                                  cmp = (a['status'] ?? '').toString().compareTo((b['status'] ?? '').toString());
                                  break;
                                default:
                                  final ad = DateTime.tryParse(a['updated_at']?.toString() ?? '') ??
                                      DateTime.fromMillisecondsSinceEpoch(0);
                                  final bd = DateTime.tryParse(b['updated_at']?.toString() ?? '') ??
                                      DateTime.fromMillisecondsSinceEpoch(0);
                                  cmp = ad.compareTo(bd);
                              }
                              return _relationshipSortAsc ? cmp : -cmp;
                            }

                            final filteredPending = applyFilter(_incomingRelationshipRequests);
                            final filteredHistory = applyFilter(_relationshipHistory);
                            final allRows = <Map<String, dynamic>>[
                              ...filteredPending.map((r) => {...r, '_row_type': 'pending'}),
                              ...filteredHistory.map((r) => {...r, '_row_type': 'history'}),
                            ]..sort(compareRows);

                            final totalRows = allRows.length;
                            final pageCount = totalRows == 0 ? 1 : ((totalRows - 1) ~/ _relationshipPageSize) + 1;
                            final page = _relationshipPage.clamp(0, pageCount - 1);
                            final start = page * _relationshipPageSize;
                            final end = (start + _relationshipPageSize).clamp(0, totalRows);
                            final pageRows = totalRows == 0 ? const <Map<String, dynamic>>[] : allRows.sublist(start, end);
                            final exportHeaders = const ['Requester', 'Code', 'Status', 'Updated'];
                            final exportRows = allRows
                                .map(
                                  (r) => [
                                    (r['requester_company_name'] ?? r['requester_company_id']).toString(),
                                    (r['requester_company_code'] ?? '—').toString(),
                                    (r['status'] ?? 'unknown').toString(),
                                    DateTime.tryParse(r['updated_at']?.toString() ?? '') == null
                                        ? '—'
                                        : DateFormat('dd MMM y, HH:mm').format(
                                            DateTime.parse(r['updated_at'].toString()).toLocal(),
                                          ),
                                  ],
                                )
                                .toList();

                            return Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                        Row(
                          children: [
                            Text(
                              'Company relationships',
                              style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(width: 10),
                            buildExportButton(
                              context: context,
                              fileName: 'company_relationships',
                              headers: exportHeaders,
                              rows: exportRows,
                            ),
                            const Spacer(),
                            if (_incomingRelationshipRequests.isNotEmpty) ...[
                              TextButton(
                                onPressed: () async {
                                  final confirm = await showDialog<bool>(
                                    context: context,
                                    builder: (context) => AlertDialog(
                                      title: const Text('Reject all pending requests?'),
                                      content: const Text('This will reject all currently pending company link requests.'),
                                      actions: [
                                        TextButton(
                                          onPressed: () => Navigator.of(context).pop(false),
                                          child: const Text('Cancel'),
                                        ),
                                        ElevatedButton(
                                          onPressed: () => Navigator.of(context).pop(true),
                                          child: const Text('Reject all'),
                                        ),
                                      ],
                                    ),
                                  );
                                  if (confirm != true) return;
                                  var okCount = 0;
                                  for (final r in _incomingRelationshipRequests) {
                                    final ok = await _decideRelationship(r, false, silent: true);
                                    if (ok) okCount++;
                                  }
                                  if (!mounted) return;
                                  await _reload();
                                  showSuccessSnack(context, 'Rejected $okCount pending request(s).');
                                },
                                child: const Text('Reject all pending'),
                              ),
                              const SizedBox(width: 6),
                              ElevatedButton(
                                onPressed: () async {
                                  final confirm = await showDialog<bool>(
                                    context: context,
                                    builder: (context) => AlertDialog(
                                      title: const Text('Approve all pending requests?'),
                                      content: const Text('This will approve all currently pending company link requests.'),
                                      actions: [
                                        TextButton(
                                          onPressed: () => Navigator.of(context).pop(false),
                                          child: const Text('Cancel'),
                                        ),
                                        ElevatedButton(
                                          onPressed: () => Navigator.of(context).pop(true),
                                          child: const Text('Approve all'),
                                        ),
                                      ],
                                    ),
                                  );
                                  if (confirm != true) return;
                                  var okCount = 0;
                                  for (final r in _incomingRelationshipRequests) {
                                    final ok = await _decideRelationship(r, true, silent: true);
                                    if (ok) okCount++;
                                  }
                                  if (!mounted) return;
                                  await _reload();
                                  showSuccessSnack(context, 'Approved $okCount pending request(s).');
                                },
                                child: const Text('Approve all pending'),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            SizedBox(
                              width: 220,
                              child: DropdownButtonFormField<String>(
                                initialValue: _relationshipStatusFilter,
                                decoration: const InputDecoration(
                                  labelText: 'Status filter',
                                  isDense: true,
                                ),
                                items: const [
                                  DropdownMenuItem(value: 'all', child: Text('All')),
                                  DropdownMenuItem(value: 'pending', child: Text('Pending')),
                                  DropdownMenuItem(value: 'active', child: Text('Active')),
                                  DropdownMenuItem(value: 'rejected', child: Text('Rejected')),
                                  DropdownMenuItem(value: 'cancelled', child: Text('Cancelled')),
                                ],
                                onChanged: (v) {
                                  if (v == null) return;
                                  setState(() {
                                    _relationshipStatusFilter = v;
                                    _relationshipPage = 0;
                                    _syncRelationshipSessionState();
                                  });
                                },
                              ),
                            ),
                            const SizedBox(width: 10),
                            SizedBox(
                              width: 220,
                              child: DropdownButtonFormField<String>(
                                initialValue: _relationshipSortBy,
                                decoration: const InputDecoration(
                                  labelText: 'Sort by',
                                  isDense: true,
                                ),
                                items: const [
                                  DropdownMenuItem(value: 'updated', child: Text('Updated time')),
                                  DropdownMenuItem(value: 'requester', child: Text('Requester name')),
                                  DropdownMenuItem(value: 'status', child: Text('Status')),
                                ],
                                onChanged: (v) {
                                  if (v == null) return;
                                  setState(() {
                                    _relationshipSortBy = v;
                                    _syncRelationshipSessionState();
                                  });
                                },
                              ),
                            ),
                            const SizedBox(width: 10),
                            IconButton(
                              tooltip: _relationshipSortAsc ? 'Ascending' : 'Descending',
                              onPressed: () => setState(() {
                                _relationshipSortAsc = !_relationshipSortAsc;
                                _syncRelationshipSessionState();
                              }),
                              icon: Icon(_relationshipSortAsc ? Icons.arrow_upward : Icons.arrow_downward),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: TextField(
                                decoration: const InputDecoration(
                                  hintText: 'Search by company name/code',
                                  prefixIcon: Icon(Icons.search),
                                  isDense: true,
                                ),
                                onChanged: (v) => setState(() {
                                  _relationshipSearch = v.trim().toLowerCase();
                                  _relationshipPage = 0;
                                  _syncRelationshipSessionState();
                                }),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        if (totalRows == 0)
                          Text(
                            'No relationship requests or history yet.',
                            style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                          )
                        else
                          SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: DataTable(
                              columns: const [
                                DataColumn(label: Text('Requester')),
                                DataColumn(label: Text('Code')),
                                DataColumn(label: Text('Status')),
                                DataColumn(label: Text('Updated')),
                                DataColumn(label: Text('Actions')),
                              ],
                              rows: [
                                ...pageRows.map(
                                  (r) => DataRow(
                                    cells: [
                                      DataCell(Text((r['requester_company_name'] ?? r['requester_company_id']).toString())),
                                      DataCell(Text((r['requester_company_code'] ?? '—').toString())),
                                      DataCell(Text((r['status'] ?? 'pending').toString())),
                                      DataCell(
                                        Text(
                                          DateTime.tryParse(r['updated_at']?.toString() ?? '') == null
                                              ? '—'
                                              : DateFormat('dd MMM y, HH:mm').format(
                                                  DateTime.parse(r['updated_at'].toString()).toLocal(),
                                                ),
                                        ),
                                      ),
                                      DataCell(
                                        Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            TextButton(
                                              onPressed: () async {
                                                final code = (r['requester_company_code'] ?? '').toString();
                                                if (code.isEmpty || code == '—') return;
                                                await Clipboard.setData(ClipboardData(text: code));
                                                if (!mounted) return;
                                                showSuccessSnack(context, 'Requester code copied.');
                                              },
                                              child: const Text('Copy code'),
                                            ),
                                            if (r['_row_type'] == 'pending') ...[
                                              TextButton(
                                                onPressed: () => _decideRelationship(r, false),
                                                child: const Text('Reject'),
                                              ),
                                              ElevatedButton(
                                                onPressed: () => _decideRelationship(r, true),
                                                child: const Text('Approve'),
                                              ),
                                            ],
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            Text(
                              'Showing ${totalRows == 0 ? 0 : (start + 1)}-${totalRows == 0 ? 0 : end} of $totalRows',
                              style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFF6B7280)),
                            ),
                            const Spacer(),
                            TextButton(
                              onPressed: page <= 0
                                  ? null
                                  : () => setState(() {
                                        _relationshipPage = page - 1;
                                        _syncRelationshipSessionState();
                                      }),
                              child: const Text('Previous'),
                            ),
                            Text(
                              'Page ${page + 1}/$pageCount',
                              style: GoogleFonts.poppins(fontSize: 11),
                            ),
                            TextButton(
                              onPressed: page >= pageCount - 1
                                  ? null
                                  : () => setState(() {
                                        _relationshipPage = page + 1;
                                        _syncRelationshipSessionState();
                                      }),
                              child: const Text('Next'),
                            ),
                          ],
                        ),
                              ],
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 14),
              if (_activeTab == 'activity')
                Card(
                color: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: _activityContractorFilter,
                        decoration: const InputDecoration(
                          labelText: 'View contractor activity',
                          isDense: true,
                        ),
                        items: [
                          const DropdownMenuItem(value: 'all', child: Text('All contractors')),
                          ..._rows.map((r) => DropdownMenuItem(
                                value: r.employee.id,
                                child: Text(r.employee.fullName),
                              )),
                        ],
                        onChanged: (v) {
                          if (v == null) return;
                          setState(() => _activityContractorFilter = v);
                        },
                      ),
                      const SizedBox(height: 10),
                      if (_activityContractorFilter != 'all')
                        FutureBuilder<double?>(
                          future: () async {
                            final cacheKey =
                                '${_activityContractorFilter}_${_rangeStart.toIso8601String()}_${_rangeEnd.toIso8601String()}';
                            if (_feedbackAverageCache.containsKey(cacheKey)) {
                              return _feedbackAverageCache[cacheKey];
                            }
                            final contractorJobs = jobsForContractorInRange(_activityContractorFilter);
                            if (contractorJobs.isEmpty) {
                              _feedbackAverageCache[cacheKey] = null;
                              return null;
                            }
                            final feedbackRows = await Future.wait(
                              contractorJobs.map(
                                (j) => SupabaseTimesheetStorage.getJobFeedback(
                                  companyId: companyId,
                                  jobId: j.id,
                                ),
                              ),
                            );
                            final ratings = feedbackRows
                                .map((f) => (f?['rating_1_to_5'] as num?)?.toDouble())
                                .whereType<double>()
                                .toList();
                            if (ratings.isEmpty) {
                              _feedbackAverageCache[cacheKey] = null;
                              return null;
                            }
                            final avg = ratings.reduce((a, b) => a + b) / ratings.length;
                            _feedbackAverageCache[cacheKey] = avg;
                            return avg;
                          }(),
                          builder: (context, avgSnap) {
                            final contractorJobs = jobsForContractorInRange(_activityContractorFilter);
                            final dealIds = contractorJobs.map((j) => j.dealId).whereType<String>().toSet();
                            final dealValue = _deals
                                .where((d) => dealIds.contains(d['id']?.toString()))
                                .fold<double>(0, (s, d) => s + (((d['offer_amount'] as num?)?.toDouble()) ?? 0));
                            final incidentsCount = _incidents
                                .where((i) => i.jobId != null && contractorJobs.any((j) => j.id == i.jobId))
                                .length;
                            final selectedSummary = _rows.where((r) => r.employee.id == _activityContractorFilter).toList();
                            final payoutDue = selectedSummary.fold<double>(0, (sum, r) {
                              final a = approvalsByEmp[r.employee.id];
                              return sum + (a?.editedAmount ?? r.paymentDue);
                            });
                            final payoutApproved = selectedSummary.fold<double>(0, (sum, r) {
                              final a = approvalsByEmp[r.employee.id];
                              final status = a?.status ?? (a?.approved == true ? 'approved' : 'pending');
                              if (status == 'approved' || status == 'partial') {
                                return sum + (a?.editedAmount ?? r.paymentDue);
                              }
                              return sum;
                            });
                            final outstanding = (payoutDue - payoutApproved).clamp(0, double.infinity);
                            final avgFeedback = avgSnap.data;
                            final selectedName = _rows
                                .where((r) => r.employee.id == _activityContractorFilter)
                                .map((r) => r.employee.fullName)
                                .cast<String?>()
                                .firstWhere((_) => true, orElse: () => 'Selected contractor');
                            final reportHeaders = const ['Metric', 'Value'];
                            final reportRows = [
                              ['Contractor', selectedName ?? 'Selected contractor'],
                              ['Jobs in period', '${contractorJobs.length}'],
                              ['Linked deal value', 'R ${dealValue.toStringAsFixed(2)}'],
                              ['Payout approved', 'R ${payoutApproved.toStringAsFixed(2)}'],
                              ['Payout outstanding', 'R ${outstanding.toStringAsFixed(2)}'],
                              ['Incidents', '$incidentsCount'],
                              ['Feedback avg', avgFeedback == null ? '—' : '${avgFeedback.toStringAsFixed(1)} / 5'],
                            ];
                            return Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    _MetricCard(label: 'Jobs in period', value: '${contractorJobs.length}'),
                                    _MetricCard(label: 'Deal value', value: 'R ${dealValue.toStringAsFixed(2)}'),
                                    _MetricCard(label: 'Payout approved', value: 'R ${payoutApproved.toStringAsFixed(2)}'),
                                    _MetricCard(label: 'Outstanding', value: 'R ${outstanding.toStringAsFixed(2)}'),
                                    _MetricCard(label: 'Incidents', value: '$incidentsCount'),
                                    _MetricCard(
                                      label: 'Feedback avg',
                                      value: avgFeedback == null ? '—' : '${avgFeedback.toStringAsFixed(1)} / 5',
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                buildExportButton(
                                  context: context,
                                  fileName:
                                      'contractor_report_${DateFormat('yyyyMMdd').format(_rangeStart)}_${DateFormat('yyyyMMdd').format(_rangeEnd)}',
                                  headers: reportHeaders,
                                  rows: reportRows,
                                ),
                                const SizedBox(height: 10),
                              ],
                            );
                          },
                        ),
                      if (_activityContractorFilter != 'all') const SizedBox(height: 4),
                      _loading
                      ? const Padding(
                          padding: EdgeInsets.all(24),
                          child: Center(child: CircularProgressIndicator(color: AppTheme.gold)),
                        )
                      : rowsForView.isEmpty
                          ? Padding(
                              padding: const EdgeInsets.all(20),
                              child: Text(
                                'No contractor activity in this period.',
                                style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                              ),
                            )
                          : SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: DataTable(
                                columnSpacing: isCompact ? 12 : 20,
                                headingRowHeight: isCompact ? 40 : 52,
                                dataRowMinHeight: isCompact ? 36 : 44,
                                dataRowMaxHeight: isCompact ? 52 : 58,
                                columns: const [
                                  DataColumn(label: Text('Contractor')),
                                  DataColumn(label: Text('Type')),
                                  DataColumn(label: Text('Total hrs')),
                                  DataColumn(label: Text('Overtime')),
                                  DataColumn(label: Text('Jobs')),
                                  DataColumn(label: Text('Payment due')),
                                  DataColumn(label: Text('Status')),
                                  DataColumn(label: Text('Actions')),
                                ],
                                rows: rowsForView.map((r) {
                                  final a = approvalsByEmp[r.employee.id];
                                  final finalAmt = a?.editedAmount ?? r.paymentDue;
                                  final status = (a?.status ?? (a?.approved == true ? 'approved' : 'pending'));
                                  final approved = status == 'approved';
                                  return DataRow(cells: [
                                    DataCell(Text(r.employee.fullName)),
                                    DataCell(Text(r.employee.workerType.label)),
                                    DataCell(Text(r.totalHours.toStringAsFixed(1))),
                                    DataCell(Text(r.overtimeHours.toStringAsFixed(1))),
                                    DataCell(Text('${jobsForEmployee(r.employee.id)}')),
                                    DataCell(Text('R ${finalAmt.toStringAsFixed(2)}')),
                                    DataCell(Text(status)),
                                    DataCell(
                                      Wrap(
                                        spacing: 4,
                                        children: [
                                          IconButton(
                                            tooltip: 'Approve',
                                            onPressed: approved
                                                ? null
                                                : () => _setApproval(
                                                      employee: r.employee,
                                                      periodStart: _rangeStart,
                                                              status: 'approved',
                                                      editedAmount: a?.editedAmount,
                                                    ),
                                            icon: const Icon(Icons.check_circle_outline, size: 18, color: Color(0xFF059669)),
                                          ),
                                          IconButton(
                                            tooltip: 'Decline',
                                            onPressed: () async {
                                              final noteCtrl = TextEditingController();
                                              final ok = await showDialog<bool>(
                                                context: context,
                                                builder: (context) => AlertDialog(
                                                  title: const Text('Decline payment'),
                                                  content: TextField(
                                                    controller: noteCtrl,
                                                    maxLines: 3,
                                                    decoration: const InputDecoration(
                                                      labelText: 'Reason (optional)',
                                                    ),
                                                  ),
                                                  actions: [
                                                    TextButton(
                                                      onPressed: () => Navigator.of(context).pop(false),
                                                      child: const Text('Cancel'),
                                                    ),
                                                    ElevatedButton(
                                                      onPressed: () => Navigator.of(context).pop(true),
                                                      child: const Text('Decline'),
                                                    ),
                                                  ],
                                                ),
                                              );
                                              if (ok != true) return;
                                              await _setApproval(
                                                employee: r.employee,
                                                periodStart: _rangeStart,
                                                status: 'declined',
                                                editedAmount: a?.editedAmount,
                                                decisionNote: noteCtrl.text.trim().isEmpty
                                                    ? null
                                                    : noteCtrl.text.trim(),
                                              );
                                            },
                                            icon: const Icon(Icons.cancel_outlined, size: 18, color: Color(0xFFB45309)),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ]);
                                }).toList(),
                              ),
                            ),
                    ],
                  ),
                ),
              ),
            ],
              ),
            ),
            Positioned(
              right: 16,
              bottom: 16,
              child: FloatingActionButton.extended(
                onPressed: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const HrCreateEmployeeScreen(
                        initialWorkerType: WorkerType.contractor,
                      ),
                    ),
                  );
                  if (!mounted) return;
                  await context.read<TimesheetProvider>().loadEmployees();
                  await _reload();
                },
                backgroundColor: AppTheme.gold,
                foregroundColor: AppTheme.black,
                icon: const Icon(Icons.add),
                label: const Text('Add contractor'),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildLinkedCompanyStatusChip(String? rawStatus) {
    final status = (rawStatus ?? 'unlinked').toLowerCase();
    final (label, fg, bg) = switch (status) {
      'linked' => ('Linked', const Color(0xFF065F46), const Color(0xFFD1FAE5)),
      'pending' => ('Pending', const Color(0xFF92400E), const Color(0xFFFEF3C7)),
      'rejected' => ('Rejected', const Color(0xFF991B1B), const Color(0xFFFEE2E2)),
      _ => ('Unlinked', const Color(0xFF475569), const Color(0xFFE2E8F0)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: GoogleFonts.poppins(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: fg,
        ),
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
      width: 200,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFF6B7280))),
          const SizedBox(height: 4),
          Text(value, style: GoogleFonts.poppins(fontSize: 20, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}
