import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/app_feedback.dart';
import 'employee_dashboard_shell.dart';
import 'employee_company_selector_screen.dart';

class EmployeeLoginScreen extends StatefulWidget {
  const EmployeeLoginScreen({super.key});

  @override
  State<EmployeeLoginScreen> createState() => _EmployeeLoginScreenState();
}

class _EmployeeLoginScreenState extends State<EmployeeLoginScreen> {
  static const String _methodCode = 'code';
  static const String _methodEmail = 'email';

  String _loginMethod = _methodCode;
  final _emailController = TextEditingController();
  final _otpController = TextEditingController();
  final _companyCodeController = TextEditingController();
  final _employeeCodeController = TextEditingController();

  bool _emailOtpSent = false;
  bool _loading = false;

  @override
  void dispose() {
    _emailController.dispose();
    _otpController.dispose();
    _companyCodeController.dispose();
    _employeeCodeController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _emailController.text.trim();
    final companyCode = _companyCodeController.text.trim().toUpperCase();
    final employeeCode = _employeeCodeController.text.trim();

    if (_loginMethod == _methodCode) {
      if (companyCode.isEmpty || employeeCode.isEmpty) {
        showInfoSnack(context, 'Enter company code and login code.');
        return;
      }
      setState(() => _loading = true);
      try {
        final resolved = await SupabaseTimesheetStorage.getEmployeeByCompanyCodeAndCode(
          companyCode: companyCode,
          employeeCode: employeeCode,
        );
        if (resolved == null) {
          if (!mounted) return;
          setState(() => _loading = false);
          showErrorSnack(context, 'Invalid company code or login code.');
          return;
        }
        if (!mounted) return;
        final provider = context.read<TimesheetProvider>();
        provider.setEmployeeCompanies([resolved]);
        await provider.setCurrentEmployee(resolved.employee, companyId: resolved.companyId);
        if (!mounted) return;
        setState(() => _loading = false);
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const EmployeeDashboardShell()),
        );
      } catch (e) {
        if (!mounted) return;
        setState(() => _loading = false);
        showErrorSnack(context, 'Could not sign in with code. Please verify both codes.');
      }
      return;
    }

    if (email.isEmpty) {
      showInfoSnack(context, 'Please enter your email address.');
      return;
    }
    if (!RegExp(r'^[^@]+@[^@]+\.[^@]+').hasMatch(email)) {
      showInfoSnack(context, 'Enter a valid email address.');
      return;
    }
    final otp = _otpController.text.trim();
    if (_emailOtpSent && otp.isEmpty) {
      showInfoSnack(context, 'Enter the confirmation code sent to your email.');
      return;
    }

    setState(() => _loading = true);
    try {
      List<ResolvedEmployee> companies;
      if (!_emailOtpSent) {
        await SupabaseTimesheetStorage.sendEmployeeEmailOtp(email: email);
        if (!mounted) return;
        setState(() {
          _loading = false;
          _emailOtpSent = true;
        });
        showSuccessSnack(context, 'A confirmation code has been sent to your email.');
        return;
      } else {
        companies = await SupabaseTimesheetStorage.verifyEmployeeEmailOtp(
          email: email,
          otp: otp,
        );
        if (companies.isEmpty) {
          await SupabaseTimesheetStorage.signOutEmployee();
          if (!mounted) return;
          setState(() => _loading = false);
          showErrorSnack(
            context,
            'No company account found for this email. Ask your HR manager to add you.',
          );
          return;
        }
      }

      if (!mounted) return;
      setState(() => _loading = false);

      final provider = context.read<TimesheetProvider>();
      provider.setEmployeeCompanies(companies);

      if (companies.length == 1) {
        await provider.setCurrentEmployee(companies.first.employee, companyId: companies.first.companyId);
        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const EmployeeDashboardShell()),
        );
      } else {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const EmployeeCompanySelectorScreen()),
        );
      }
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      showErrorSnack(context, _friendlyAuthError(e.message));
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      showErrorSnack(context, 'Something went wrong. Please try again.');
    }
  }

  String _friendlyAuthError(String message) {
    final m = message.toLowerCase();
    if (m.contains('invalid login') || m.contains('invalid credentials')) {
      return 'Incorrect email or password.';
    }
    if (m.contains('email not confirmed')) {
      return 'Please verify your email before signing in.';
    }
    if (m.contains('user already registered')) {
      return 'An account with this email already exists. Try signing in instead.';
    }
    if (m.contains('rate limit')) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    return message;
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = Responsive.horizontalPadding(context);
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF3F5FB),
        elevation: 0,
        foregroundColor: const Color(0xFF111827),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: EdgeInsets.symmetric(horizontal: horizontalPadding, vertical: 8),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: Responsive.contentMaxWidth(context).clamp(0, 480),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Logo / branding
                  Center(
                    child: SizedBox(
                      height: 80,
                      child: Image.asset(
                        'assets/images/kaisync_logo.png',
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) => const SizedBox.shrink(),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Center(
                    child: Text(
                      'Employee sign in',
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF111827),
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Center(
                    child: Text(
                      _loginMethod == _methodCode
                          ? 'Use company code + login code from your employer.'
                          : 'Use your registered email and a one-time code.',
                      style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 13),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Card(
                    color: Colors.white,
                    elevation: 4,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _label('Sign in method'),
                          const SizedBox(height: 6),
                          SegmentedButton<String>(
                            segments: const [
                              ButtonSegment<String>(
                                value: _methodCode,
                                label: Text('Login code'),
                                icon: Icon(Icons.qr_code_2_outlined, size: 16),
                              ),
                              ButtonSegment<String>(
                                value: _methodEmail,
                                label: Text('Email'),
                                icon: Icon(Icons.email_outlined, size: 16),
                              ),
                            ],
                            selected: {_loginMethod},
                            onSelectionChanged: _loading
                                ? null
                                : (v) {
                                    if (v.isEmpty) return;
                                    setState(() {
                                      _loginMethod = v.first;
                                      if (_loginMethod == _methodCode) _emailOtpSent = false;
                                    });
                                  },
                          ),
                          const SizedBox(height: 16),
                          if (_loginMethod == _methodCode) ...[
                            _label('Company code'),
                            const SizedBox(height: 6),
                            TextField(
                              controller: _companyCodeController,
                              enabled: !_loading,
                              decoration: _inputDecoration(
                                hint: '01',
                                icon: Icons.business_outlined,
                              ),
                              style: GoogleFonts.poppins(color: const Color(0xFF111827)),
                              textInputAction: TextInputAction.next,
                            ),
                            const SizedBox(height: 16),
                            _label('Login code'),
                            const SizedBox(height: 6),
                            TextField(
                              controller: _employeeCodeController,
                              enabled: !_loading,
                              decoration: _inputDecoration(
                                hint: 'ID/employee code',
                                icon: Icons.badge_outlined,
                              ),
                              style: GoogleFonts.poppins(color: const Color(0xFF111827)),
                              textInputAction: TextInputAction.done,
                              onSubmitted: (_) => _submit(),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Ask your employer for both codes. Example: Company code 01, Login code = your employee/ID code.',
                              style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                            ),
                          ] else ...[
                            _label('Email address'),
                            const SizedBox(height: 6),
                            TextField(
                              controller: _emailController,
                              enabled: !_loading,
                              keyboardType: TextInputType.emailAddress,
                              autocorrect: false,
                              decoration: _inputDecoration(
                                hint: 'you@example.com',
                                icon: Icons.email_outlined,
                              ),
                              style: GoogleFonts.poppins(color: const Color(0xFF111827)),
                              textInputAction: TextInputAction.next,
                            ),
                            const SizedBox(height: 16),
                            _label('Confirmation code'),
                            const SizedBox(height: 6),
                            TextField(
                              controller: _otpController,
                              enabled: !_loading,
                              decoration: _inputDecoration(
                                hint: 'Code from email',
                                icon: Icons.pin_outlined,
                              ),
                              style: GoogleFonts.poppins(color: const Color(0xFF111827)),
                              textInputAction: TextInputAction.done,
                              onSubmitted: (_) => _submit(),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              _emailOtpSent
                                  ? 'Enter the code from your email.'
                                  : 'Tap "Send code" to receive your email verification code.',
                              style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                            ),
                          ],
                          if (_loginMethod == _methodEmail) ...[
                            const SizedBox(height: 6),
                            Align(
                              alignment: Alignment.centerRight,
                              child: TextButton(
                                onPressed: _loading
                                    ? null
                                    : () async {
                                        if (_emailController.text.trim().isEmpty) {
                                          showInfoSnack(context, 'Enter your email first.');
                                          return;
                                        }
                                        try {
                                          await SupabaseTimesheetStorage.sendEmployeeEmailOtp(
                                            email: _emailController.text.trim(),
                                          );
                                          if (!mounted) return;
                                          setState(() => _emailOtpSent = true);
                                          showSuccessSnack(context, 'A confirmation code has been sent.');
                                        } catch (_) {
                                          if (!mounted) return;
                                          showErrorSnack(context, 'Could not send code. Please try again.');
                                        }
                                      },
                                style: TextButton.styleFrom(
                                  padding: EdgeInsets.zero,
                                  minimumSize: const Size(0, 32),
                                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                ),
                                child: Text(
                                  _emailOtpSent ? 'Resend code' : 'Send code',
                                  style: GoogleFonts.poppins(
                                    color: const Color(0xFF6B7280),
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            ),
                          ],
                          const SizedBox(height: 20),
                          SizedBox(
                            height: 52,
                            child: ElevatedButton(
                              onPressed: _loading ? null : _submit,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppTheme.gold,
                                foregroundColor: AppTheme.black,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                              ),
                              child: _loading
                                  ? const SizedBox(
                                      height: 22,
                                      width: 22,
                                      child: CircularProgressIndicator(color: AppTheme.black, strokeWidth: 2),
                                    )
                                  : Text(
                                      _loginMethod == _methodCode
                                          ? 'Sign in with code'
                                          : (_emailOtpSent ? 'Verify & sign in' : 'Send code'),
                                      style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w700),
                                    ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _label(String text) => Text(
        text,
        style: GoogleFonts.poppins(
          color: const Color(0xFF374151),
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
      );

  InputDecoration _inputDecoration({required String hint, required IconData icon}) {
    return InputDecoration(
      hintText: hint,
      prefixIcon: Icon(icon, size: 20, color: const Color(0xFF9CA3AF)),
      isDense: true,
      filled: true,
      fillColor: const Color(0xFFF9FAFB),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0xFFD1D5DB)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0xFFD1D5DB)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: AppTheme.gold, width: 2),
      ),
      hintStyle: GoogleFonts.poppins(color: const Color(0xFF9CA3AF), fontSize: 14),
    );
  }
}
