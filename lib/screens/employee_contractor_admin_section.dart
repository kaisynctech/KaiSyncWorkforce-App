import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../models/employee.dart';
import '../models/contractor_member_link.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import '_dashboard_decorators.dart';

class EmployeeContractorAdminSection extends StatefulWidget {
  const EmployeeContractorAdminSection({super.key});

  @override
  State<EmployeeContractorAdminSection> createState() => _EmployeeContractorAdminSectionState();
}

class _EmployeeContractorAdminSectionState extends State<EmployeeContractorAdminSection> {
  Future<Map<String, dynamic>> _load() async {
    final prov = context.read<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final employeeId = prov.currentEmployee?.id;
    if (companyId == null || employeeId == null) {
      return const {'context': null, 'members': <ContractorMemberLink>[], 'events': <Map<String, dynamic>>[]};
    }
    final ctx = await SupabaseTimesheetStorage.getMyContractorAdminContext(
      companyId: companyId,
      employeeId: employeeId,
    );
    if (ctx == null || ctx['contractor_id'] == null) {
      return const {'context': null, 'members': <ContractorMemberLink>[], 'events': <Map<String, dynamic>>[]};
    }
    final contractorId = ctx['contractor_id'].toString();
    final membersByContractor = await SupabaseTimesheetStorage.getContractorMembersByContractor(companyId: companyId);
    final members = membersByContractor[contractorId] ?? const <ContractorMemberLink>[];
    final events = await SupabaseTimesheetStorage.getContractorAdminEvents(
      companyId: companyId,
      contractorId: contractorId,
      limit: 20,
    );
    return {
      'context': ctx,
      'members': members,
      'events': events,
    };
  }

