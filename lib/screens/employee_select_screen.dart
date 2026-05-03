import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/timesheet_provider.dart';

/// Employee can only pick from existing employees (no add). HR creates employees.
class EmployeeSelectScreen extends StatelessWidget {
  const EmployeeSelectScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text('Select yourself', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.close, color: AppTheme.gold),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Consumer<TimesheetProvider>(
        builder: (context, prov, _) {
          final list = prov.employees;
          if (prov.isLoading) {
            return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
          }
          if (list.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'No employees in the system yet.\nHR must add employees first.',
                  style: GoogleFonts.poppins(color: AppTheme.textGray, fontSize: 16),
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          return ListView.builder(
            padding: const EdgeInsets.all(24),
            itemCount: list.length,
            itemBuilder: (context, i) {
              final e = list[i];
              return Card(
                color: Colors.white,
                margin: const EdgeInsets.only(bottom: 8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: const BorderSide(color: Color(0xFFE5E7EB)),
                ),
                child: ListTile(
                  title: Text(
                    e.fullName,
                    style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w500),
                  ),
                  subtitle: (e.employeeCode.isNotEmpty || e.id.isNotEmpty)
                      ? Text(
                          'ID: ${e.employeeCode.isNotEmpty ? e.employeeCode : e.id}',
                          style: GoogleFonts.poppins(color: AppTheme.textGray, fontSize: 12),
                        )
                      : null,
                  trailing: const Icon(Icons.chevron_right, color: AppTheme.gold),
                  onTap: () => Navigator.of(context).pop(e),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
