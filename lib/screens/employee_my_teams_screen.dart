import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../models/work_team.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/load_error_panel.dart';

/// Lists teams the signed-in employee belongs to (RLS on `work_team_members`).
class EmployeeMyTeamsScreen extends StatefulWidget {
  const EmployeeMyTeamsScreen({super.key});

  @override
  State<EmployeeMyTeamsScreen> createState() => _EmployeeMyTeamsScreenState();
}

class _EmployeeMyTeamsScreenState extends State<EmployeeMyTeamsScreen> {
  int _reloadKey = 0;

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final me = prov.currentEmployee;
    if (companyId == null || me == null) {
      return const Center(child: Text('No company context.'));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text(
            'Teams',
            style: GoogleFonts.poppins(
              fontSize: 20,
              fontWeight: FontWeight.w600,
              color: const Color(0xFF111827),
            ),
          ),
        ),
        Expanded(
          child: FutureBuilder<List<WorkTeam>>(
            key: ValueKey(_reloadKey),
            future: SupabaseTimesheetStorage.getWorkTeamsForEmployee(
              companyId: companyId,
              employeeId: me.id,
            ),
            builder: (context, snapshot) {
              if (snapshot.hasError) {
                return LoadErrorPanel(
                  message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load teams.'),
                  onRetry: () => setState(() => _reloadKey++),
                );
              }
              if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
                return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
              }
              final teams = snapshot.data ?? const <WorkTeam>[];
              if (teams.isEmpty) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'You are not in any work teams yet.\nHR can add you under Employees → Work teams.',
                      style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 13),
                      textAlign: TextAlign.center,
                    ),
                  ),
                );
              }
              return ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: teams.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (context, i) {
                  final t = teams[i];
                  return Card(
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                      side: const BorderSide(color: Color(0xFFE5E7EB)),
                    ),
                    child: ListTile(
                      leading: const Icon(Icons.groups_outlined, color: AppTheme.gold),
                      title: Text(
                        t.name,
                        style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 14),
                      ),
                    ),
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}
