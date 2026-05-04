import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/app_telemetry.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import '../services/hr_self_register_draft.dart';
import 'hr_register_verify_code_screen.dart';

class HrRegisterScreen extends StatefulWidget {
  const HrRegisterScreen({super.key});

  @override
  State<HrRegisterScreen> createState() => _HrRegisterScreenState();
}

class _HrRegisterScreenState extends State<HrRegisterScreen> {
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _confirmCtrl = TextEditingController();

  bool _loading = false;
  bool _obscurePassword = true;
  bool _obscureConfirm = true;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    _confirmCtrl.dispose();
    super.dispose();
  }

  Future<void> _sendVerificationCode() async {
    final email = _emailCtrl.text.trim();
    final password = _passwordCtrl.text;
    final confirm = _confirmCtrl.text;

    if (email.isEmpty || password.isEmpty || confirm.isEmpty) {
      showInfoSnack(context, 'Enter your HR admin email and password.');
      return;
    }
    if (password.length < 6) {
      showInfoSnack(context, 'Password must be at least 6 characters.');
      return;
    }
    if (password != confirm) {
      showErrorSnack(context, 'Passwords do not match.');
      return;
    }

    setState(() => _loading = true);
    try {
      TextInput.finishAutofillContext();
      await HrSelfRegisterDraft.save(
        HrSelfRegisterDraft(
          email: email,
          companyName: '',
          ownerFirstName: '',
          ownerLastName: '',
        ),
      );
      await SupabaseTimesheetStorage.sendHrRegistrationEmailOtp(email: email);
      if (!mounted) return;
      showInfoSnack(
        context,
        'Enter the verification code we emailed you — then add your company details.',
      );
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => HrRegisterVerifyCodeScreen(
            email: email,
            password: password,
          ),
        ),
      );
    } catch (e) {
      AppTelemetry.logError(screen: 'hr_register_screen', action: 'send_otp', error: e);
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(
          e,
          fallback: 'Could not send verification code.',
        ),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = Responsive.horizontalPadding(context);
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
        title: Text(
          'Register Your Company',
          style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(horizontalPadding),
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: Responsive.contentMaxWidth(context).clamp(0, 560)),
            child: Card(
              color: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(
                      height: 96,
                      child: Image.asset(
                        'assets/images/kaisync_logo.png',
                        fit: BoxFit.contain,
                        errorBuilder: (context, error, stackTrace) => const SizedBox.shrink(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Self-service business onboarding',
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF111827),
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Start by confirming your HR admin email and password. '
                      'After you verify the code we send you, you\'ll enter your company name '
                      'and your name — then your owner employee profile is created with the same email. '
                      'Company codes are assigned automatically (01, 02, 03…).',
                      style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                    ),
                    const SizedBox(height: 16),
                    AutofillGroup(
                      child: Column(
                        children: [
                          TextField(
                            controller: _emailCtrl,
                            keyboardType: TextInputType.emailAddress,
                            autofillHints: const [AutofillHints.username, AutofillHints.email],
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'HR admin email',
                              hintText: 'Used for sign-in and your owner employee record',
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _passwordCtrl,
                            obscureText: _obscurePassword,
                            autofillHints: const [AutofillHints.newPassword],
                            textInputAction: TextInputAction.next,
                            decoration: InputDecoration(
                              labelText: 'Password',
                              suffixIcon: IconButton(
                                onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                                icon: Icon(_obscurePassword ? Icons.visibility : Icons.visibility_off),
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _confirmCtrl,
                            obscureText: _obscureConfirm,
                            autofillHints: const [AutofillHints.newPassword],
                            textInputAction: TextInputAction.done,
                            onSubmitted: (_) => _loading ? null : _sendVerificationCode(),
                            decoration: InputDecoration(
                              labelText: 'Confirm password',
                              suffixIcon: IconButton(
                                onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
                                icon: Icon(_obscureConfirm ? Icons.visibility : Icons.visibility_off),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                    SizedBox(
                      height: 50,
                      child: ElevatedButton(
                        onPressed: _loading ? null : _sendVerificationCode,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.gold,
                          foregroundColor: AppTheme.black,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        child: _loading
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.black),
                              )
                            : Text(
                                'Continue — send verification code',
                                style: GoogleFonts.poppins(fontWeight: FontWeight.w700),
                              ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Sending a code may create a pending sign-up for this email in Supabase '
                      '(not verified until you complete the next steps). You can remove stale rows '
                      'under Dashboard → Authentication → Users.',
                      style: GoogleFonts.poppins(
                        fontSize: 11,
                        color: const Color(0xFF9CA3AF),
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