  Future<void> _toggleVisibility(String contractorId, bool value) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    await SupabaseTimesheetStorage.updateContractorVisibility(
      companyId: companyId,
      contractorId: contractorId,
      allowMembersViewAllJobs: value,
    );
    final actorEmployeeId = context.read<TimesheetProvider>().currentEmployee?.id;
    if (actorEmployeeId != null) {
      await SupabaseTimesheetStorage.insertContractorAdminEvent(
        companyId: companyId,
        contractorId: contractorId,
        actorEmployeeId: actorEmployeeId,
        eventType: 'visibility_changed',
        details: {'allow_members_view_all_jobs': value},
      );
    }
    if (!mounted) return;
    showSuccessSnack(context, 'Visibility rule updated.');
    setState(() {});
  }

  Future<void> _saveMembers({
    required String companyId,
    required String contractorId,
    required List<ContractorMemberLink> members,
    String eventType = 'members_updated',
    Map<String, dynamic> eventDetails = const {},
  }) async {
    if (members.isNotEmpty && !members.any((m) => m.isPrimary)) {
      showInfoSnack(context, 'At least one primary lead is required.');
      return;
    }
    await SupabaseTimesheetStorage.setContractorMembersDetailed(
      companyId: companyId,
      contractorId: contractorId,
      members: members,
    );
    final actorEmployeeId = context.read<TimesheetProvider>().currentEmployee?.id;
    if (actorEmployeeId != null) {
      await SupabaseTimesheetStorage.insertContractorAdminEvent(
        companyId: companyId,
        contractorId: contractorId,
        actorEmployeeId: actorEmployeeId,
        eventType: eventType,
        details: {
          'member_count': members.length,
          ...eventDetails,
        },
      );
    }
    if (!mounted) return;
    showSuccessSnack(context, 'Members updated.');
    setState(() {});
  }

  Future<void> _addExistingMember({
    required String companyId,
    required String contractorId,
    required List<ContractorMemberLink> current,
    required List<Employee> employees,
  }) async {
    final linked = current.map((m) => m.employeeId).toSet();
    final candidates = employees
        .where((e) => e.workerType == WorkerType.contractor || e.workerType == WorkerType.subcontractor)
        .where((e) => !linked.contains(e.id))
        .toList();
    if (candidates.isEmpty) {
      showInfoSnack(context, 'No unlinked contractor members available.');
      return;
    }
    String selectedId = candidates.first.id;
    String role = 'member';
    bool isPrimary = false;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Link existing member'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: selectedId,
                  decoration: const InputDecoration(labelText: 'Member'),
                  items: candidates
                      .map((e) => DropdownMenuItem<String>(value: e.id, child: Text(e.fullName)))
                      .toList(),
                  onChanged: (v) {
                    if (v != null) setLocal(() => selectedId = v);
                  },
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: role,
                  decoration: const InputDecoration(labelText: 'Role'),
                  items: const [
                    DropdownMenuItem(value: 'owner', child: Text('Owner')),
                    DropdownMenuItem(value: 'manager', child: Text('Manager')),
                    DropdownMenuItem(value: 'member', child: Text('Member')),
                  ],
                  onChanged: (v) {
                    if (v != null) setLocal(() => role = v);
                  },
                ),
                SwitchListTile.adaptive(
                  value: isPrimary,
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Primary lead'),
                  onChanged: (v) => setLocal(() => isPrimary = v),
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
    final updated = [
      ...current,
      ContractorMemberLink(
        contractorId: contractorId,
        employeeId: selectedId,
        roleLabel: role,
        isPrimary: isPrimary,
      ),
    ];
    await _saveMembers(
      companyId: companyId,
      contractorId: contractorId,
      members: updated,
      eventType: 'member_linked',
      eventDetails: {'linked_employee_id': selectedId, 'role': role, 'is_primary': isPrimary},
    );
  }

  Future<void> _createAndLinkMember({
    required String companyId,
    required String contractorId,
    required List<ContractorMemberLink> current,
  }) async {
    final nameCtrl = TextEditingController();
    final surnameCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    WorkerType workerType = WorkerType.contractor;
    String role = 'member';
    bool isPrimary = false;

    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Create contractor member'),
          content: SizedBox(
            width: 460,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name *')),
                  const SizedBox(height: 8),
                  TextField(controller: surnameCtrl, decoration: const InputDecoration(labelText: 'Surname *')),
                  const SizedBox(height: 8),
                  TextField(
                    controller: emailCtrl,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Email (optional)'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: phoneCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Phone (optional)'),
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<WorkerType>(
                    initialValue: workerType,
                    decoration: const InputDecoration(labelText: 'Member type'),
                    items: const [
                      DropdownMenuItem(value: WorkerType.contractor, child: Text('Contractor member')),
                      DropdownMenuItem(value: WorkerType.subcontractor, child: Text('Subcontractor member')),
                    ],
                    onChanged: (v) {
                      if (v != null) setLocal(() => workerType = v);
                    },
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: role,
                    decoration: const InputDecoration(labelText: 'Role'),
                    items: const [
                      DropdownMenuItem(value: 'owner', child: Text('Owner')),
                      DropdownMenuItem(value: 'manager', child: Text('Manager')),
                      DropdownMenuItem(value: 'member', child: Text('Member')),
                    ],
                    onChanged: (v) {
                      if (v != null) setLocal(() => role = v);
                    },
                  ),
                  SwitchListTile.adaptive(
                    value: isPrimary,
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Primary lead'),
                    onChanged: (v) => setLocal(() => isPrimary = v),
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
    if (ok != true) return;
    final name = nameCtrl.text.trim();
    final surname = surnameCtrl.text.trim();
    final email = emailCtrl.text.trim().toLowerCase();
    final phone = phoneCtrl.text.trim();
    if (name.isEmpty || surname.isEmpty) {
      showInfoSnack(context, 'Name and surname are required.');
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
    if (memberId == null) {
      showErrorSnack(context, 'Could not create member.');
      return;
    }
    final updated = [
      ...current,
      ContractorMemberLink(
        contractorId: contractorId,
        employeeId: memberId,
        roleLabel: role,
        isPrimary: isPrimary,
      ),
    ];
    await _saveMembers(
      companyId: companyId,
      contractorId: contractorId,
      members: updated,
      eventType: 'member_created_and_linked',
      eventDetails: {'linked_employee_id': memberId, 'role': role, 'is_primary': isPrimary},
    );
    await context.read<TimesheetProvider>().loadEmployees();
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final employeesById = {for (final e in prov.employees) e.id: e};
    return FutureBuilder<Map<String, dynamic>>(
      future: _load(),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load contractor admin data.'),
            onRetry: () => setState(() {}),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final data = snapshot.data ??
            const {
              'context': null,
              'members': <ContractorMemberLink>[],
              'events': <Map<String, dynamic>>[],
            };
        final ctx = data['context'] as Map<String, dynamic>?;
        final members = (data['members'] as List?)?.cast<ContractorMemberLink>() ?? const <ContractorMemberLink>[];
        final events = (data['events'] as List?)?.cast<Map<String, dynamic>>() ?? const <Map<String, dynamic>>[];
        if (ctx == null) {
          return Center(
            child: Text(
              'No contractor admin profile linked to your account.',
              style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
            ),
          );
        }
        final contractorId = ctx['contractor_id']?.toString() ?? '';
        final contractorName = ctx['contractor_name']?.toString() ?? 'Contractor';
        final role = (ctx['role_label']?.toString() ?? 'member').toLowerCase();
        final isPrimary = ctx['is_primary'] == true;
        final canManage = isPrimary || role == 'owner' || role == 'manager' || role == 'lead';
        final allowAll = ctx['allow_members_view_all_jobs'] == true;
        final companyId = prov.currentCompanyId ?? '';
        final mutableMembers = [...members];

        return SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Contractor Admin',
                style: GoogleFonts.poppins(fontSize: 20, fontWeight: FontWeight.w600, color: const Color(0xFF111827)),
              ),
              const SizedBox(height: 8),
              Text(
                '$contractorName • Role: ${role.toUpperCase()}',
                style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
              ),
              const SizedBox(height: 12),
              Card(
                child: SwitchListTile.adaptive(
                  value: allowAll,
                  onChanged: !canManage ? null : (v) => _toggleVisibility(contractorId, v),
                  title: const Text('Members can view all contractor jobs'),
                  subtitle: const Text('Turn off for assignment-only visibility.'),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Members',
                style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: const Color(0xFF111827)),
              ),
              const SizedBox(height: 8),
              if (canManage)
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: () => _addExistingMember(
                        companyId: companyId,
                        contractorId: contractorId,
                        current: mutableMembers,
                        employees: prov.employees,
                      ),
                      icon: const Icon(Icons.link_outlined, size: 16),
                      label: const Text('Link existing'),
                    ),
                    OutlinedButton.icon(
                      onPressed: () => _createAndLinkMember(
                        companyId: companyId,
                        contractorId: contractorId,
                        current: mutableMembers,
                      ),
                      icon: const Icon(Icons.person_add_alt_1_outlined, size: 16),
                      label: const Text('Create member'),
                    ),
                  ],
                ),
              if (canManage) const SizedBox(height: 8),
              Card(
                child: members.isEmpty
                    ? Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text('No members found.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280))),
                      )
                    : Column(
                        children: mutableMembers.map((m) {
                          final emp = employeesById[m.employeeId];
                          final name = emp?.fullName ?? 'Member #${m.employeeId}';
                          final subtitleParts = [
                            if ((m.roleLabel ?? '').trim().isNotEmpty) 'role: ${m.roleLabel}',
                            if (m.isPrimary) 'primary',
                          ];
                          return ListTile(
                            leading: const Icon(Icons.person_outline),
                            title: Text(name, style: GoogleFonts.poppins(fontSize: 13)),
                            subtitle: Text(
                              subtitleParts.isEmpty ? 'role: member' : subtitleParts.join(' • '),
                              style: GoogleFonts.poppins(fontSize: 11),
                            ),
                            trailing: !canManage
                                ? null
                                : Wrap(
                                    spacing: 6,
                                    children: [
                                      TextButton(
                                        onPressed: () async {
                                          String role = (m.roleLabel ?? 'member').toLowerCase();
                                          bool primary = m.isPrimary;
                                          final ok = await showDialog<bool>(
                                            context: context,
                                            builder: (context) => StatefulBuilder(
                                              builder: (context, setLocal) => AlertDialog(
                                                title: Text('Edit $name'),
                                                content: Column(
                                                  mainAxisSize: MainAxisSize.min,
                                                  children: [
                                                    DropdownButtonFormField<String>(
                                                      initialValue: role == 'owner' || role == 'manager' ? role : 'member',
                                                      decoration: const InputDecoration(labelText: 'Role'),
                                                      items: const [
                                                        DropdownMenuItem(value: 'owner', child: Text('Owner')),
                                                        DropdownMenuItem(value: 'manager', child: Text('Manager')),
                                                        DropdownMenuItem(value: 'member', child: Text('Member')),
                                                      ],
                                                      onChanged: (v) {
                                                        if (v != null) setLocal(() => role = v);
                                                      },
                                                    ),
                                                    SwitchListTile.adaptive(
                                                      value: primary,
                                                      contentPadding: EdgeInsets.zero,
                                                      title: const Text('Primary lead'),
                                                      onChanged: (v) => setLocal(() => primary = v),
                                                    ),
                                                  ],
                                                ),
                                                actions: [
                                                  TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
                                                  ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Save')),
                                                ],
                                              ),
                                            ),
                                          );
                                          if (ok != true) return;
                                          final updated = mutableMembers
                                              .map(
                                                (x) => x.employeeId == m.employeeId
                                                    ? ContractorMemberLink(
                                                        contractorId: contractorId,
                                                        employeeId: x.employeeId,
                                                        roleLabel: role,
                                                        isPrimary: primary,
                                                      )
                                                    : x,
                                              )
                                              .toList();
                                          await _saveMembers(
                                            companyId: companyId,
                                            contractorId: contractorId,
                                            members: updated,
                                            eventType: 'member_role_updated',
                                            eventDetails: {
                                              'target_employee_id': m.employeeId,
                                              'role': role,
                                              'is_primary': primary,
                                            },
                                          );
                                        },
                                        child: const Text('Edit'),
                                      ),
                                      TextButton(
                                        onPressed: () async {
                                          final meId = prov.currentEmployee?.id;
                                          final meRole = role;
                                          final mePrimary = m.isPrimary;
                                          final managerCount = mutableMembers.where((x) {
                                            final r = (x.roleLabel ?? 'member').toLowerCase();
                                            return x.isPrimary || r == 'owner' || r == 'manager' || r == 'lead';
                                          }).length;
                                          final thisIsManager =
                                              mePrimary || meRole == 'owner' || meRole == 'manager' || meRole == 'lead';
                                          if (meId != null && m.employeeId == meId && thisIsManager && managerCount <= 1) {
                                            showInfoSnack(
                                              context,
                                              'You cannot unlink yourself as the last contractor manager/primary.',
                                            );
                                            return;
                                          }
                                          final updated = mutableMembers.where((x) => x.employeeId != m.employeeId).toList();
                                          await _saveMembers(
                                            companyId: companyId,
                                            contractorId: contractorId,
                                            members: updated,
                                            eventType: 'member_unlinked',
                                            eventDetails: {'target_employee_id': m.employeeId},
                                          );
                                        },
                                        child: const Text('Unlink'),
                                      ),
                                    ],
                                  ),
                          );
                        }).toList(),
                      ),
              ),
              const SizedBox(height: 12),
              Text(
                'Audit trail',
                style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: const Color(0xFF111827)),
              ),
              const SizedBox(height: 8),
              buildExportButton(
                context: context,
                fileName: 'contractor_admin_audit',
                headers: const ['Event', 'Timestamp', 'Actor', 'Details'],
                rows: events.map((e) {
                  final ts = DateTime.tryParse(e['created_at']?.toString() ?? '');
                  final actorId = e['actor_employee_id']?.toString();
                  final actor = actorId == null ? null : employeesById[actorId];
                  final actorName = actor?.fullName ?? '—';
                  final details = (e['details'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
                  final detailText = details.entries.map((kv) => '${kv.key}: ${kv.value}').join(' • ');
                  return [
                    (e['event_type'] ?? 'event').toString(),
                    ts == null ? '—' : ts.toLocal().toString(),
                    actorName,
                    detailText,
                  ];
                }).toList(),
              ),
              const SizedBox(height: 8),
              Card(
                child: events.isEmpty
                    ? Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text('No audit events yet.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280))),
                      )
                    : Column(
                        children: events.map((e) {
                          final eventType = (e['event_type'] ?? 'event').toString();
                          final ts = DateTime.tryParse(e['created_at']?.toString() ?? '');
                          final actorId = e['actor_employee_id']?.toString();
                          final actor = actorId == null ? null : employeesById[actorId];
                          final actorName = actor?.fullName;
                          final actorRole = actor == null ? null : '${actor.workerType.label}/${actor.accessLevel.name}';
                          final details = (e['details'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
                          final targetId = details['target_employee_id']?.toString();
                          final targetName = targetId == null ? null : employeesById[targetId]?.fullName;
                          final effectiveDetails = Map<String, dynamic>.from(details);
                          if (targetName != null) effectiveDetails['target_member_name'] = targetName;
                          final detailText = effectiveDetails.entries.map((kv) => '${kv.key}: ${kv.value}').join(' • ');
                          return ListTile(
                            leading: const Icon(Icons.history_outlined),
                            title: Text(eventType, style: GoogleFonts.poppins(fontSize: 12)),
                            subtitle: Text(
                              [
                                if (ts != null) ts.toLocal().toString(),
                                if (actorName != null) 'actor: $actorName',
                                if (actorRole != null) 'actor role: $actorRole',
                                if (detailText.isNotEmpty) detailText,
                              ].join('\n'),
                              style: GoogleFonts.poppins(fontSize: 11),
                            ),
                          );
                        }).toList(),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
