import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../models/employee.dart';
import '../models/work_team.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';

class HrWorkTeamsScreen extends StatefulWidget {
  const HrWorkTeamsScreen({super.key});

  @override
  State<HrWorkTeamsScreen> createState() => _HrWorkTeamsScreenState();
}

class _HrWorkTeamsScreenState extends State<HrWorkTeamsScreen> {
  int _listKey = 0;

  Future<void> _createTeam() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final ctrl = TextEditingController();
    final name = await showDialog<String?>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New work team'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Team name',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, ctrl.text.trim()),
            child: const Text('Create'),
          ),
        ],
      ),
    );
    ctrl.dispose();
    if (name == null || name.isEmpty || !mounted) return;
    try {
      final id = await SupabaseTimesheetStorage.createWorkTeam(companyId: companyId, name: name);
      if (id == null) {
        if (mounted) showErrorSnack(context, 'Could not create team.');
        return;
      }
      if (mounted) {
        setState(() => _listKey++);
        showSuccessSnack(context, 'Team created.');
      }
    } catch (e) {
      if (mounted) {
        showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not create team.'));
      }
    }
  }

  Future<void> _addMember(WorkTeam team, List<Employee> allEmployees) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final existing = await SupabaseTimesheetStorage.getWorkTeamMemberEmployeeIds(
      teamId: team.id,
      companyId: companyId,
    );
    final existingSet = existing.toSet();
    final candidates = allEmployees.where((e) => !existingSet.contains(e.id)).toList();
    if (candidates.isEmpty) {
      if (mounted) showInfoSnack(context, 'Everyone is already in this team.');
      return;
    }
    await showDialog<void>(
      context: context,
      builder: (context) {
        String? pick = candidates.first.id;
        return StatefulBuilder(
          builder: (context, setLocal) => AlertDialog(
            title: Text('Add to ${team.name}'),
            content: DropdownButtonFormField<String>(
              value: pick,
              items: candidates
                  .map((e) => DropdownMenuItem<String>(value: e.id, child: Text(e.fullName)))
                  .toList(),
              onChanged: (v) => setLocal(() => pick = v),
              decoration: const InputDecoration(labelText: 'Employee'),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
              FilledButton(
                onPressed: () async {
                  final id = pick;
                  Navigator.pop(context);
                  if (id == null) return;
                  try {
                    await SupabaseTimesheetStorage.addEmployeeToWorkTeam(
                      companyId: companyId,
                      teamId: team.id,
                      employeeId: id,
                    );
                    if (mounted) {
                      setState(() => _listKey++);
                      showSuccessSnack(context, 'Member added.');
                    }
                  } catch (e) {
                    if (mounted) {
                      showErrorSnack(
                        context,
                        friendlyErrorMessage(e, fallback: 'Could not add member.'),
                      );
                    }
                  }
                },
                child: const Text('Add'),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _removeMember(WorkTeam team, String employeeId, String label) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove from team?'),
        content: Text('Remove $label from ${team.name}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Remove')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await SupabaseTimesheetStorage.removeEmployeeFromWorkTeam(
        companyId: companyId,
        teamId: team.id,
        employeeId: employeeId,
      );
      if (mounted) setState(() => _listKey++);
    } catch (e) {
      if (mounted) {
        showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not remove member.'));
      }
    }
  }

  Future<void> _deleteTeam(WorkTeam team) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete team?'),
        content: Text('Delete "${team.name}" and all member links?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await SupabaseTimesheetStorage.deleteWorkTeam(teamId: team.id, companyId: companyId);
      if (mounted) {
        setState(() => _listKey++);
        showSuccessSnack(context, 'Team deleted.');
      }
    } catch (e) {
      if (mounted) {
        showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not delete team.'));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final companyId = context.watch<TimesheetProvider>().currentCompanyId;
    final employees = context.watch<TimesheetProvider>().employees;
    if (companyId == null) {
      return const Scaffold(body: Center(child: Text('No company.')));
    }
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text('Work teams', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
        leading: const BackButton(color: AppTheme.gold),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _createTeam,
        backgroundColor: AppTheme.gold,
        foregroundColor: Colors.white,
        child: const Icon(Icons.add),
      ),
      body: FutureBuilder<List<WorkTeam>>(
        key: ValueKey(_listKey),
        future: SupabaseTimesheetStorage.getWorkTeams(companyId: companyId),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return LoadErrorPanel(
              message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load teams.'),
              onRetry: () => setState(() => _listKey++),
            );
          }
          if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
            return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
          }
          final teams = snapshot.data ?? const <WorkTeam>[];
          if (teams.isEmpty) {
            return Center(
              child: Text(
                'No teams yet. Tap + to create one.',
                style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
              ),
            );
          }
          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: teams.length,
            itemBuilder: (context, i) {
              final t = teams[i];
              return Card(
                margin: const EdgeInsets.only(bottom: 10),
                elevation: 2,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: const BorderSide(color: Color(0xFFE5E7EB)),
                ),
                child: ExpansionTile(
                  title: Row(
                    children: [
                      Expanded(
                        child: Text(t.name, style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
                      ),
                      IconButton(
                        tooltip: 'Add member',
                        icon: const Icon(Icons.person_add_alt_1, size: 20),
                        onPressed: () => _addMember(t, employees),
                      ),
                      IconButton(
                        tooltip: 'Delete team',
                        icon: const Icon(Icons.delete_outline, size: 20, color: Color(0xFFDC2626)),
                        onPressed: () => _deleteTeam(t),
                      ),
                    ],
                  ),
                  children: [
                    FutureBuilder<List<String>>(
                      future: SupabaseTimesheetStorage.getWorkTeamMemberEmployeeIds(
                        teamId: t.id,
                        companyId: companyId,
                      ),
                      builder: (context, memSnap) {
                        if (memSnap.connectionState == ConnectionState.waiting) {
                          return const Padding(
                            padding: EdgeInsets.all(12),
                            child: LinearProgressIndicator(color: AppTheme.gold),
                          );
                        }
                        final ids = memSnap.data ?? const <String>[];
                        if (ids.isEmpty) {
                          return Padding(
                            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                            child: Text(
                              'No members yet.',
                              style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF6B7280)),
                            ),
                          );
                        }
                        final byId = {for (final e in employees) e.id: e};
                        return Padding(
                          padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
                          child: Column(
                            children: ids.map((id) {
                              final e = byId[id];
                              final label = e?.fullName ?? id;
                              return ListTile(
                                dense: true,
                                title: Text(label, style: GoogleFonts.poppins(fontSize: 13)),
                                trailing: IconButton(
                                  icon: const Icon(Icons.close, size: 18),
                                  onPressed: () => _removeMember(t, id, label),
                                ),
                              );
                            }).toList(),
                          ),
                        );
                      },
                    ),
                  ],
                ),
              );
            },
          );
        },
      ),
    );
  }
}
