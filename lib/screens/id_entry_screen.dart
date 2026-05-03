import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../providers/timesheet_provider.dart';
import '../providers/job_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../services/app_update_service.dart';
import 'employee_login_screen.dart';
import 'employee_company_selector_screen.dart';
import 'employee_dashboard_shell.dart';
import 'hr_email_verified_screen.dart';
import 'hr_sign_in_screen.dart';
import 'hr_register_screen.dart';
import 'employer_dashboard_screen.dart';

class IdEntryScreen extends StatefulWidget {
  const IdEntryScreen({super.key});

  @override
  State<IdEntryScreen> createState() => _IdEntryScreenState();
}

class _IdEntryScreenState extends State<IdEntryScreen> {
  bool _restoringSession = true;
  bool _checkedForUpdate = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      _handleVerificationRedirect();
      await _checkForAppUpdateOnce();
      await _restoreSession();
      if (mounted) setState(() => _restoringSession = false);
    });
  }

  void _handleVerificationRedirect() {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null || !mounted) return;
    final uri = Uri.base;
    final fragment = uri.fragment.toLowerCase();
    final qp = uri.queryParameters;
    final shouldGoToVerifiedScreen =
        qp['next'] == 'hr_email_verified' ||
        qp['type'] == 'signup' ||
        fragment.contains('type=signup') ||
        (fragment.contains('access_token=') && fragment.contains('type='));
    if (!shouldGoToVerifiedScreen) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const HrEmailVerifiedScreen()),
    );
  }

  Future<void> _checkForAppUpdateOnce() async {
    if (_checkedForUpdate) return;
    _checkedForUpdate = true;
    await AppUpdateService.maybePromptForUpdate(context);
  }

  Future<void> _restoreSession() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null || !mounted) return;
    try {
      final hrProfile = await SupabaseTimesheetStorage.getCurrentHrProfile();
      if (hrProfile != null && mounted) {
        final timesheet = context.read<TimesheetProvider>();
        final jobProvider = context.read<JobProvider>();
        timesheet.setCurrentCompanyId(hrProfile.companyId);
        jobProvider.setCompanyId(hrProfile.companyId);
        await timesheet.loadEmployees();
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const EmployerDashboardScreen()),
        );
        return;
      }
      final companies = await SupabaseTimesheetStorage.getEmployeeCompaniesForCurrentUser();
      if (companies.isEmpty || !mounted) return;
      final provider = context.read<TimesheetProvider>();
      provider.setEmployeeCompanies(companies);
      if (companies.length == 1) {
        await provider.setCurrentEmployee(companies.first.employee, companyId: companies.first.companyId);
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const EmployeeDashboardShell()),
        );
      } else {
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const EmployeeCompanySelectorScreen()),
        );
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = Responsive.horizontalPadding(context);
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      body: SafeArea(
        child: Stack(
          children: [
            Positioned(
              top: -120, left: -80,
              child: Container(
                width: 260, height: 260,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF2563EB).withValues(alpha: 0.08),
                ),
              ),
            ),
            Positioned(
              bottom: -140, right: -80,
              child: Container(
                width: 300, height: 300,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF7C3AED).withValues(alpha: 0.08),
                ),
              ),
            ),
            Center(
              child: _restoringSession
                  ? const CircularProgressIndicator(color: AppTheme.gold)
                  : SingleChildScrollView(
                      padding: EdgeInsets.all(horizontalPadding),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          maxWidth: Responsive.contentMaxWidth(context).clamp(0, 520),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Card(
                              color: Colors.white,
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(24),
                                side: const BorderSide(color: Color(0xFFE5E7EB)),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.all(18),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          SizedBox(
                                            height: 104,
                                            child: Image.asset(
                                              'assets/images/kaisync_logo.png',
                                              fit: BoxFit.contain,
                                              alignment: Alignment.centerLeft,
                                              errorBuilder: (_, _, _) => const SizedBox.shrink(),
                                            ),
                                          ),
                                          Text(
                                            'KaiSync Workforce',
                                            style: GoogleFonts.poppins(
                                              color: const Color(0xFF111827),
                                              fontSize: 16,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            'Welcome — select your role to continue',
                                            style: GoogleFonts.poppins(
                                              color: const Color(0xFF6B7280),
                                              fontSize: 12,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFF9FAFB),
                                        borderRadius: BorderRadius.circular(999),
                                        border: Border.all(color: const Color(0xFFE5E7EB)),
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          const Icon(Icons.lock_outline, size: 16, color: Color(0xFF6B7280)),
                                          const SizedBox(width: 6),
                                          Text(
                                            'Secure',
                                            style: GoogleFonts.poppins(
                                              color: const Color(0xFF6B7280),
                                              fontSize: 11,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 14),
                            Card(
                              color: Colors.white,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                              elevation: 4,
                              child: Padding(
                                padding: const EdgeInsets.all(24),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    Text(
                                      'Sign in as',
                                      style: GoogleFonts.poppins(
                                        color: const Color(0xFF111827),
                                        fontSize: 14,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const SizedBox(height: 16),
                                    SizedBox(
                                      height: 56,
                                      child: ElevatedButton.icon(
                                        onPressed: () => Navigator.of(context).push(
                                          MaterialPageRoute(builder: (_) => const EmployeeLoginScreen()),
                                        ),
                                        style: ElevatedButton.styleFrom(
                                          backgroundColor: AppTheme.gold,
                                          foregroundColor: AppTheme.black,
                                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                        ),
                                        icon: const Icon(Icons.person_outline, size: 20),
                                        label: Text(
                                          'Employee',
                                          style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w700),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    SizedBox(
                                      height: 56,
                                      child: OutlinedButton.icon(
                                        onPressed: () => Navigator.of(context).push(
                                          MaterialPageRoute(builder: (_) => const HrSignInScreen()),
                                        ),
                                        style: OutlinedButton.styleFrom(
                                          foregroundColor: AppTheme.gold,
                                          side: const BorderSide(color: AppTheme.gold),
                                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                        ),
                                        icon: const Icon(Icons.business_center_outlined, size: 20),
                                        label: Text(
                                          "I'm HR / Employer",
                                          style: GoogleFonts.poppins(fontWeight: FontWeight.w700),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    SizedBox(
                                      height: 56,
                                      child: OutlinedButton.icon(
                                        onPressed: () => Navigator.of(context).push(
                                          MaterialPageRoute(builder: (_) => const HrRegisterScreen()),
                                        ),
                                        style: OutlinedButton.styleFrom(
                                          foregroundColor: const Color(0xFF2563EB),
                                          side: const BorderSide(color: Color(0xFF2563EB)),
                                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                                        ),
                                        icon: const Icon(Icons.app_registration, size: 20),
                                        label: Text(
                                          'Register new company',
                                          style: GoogleFonts.poppins(fontWeight: FontWeight.w700),
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              'Employees: sign in with login code or work email.\nHR / Employers: use your company account.',
                              style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
