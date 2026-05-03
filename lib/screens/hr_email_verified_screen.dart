import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import 'hr_sign_in_screen.dart';

class HrEmailVerifiedScreen extends StatefulWidget {
  const HrEmailVerifiedScreen({super.key});

  @override
  State<HrEmailVerifiedScreen> createState() => _HrEmailVerifiedScreenState();
}

class _HrEmailVerifiedScreenState extends State<HrEmailVerifiedScreen> {
  bool _continuing = false;
  final DateTime _verifiedAt = DateTime.now();

  Future<void> _continue() async {
    if (_continuing) return;
    setState(() => _continuing = true);
    try {
      final user = Supabase.instance.client.auth.currentUser;
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => HrSignInScreen(initialEmail: user?.email),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not continue setup.'));
    } finally {
      if (mounted) setState(() => _continuing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = Supabase.instance.client.auth.currentUser;
    final horizontalPadding = Responsive.horizontalPadding(context);
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
        title: Text(
          'Email Verified',
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
              elevation: 4,
              child: Padding(
                padding: const EdgeInsets.all(22),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 42,
                          height: 42,
                          decoration: BoxDecoration(
                            color: const Color(0xFF059669).withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Icon(Icons.verified_rounded, color: Color(0xFF059669)),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'Your email is confirmed',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF111827),
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            decoration: BoxDecoration(
                              color: const Color(0xFFD1FAE5),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: const Color(0xFFA7F3D0)),
                            ),
                            child: Text(
                              'Email verified successfully at ${DateFormat('yyyy-MM-dd HH:mm').format(_verifiedAt)}',
                              style: GoogleFonts.poppins(
                                color: const Color(0xFF065F46),
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                    Text(
                      'Great — your HR account is now verified. We will finalize your company setup and show your company code.',
                      style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 13),
                    ),
                    if (user?.email != null) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF9FAFB),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFE5E7EB)),
                        ),
                        child: Text(
                          user!.email!,
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF111827),
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEFF4FF),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFFD1D5DB)),
                      ),
                      child: Text(
                        'Next: Continue to onboarding. If your company is not linked yet, we will ask for company name and then generate your code (01, 02, 03...).',
                        style: GoogleFonts.poppins(color: const Color(0xFF1F2937), fontSize: 12),
                      ),
                    ),
                    const SizedBox(height: 18),
                    SizedBox(
                      height: 50,
                      child: ElevatedButton.icon(
                        onPressed: _continuing ? null : _continue,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.gold,
                          foregroundColor: AppTheme.black,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        icon: _continuing
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppTheme.black,
                                ),
                              )
                            : const Icon(Icons.arrow_forward),
                        label: Text(
                          _continuing ? 'Continuing...' : 'Continue setup',
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
