import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/app_telemetry.dart';
import '../services/hr_self_register_draft.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import 'hr_registration_success_screen.dart';

/// Second step of HR self-registration: enter email OTP (no magic links).
class HrRegisterVerifyEmailScreen extends StatefulWidget {
  final String email;
  final String password;
  final String companyName;
  final String ownerFirstName;
  final String ownerLastName;

  const HrRegisterVerifyEmailScreen({
    super.key,
    required this.email,
    required this.password,
    required this.companyName,
    required this.ownerFirstName,
    required this.ownerLastName,
  });

  @override
  State<HrRegisterVerifyEmailScreen> createState() =>
      _HrRegisterVerifyEmailScreenState();
}

class _HrRegisterVerifyEmailScreenState extends State<HrRegisterVerifyEmailScreen> {
  final _otpCtrl = TextEditingController();

  bool _loading = false;
  bool _sendingCode = false;

  @override
  void dispose() {
    _otpCtrl.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    setState(() => _sendingCode = true);
    try {
      await SupabaseTimesheetStorage.sendHrRegistrationEmailOtp(email: widget.email);
      if (!mounted) return;
      showSuccessSnack(context, 'A verification code was sent to your email.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Could not send verification code.'),
      );
    } finally {
      if (mounted) setState(() => _sendingCode = false);
    }
  }

  Future<void> _verifyAndCreateCompany() async {
    final code = _otpCtrl.text.trim();
    if (code.isEmpty) {
      showInfoSnack(context, 'Enter the verification code from your email.');
      return;
    }

    setState(() => _loading = true);
    try {
      TextInput.finishAutofillContext();
      await SupabaseTimesheetStorage.verifyHrRegistrationEmailOtp(
        email: widget.email,
        otp: code,
      );
      await SupabaseTimesheetStorage.setHrPasswordAfterRegistration(
        password: widget.password,
      );
      final result = await SupabaseTimesheetStorage.registerCompanySelfService(
        companyName: widget.companyName,
        ownerFirstName: widget.ownerFirstName,
        ownerLastName: widget.ownerLastName,
      );
      await HrSelfRegisterDraft.clear();

      if (!mounted) return;
      AppTelemetry.logInfo(
        screen: 'hr_register_verify_email_screen',
        action: 'register_success',
        details: 'company_code=${result.companyCode}',
      );
      showSuccessSnack(
        context,
        'Registration successful. Your company code is ${result.companyCode}.',
      );
      final nav = Navigator.of(context);
      nav.popUntil((r) => r.isFirst);
      nav.pushReplacement(
        MaterialPageRoute(
          builder: (_) => HrRegistrationSuccessScreen(
            email: widget.email,
            companyCode: result.companyCode,
          ),
        ),
      );
    } catch (e) {
      AppTelemetry.logError(
        screen: 'hr_register_verify_email_screen',
        action: 'verify_or_company_setup',
        error: e,
      );
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Verification or setup failed.'),
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
          'Verify email',
          style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(horizontalPadding),
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: Responsive.contentMaxWidth(context).clamp(0, 520),
            ),
            child: Card(
              color: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
              ),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Enter verification code',
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF111827),
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'We sent a code to ${widget.email.trim()}.\n'
                      'Paste it below — no link required.',
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF6B7280),
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 18),
                    TextField(
                      controller: _otpCtrl,
                      keyboardType: TextInputType.number,
                      autofillHints: const [AutofillHints.oneTimeCode],
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _loading ? null : _verifyAndCreateCompany(),
                      decoration: const InputDecoration(
                        labelText: 'Verification code',
                        hintText: 'Code from email',
                      ),
                    ),
                    const SizedBox(height: 12),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: (_loading || _sendingCode) ? null : _sendCode,
                        child: Text(
                          'Resend code',
                          style: GoogleFonts.poppins(
                            fontWeight: FontWeight.w600,
                            color: AppTheme.gold,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      height: 50,
                      child: ElevatedButton(
                        onPressed: _loading ? null : _verifyAndCreateCompany,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.gold,
                          foregroundColor: AppTheme.black,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: _loading
                            ? const SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppTheme.black,
                                ),
                              )
                            : Text(
                                'Verify & create company',
                                style:
                                    GoogleFonts.poppins(fontWeight: FontWeight.w700),
                              ),
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
