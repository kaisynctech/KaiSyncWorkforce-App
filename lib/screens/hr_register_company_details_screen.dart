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

/// HR registration step 3: company + owner names (after email is verified).
class HrRegisterCompanyDetailsScreen extends StatefulWidget {
  final String email;

  const HrRegisterCompanyDetailsScreen({
    super.key,
    required this.email,
  });

  @override
  State<HrRegisterCompanyDetailsScreen> createState() =>
      _HrRegisterCompanyDetailsScreenState();
}

class _HrRegisterCompanyDetailsScreenState
    extends State<HrRegisterCompanyDetailsScreen> {
  final _companyCtrl = TextEditingController();
  final _ownerFirstCtrl = TextEditingController();
  final _ownerLastCtrl = TextEditingController();

  bool _loading = false;

  @override
  void dispose() {
    _companyCtrl.dispose();
    _ownerFirstCtrl.dispose();
    _ownerLastCtrl.dispose();
    super.dispose();
  }

  Future<void> _createCompany() async {
    final companyName = _companyCtrl.text.trim();
    final ownerFirst = _ownerFirstCtrl.text.trim();

    if (companyName.isEmpty) {
      showInfoSnack(context, 'Enter your company name.');
      return;
    }
    if (ownerFirst.isEmpty) {
      showInfoSnack(context, 'Enter your first name.');
      return;
    }

    setState(() => _loading = true);
    try {
      TextInput.finishAutofillContext();

      try {
        final result = await SupabaseTimesheetStorage.registerCompanySelfService(
          companyName: companyName,
          ownerFirstName: ownerFirst,
          ownerLastName: _ownerLastCtrl.text.trim(),
        );

        await HrSelfRegisterDraft.clear();

        if (!mounted) return;
        AppTelemetry.logInfo(
          screen: 'hr_register_company_details_screen',
          action: 'register_success',
          details: 'company_code=${result.companyCode}',
        );
        // Full-screen success — snackbars vanish when routes pop; avoid relying on them.
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(
            builder: (_) => HrRegistrationSuccessScreen(
              email: widget.email,
              companyCode: result.companyCode,
              registeredCompanyName: companyName,
            ),
          ),
          (_) => false,
        );
      } catch (e) {
        await HrSelfRegisterDraft.save(
          HrSelfRegisterDraft(
            email: widget.email,
            companyName: companyName,
            ownerFirstName: ownerFirst,
            ownerLastName: _ownerLastCtrl.text.trim(),
          ),
        );
        AppTelemetry.logError(
          screen: 'hr_register_company_details_screen',
          action: 'register_company_self_service',
          error: e,
        );
        if (!mounted) return;
        showErrorSnack(
          context,
          friendlyErrorMessage(
            e,
            fallback:
                'Company setup failed. If you already registered, sign in instead.',
          ),
        );
      }
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
          'Company details',
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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Step 3 of 3 · Register your company',
                  style: GoogleFonts.poppins(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFF2563EB),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'After email + verification code, this is the only screen that asks for company and owner name. '
                  'If you ever sign in without finishing setup, HR Sign In may show the same fields in a small dialog — same step.',
                  style: GoogleFonts.poppins(
                    fontSize: 11,
                    height: 1.35,
                    color: const Color(0xFF6B7280),
                  ),
                ),
                const SizedBox(height: 14),
                Card(
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
                          'Almost done',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF111827),
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '${widget.email.trim()} is verified. '
                          'Add your business details — company codes are assigned automatically (01, 02, 03…).',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280),
                            fontSize: 13,
                          ),
                        ),
                        const SizedBox(height: 20),
                        TextField(
                          controller: _companyCtrl,
                          autofillHints: const [AutofillHints.organizationName],
                          textInputAction: TextInputAction.next,
                          decoration:
                              const InputDecoration(labelText: 'Company name'),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _ownerFirstCtrl,
                          autofillHints: const [AutofillHints.givenName],
                          textInputAction: TextInputAction.next,
                          decoration: const InputDecoration(
                            labelText: 'Your first name',
                            hintText: 'Company owner / HR employee record',
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _ownerLastCtrl,
                          autofillHints: const [AutofillHints.familyName],
                          textInputAction: TextInputAction.done,
                          onSubmitted: (_) =>
                              _loading ? null : _createCompany(),
                          decoration: const InputDecoration(
                            labelText: 'Your last name (optional)',
                          ),
                        ),
                        const SizedBox(height: 22),
                        SizedBox(
                          height: 50,
                          child: ElevatedButton(
                            onPressed: _loading ? null : _createCompany,
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
                                    'Create company',
                                    style: GoogleFonts.poppins(
                                        fontWeight: FontWeight.w700),
                                  ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
