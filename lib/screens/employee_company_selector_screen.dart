import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../providers/timesheet_provider.dart';
import 'employee_dashboard_shell.dart';

class EmployeeCompanySelectorScreen extends StatelessWidget {
  const EmployeeCompanySelectorScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TimesheetProvider>();
    final companies = provider.employeeCompanies;
    final employee = companies.isNotEmpty ? companies.first.employee : null;
    final firstName = employee?.name.isNotEmpty == true ? employee!.name : 'there';
    final horizontalPadding = Responsive.horizontalPadding(context);

    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      body: SafeArea(
        child: Stack(
          children: [
            Positioned(
              top: -100, left: -60,
              child: Container(
                width: 220, height: 220,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF2563EB).withValues(alpha: 0.07),
                ),
              ),
            ),
            Positioned(
              bottom: -120, right: -60,
              child: Container(
                width: 260, height: 260,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppTheme.gold.withValues(alpha: 0.07),
                ),
              ),
            ),
            Column(
              children: [
                // Header
                Padding(
                  padding: EdgeInsets.fromLTRB(horizontalPadding, 24, horizontalPadding, 0),
                  child: Row(
                    children: [
                      Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: AppTheme.gold.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: const Icon(Icons.business_outlined, color: AppTheme.gold, size: 24),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Welcome back, $firstName!',
                              style: GoogleFonts.poppins(
                                color: const Color(0xFF111827),
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            Text(
                              'Select a company to continue',
                              style: GoogleFonts.poppins(
                                color: const Color(0xFF6B7280),
                                fontSize: 13,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                // Company list
                Expanded(
                  child: companies.isEmpty
                      ? Center(
                          child: Text(
                            'No companies found.',
                            style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                          ),
                        )
                      : ListView.separated(
                          padding: EdgeInsets.symmetric(horizontal: horizontalPadding),
                          itemCount: companies.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 12),
                          itemBuilder: (context, i) {
                            final c = companies[i];
                            return _CompanyCard(
                              companyName: c.companyName.isNotEmpty ? c.companyName : 'Company',
                              companyCode: c.companyCode,
                              position: c.employee.position,
                              branch: c.employee.branch,
                              employmentTypeLabel: c.employee.employmentTypeLabel ?? '',
                              onTap: () async {
                                await context.read<TimesheetProvider>().setCurrentEmployee(
                                  c.employee,
                                  companyId: c.companyId,
                                );
                                if (!context.mounted) return;
                                Navigator.of(context).pushReplacement(
                                  MaterialPageRoute(builder: (_) => const EmployeeDashboardShell()),
                                );
                              },
                            );
                          },
                        ),
                ),
                // Sign out
                Padding(
                  padding: EdgeInsets.fromLTRB(horizontalPadding, 8, horizontalPadding, 16),
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      await context.read<TimesheetProvider>().signOutEmployee();
                      if (!context.mounted) return;
                      Navigator.of(context).popUntil((r) => r.isFirst);
                    },
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF6B7280),
                      side: const BorderSide(color: Color(0xFFD1D5DB)),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    ),
                    icon: const Icon(Icons.logout, size: 18),
                    label: Text('Sign out', style: GoogleFonts.poppins(fontSize: 13)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CompanyCard extends StatelessWidget {
  final String companyName;
  final String companyCode;
  final String position;
  final String branch;
  final String employmentTypeLabel;
  final VoidCallback onTap;

  const _CompanyCard({
    required this.companyName,
    required this.companyCode,
    required this.position,
    required this.branch,
    required this.employmentTypeLabel,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      elevation: 3,
      shadowColor: Colors.black.withValues(alpha: 0.08),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.domain_outlined, color: Color(0xFF2563EB), size: 24),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      companyName,
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF111827),
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (position.isNotEmpty)
                      Text(
                        position,
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF4B5563),
                          fontSize: 13,
                        ),
                      ),
                    Row(
                      children: [
                        if (branch.isNotEmpty) ...[
                          const Icon(Icons.location_on_outlined, size: 13, color: Color(0xFF9CA3AF)),
                          const SizedBox(width: 3),
                          Text(
                            branch,
                            style: GoogleFonts.poppins(color: const Color(0xFF9CA3AF), fontSize: 12),
                          ),
                          const SizedBox(width: 10),
                        ],
                        if (employmentTypeLabel.isNotEmpty)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppTheme.gold.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              employmentTypeLabel,
                              style: GoogleFonts.poppins(
                                color: AppTheme.gold,
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.arrow_forward_ios_rounded, size: 16, color: Color(0xFF9CA3AF)),
            ],
          ),
        ),
      ),
    );
  }
}
