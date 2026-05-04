import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import 'hr_sign_in_screen.dart';

class HrRegistrationSuccessScreen extends StatelessWidget {
  final String email;
  final String? companyCode;
  /// Shown after self-service registration when we know the legal/display name.
  final String? registeredCompanyName;
  final bool awaitingEmailVerification;

  const HrRegistrationSuccessScreen({
    super.key,
    required this.email,
    this.companyCode,
    this.registeredCompanyName,
    this.awaitingEmailVerification = false,
  });

  @override
  Widget build(BuildContext context) {
    final hasCode = companyCode != null && companyCode!.trim().isNotEmpty;
    final companyLabel =
        registeredCompanyName?.trim().isNotEmpty == true
            ? registeredCompanyName!.trim()
            : null;
    final employeeInstruction = hasCode
        ? 'Employees sign in with company code plus their employee ID (as printed on payroll / HR records).\n'
            'Example login pair: company code $companyCode · employee ID FN211956'
        : 'Return to registration and enter the verification code we emailed you, or use HR Sign In if you already verified.';
    final horizontalPadding = Responsive.horizontalPadding(context);
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
        title: Text(
          'Registration Complete',
          style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(horizontalPadding),
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: Responsive.contentMaxWidth(context).clamp(0, 620)),
            child: Card(
              color: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.verified_rounded, color: Color(0xFF059669), size: 28),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            hasCode
                                ? 'Company registered successfully'
                                : 'Your business is ready',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF111827),
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (hasCode) ...[
                      const SizedBox(height: 8),
                      Text(
                        companyLabel != null
                            ? '$companyLabel is set up on KaiSync Workforce. '
                                'Save your company code — you will need it for worker sign-in.'
                            : 'Save your company code below — HR uses email and password; '
                                'workers use company code and their employee ID.',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF4B5563),
                          fontSize: 13,
                          height: 1.35,
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF9FAFB),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFFE5E7EB)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            hasCode ? 'Company code' : 'Next step',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF6B7280),
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text(
                                hasCode ? companyCode! : 'Confirm your email',
                                style: GoogleFonts.poppins(
                                  color: AppTheme.gold,
                                  fontSize: hasCode ? 30 : 20,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: hasCode ? 2 : 0,
                                ),
                              ),
                              if (hasCode)
                                OutlinedButton.icon(
                                  onPressed: () async {
                                    await Clipboard.setData(ClipboardData(text: companyCode!));
                                    if (!context.mounted) return;
                                    showSuccessSnack(context, 'Company code copied.');
                                  },
                                  icon: const Icon(Icons.copy, size: 16),
                                  label: Text(
                                    'Copy code',
                                    style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEFF4FF),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFFD1D5DB)),
                      ),
                      child: Text(
                        employeeInstruction,
                        style: GoogleFonts.poppins(color: const Color(0xFF1F2937), fontSize: 12),
                      ),
                    ),
                    const SizedBox(height: 18),
                    if (!hasCode) ...[
                      OutlinedButton.icon(
                        onPressed: () async {
                          try {
                            await SupabaseTimesheetStorage.sendHrRegistrationEmailOtp(
                              email: email,
                            );
                            if (!context.mounted) return;
                            showSuccessSnack(context, 'Verification code resent.');
                          } catch (e) {
                            if (!context.mounted) return;
                            showErrorSnack(
                              context,
                              'Could not resend code. Please try again.',
                            );
                          }
                        },
                        icon: const Icon(Icons.mark_email_read_outlined),
                        label: Text(
                          'Resend verification code',
                          style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                        ),
                      ),
                      const SizedBox(height: 10),
                    ],
                    SizedBox(
                      height: 50,
                      child: ElevatedButton.icon(
                        onPressed: () => Navigator.of(context).pushAndRemoveUntil(
                          MaterialPageRoute(
                            builder: (_) => HrSignInScreen(
                              initialEmail: email,
                            ),
                          ),
                          (route) => false,
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.gold,
                          foregroundColor: AppTheme.black,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        icon: const Icon(Icons.login),
                        label: Text(
                          awaitingEmailVerification
                              ? 'Continue to HR Sign In'
                              : 'Continue to HR Sign In',
                          style: GoogleFonts.poppins(fontWeight: FontWeight.w700),
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
