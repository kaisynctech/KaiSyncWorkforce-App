import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../services/app_telemetry.dart';
import '../services/hr_self_register_draft.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import 'hr_register_company_details_screen.dart';

/// HR registration step 2: confirm email with OTP (or existing session from link).
class HrRegisterVerifyCodeScreen extends StatefulWidget {
  final String email;
  final String password;

  const HrRegisterVerifyCodeScreen({
    super.key,
    required this.email,
    required this.password,
  });

  @override
  State<HrRegisterVerifyCodeScreen> createState() =>
      _HrRegisterVerifyCodeScreenState();
}

class _HrRegisterVerifyCodeScreenState extends State<HrRegisterVerifyCodeScreen> {
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

  Future<void> _continueToCompanyStep() async {
    final code = _otpCtrl.text.trim();
    final normalizedEmail = widget.email.trim().toLowerCase();
    final user = Supabase.instance.client.auth.currentUser;
    final alreadySignedInAsSelf =
        user?.email?.trim().toLowerCase() == normalizedEmail;

    if (!alreadySignedInAsSelf && code.isEmpty) {
      showInfoSnack(context, 'Enter the verification code from your email.');
      return;
    }

    setState(() => _loading = true);
    try {
      TextInput.finishAutofillContext();

      if (!alreadySignedInAsSelf) {
        try {
          await SupabaseTimesheetStorage.verifyHrRegistrationEmailOtp(
            email: widget.email,
            otp: code,
          );
        } catch (e) {
          AppTelemetry.logError(
            screen: 'hr_register_verify_code_screen',
            action: 'verify_otp',
            error: e,
          );
          if (!mounted) return;
          showErrorSnack(
            context,
            friendlyErrorMessage(e, fallback: 'Email verification failed.'),
          );
          return;
        }
      }

      try {
        await SupabaseTimesheetStorage.setHrPasswordAfterRegistration(
          password: widget.password,
        );
      } catch (e) {
        AppTelemetry.logError(
          screen: 'hr_register_verify_code_screen',
          action: 'set_password_after_registration',
          error: e,
        );
        if (!mounted) return;
        showErrorSnack(
          context,
          friendlyErrorMessage(e, fallback: 'Could not save your password.'),
        );
        return;
      }

      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) =>
              HrRegisterCompanyDetailsScreen(email: widget.email),
        ),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _useDifferentEmail() async {
    final confirmed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: Text(
              'Use a different email?',
              style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
            ),
            content: Text(
              'You\'ll go back to enter another address. '
              'An unconfirmed signup may still appear under Authentication in Supabase '
              'until you remove it from the dashboard — that\'s normal for email OTP.',
              style: GoogleFonts.poppins(fontSize: 13),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: Text(
                  'Continue',
                  style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed || !mounted) return;

    await Supabase.instance.client.auth.signOut();
    await HrSelfRegisterDraft.clear();
    if (!mounted) return;
    Navigator.of(context).pop();
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
              maxWidth: Responsive.contentMaxWidth(context).clamp(0, 480),
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
                      'Paste it below or open the link in the email.',
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
                      onSubmitted: (_) =>
                          _loading ? null : _continueToCompanyStep(),
                      decoration: const InputDecoration(
                        labelText: 'Verification code',
                        hintText: 'Code from email',
                      ),
                    ),
                    const SizedBox(height: 12),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed:
                            (_loading || _sendingCode) ? null : _sendCode,
                        child: Text(
                          'Resend code',
                          style: GoogleFonts.poppins(
                            fontWeight: FontWeight.w600,
                            color: AppTheme.gold,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    SizedBox(
                      height: 50,
                      child: ElevatedButton(
                        onPressed: _loading ? null : _continueToCompanyStep,
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
                                'Continue',
                                style: GoogleFonts.poppins(
                                    fontWeight: FontWeight.w700),
                              ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: _loading ? null : _useDifferentEmail,
                      child: Text(
                        'Use a different email',
                        style: GoogleFonts.poppins(
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF2563EB),
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
