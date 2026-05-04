import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../providers/job_provider.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/hr_self_register_draft.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import 'employer_dashboard_screen.dart';
import 'hr_register_screen.dart';

class HrSignInScreen extends StatefulWidget {
  final String? initialEmail;

  const HrSignInScreen({
    super.key,
    this.initialEmail,
  });

  @override
  State<HrSignInScreen> createState() => _HrSignInScreenState();
}

class _HrSignInScreenState extends State<HrSignInScreen> {
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  bool _loading = false;
  bool _obscure = true;

  @override
  void initState() {
    super.initState();
    if (widget.initialEmail != null) {
      _emailCtrl.text = widget.initialEmail!;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _resumeFromExistingSession());
  }

  Future<void> _resumeFromExistingSession() async {
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null || _loading) return;
    setState(() => _loading = true);
    try {
      await _completeSignedInFlow();
    } catch (e) {
      AppTelemetry.logError(screen: 'hr_sign_in_screen', action: 'resume_session', error: e);
      _showError(friendlyErrorMessage(e, fallback: 'Could not continue setup from your session.'));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    final email = _emailCtrl.text.trim();
    final password = _passwordCtrl.text;
    if (email.isEmpty || password.isEmpty) {
      _showError('Enter email and password.');
      return;
    }

    setState(() => _loading = true);
    try {
      TextInput.finishAutofillContext();
      await SupabaseTimesheetStorage.signInHr(email: email, password: password);
      await _completeSignedInFlow();
      AppTelemetry.logInfo(
        screen: 'hr_sign_in_screen',
        action: 'sign_in_success',
      );
    } catch (e) {
      AppTelemetry.logError(screen: 'hr_sign_in_screen', action: 'sign_in', error: e);
      _showError(friendlyErrorMessage(e, fallback: 'HR sign-in failed.'));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _completeSignedInFlow() async {
    final profile = await SupabaseTimesheetStorage.getCurrentHrProfile();
    if (profile != null && !profile.isActive) {
      await SupabaseTimesheetStorage.signOutHr();
      _showError('Your HR account is inactive. Contact your administrator.');
      return;
    }
    String? mappedCompanyId =
        await SupabaseTimesheetStorage.getHrMappedCompanyIdForCurrentUser();

    if (mappedCompanyId == null) {
      mappedCompanyId = await _tryLinkCompanyFromRegistrationDraft();
    }

    if (mappedCompanyId == null) {
      final draft = await HrSelfRegisterDraft.load();
      final userEmail =
          Supabase.instance.client.auth.currentUser?.email?.trim().toLowerCase();
      final prefill = draft != null &&
              userEmail != null &&
              draft.normalizedEmail == userEmail
          ? draft
          : null;

      final created = await _promptCompleteSetup(prefill: prefill);
      if (!created) {
        await SupabaseTimesheetStorage.signOutHr();
        setState(() => _loading = false);
        return;
      }
      mappedCompanyId =
          await SupabaseTimesheetStorage.getHrMappedCompanyIdForCurrentUser();
    }

    if (mappedCompanyId == null) {
      await SupabaseTimesheetStorage.signOutHr();
      _showError('Could not complete company setup. Please try again.');
      AppTelemetry.logError(
        screen: 'hr_sign_in_screen',
        action: 'mapping_check',
        error: 'mapping_missing_after_setup',
      );
      return;
    }

    final companySettings = await SupabaseTimesheetStorage.getCompanySettings(
      companyId: mappedCompanyId,
    );
    if (companySettings != null &&
        !companySettings.isInFreeTrial &&
        companySettings.effectivePlanCode == 'free_trial') {
      await SupabaseTimesheetStorage.signOutHr();
      _showError(
        'Free trial ended on ${DateFormat('yyyy-MM-dd').format(companySettings.trialEndsAt)}. '
        'Please upgrade to Basic, Pro, or Premium.',
      );
      return;
    }

    final mappedCompanyCode =
        await SupabaseTimesheetStorage.getCompanyCodeById(mappedCompanyId);
    final effectiveCode = mappedCompanyCode ?? '';
    if (effectiveCode.isEmpty) {
      await SupabaseTimesheetStorage.signOutHr();
      _showError('Company code is not available for this account.');
      return;
    }

    if (!mounted) return;
    final timesheet = context.read<TimesheetProvider>();
    final jobProvider = context.read<JobProvider>();
    await timesheet.setCurrentEmployee(null);
    timesheet.setCurrentCompanyId(mappedCompanyId);
    jobProvider.setCompanyId(mappedCompanyId);
    await timesheet.loadEmployees();

    if (!mounted) return;
    showSuccessSnack(
      context,
      companySettings != null && companySettings.isInFreeTrial
          ? 'Welcome back. Free trial ends on ${DateFormat('yyyy-MM-dd').format(companySettings.trialEndsAt)}.'
          : 'Welcome back. Your company code is $effectiveCode.',
    );
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const EmployerDashboardScreen()),
    );
    AppTelemetry.logInfo(
      screen: 'hr_sign_in_screen',
      action: 'sign_in_success',
      details: 'role=${profile?.role ?? 'unknown'}',
    );
  }

  /// Completes `self_register_company` using data saved during HR onboarding,
  /// so users are not asked to re-enter company / owner names after verify OTP.
  Future<String?> _tryLinkCompanyFromRegistrationDraft() async {
    final draft = await HrSelfRegisterDraft.load();
    final user = Supabase.instance.client.auth.currentUser;
    if (draft == null || user?.email == null) return null;
    if (draft.normalizedEmail != user!.email!.trim().toLowerCase()) {
      return null;
    }

    if (draft.companyName.trim().isEmpty || draft.ownerFirstName.trim().isEmpty) {
      return null;
    }

    try {
      await SupabaseTimesheetStorage.registerCompanySelfService(
        companyName: draft.companyName,
        ownerFirstName: draft.ownerFirstName,
        ownerLastName: draft.ownerLastName,
      );
      await HrSelfRegisterDraft.clear();
    } catch (e) {
      final msg = e.toString().toLowerCase();
      if (msg.contains('already mapped')) {
        await HrSelfRegisterDraft.clear();
      } else {
        return null;
      }
    }
    return await SupabaseTimesheetStorage.getHrMappedCompanyIdForCurrentUser();
  }

  Future<bool> _promptCompleteSetup({HrSelfRegisterDraft? prefill}) async {
    if (!mounted) return false;
    final companyNameCtrl =
        TextEditingController(text: prefill?.companyName ?? '');
    final ownerFirstCtrl =
        TextEditingController(text: prefill?.ownerFirstName ?? '');
    final ownerLastCtrl =
        TextEditingController(text: prefill?.ownerLastName ?? '');
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (context) {
          return AlertDialog(
          title: Text(
            'Finish company registration',
            style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                prefill != null
                    ? 'This is the same step as “Step 3 of 3 · Register your company” on the signup path — '
                        'confirm company name and your name below (edit if needed).'
                    : 'Your HR login works, but no company is linked yet — usually because setup was interrupted.\n'
                        'Enter your company and name once; you become owner with full HR access and a linked employee profile.',
                style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF6B7280)),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: companyNameCtrl,
                decoration: const InputDecoration(labelText: 'Company name'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: ownerFirstCtrl,
                decoration: const InputDecoration(labelText: 'Your first name'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: ownerLastCtrl,
                decoration: const InputDecoration(
                  labelText: 'Your last name (optional)',
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(context).pop(true),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.gold,
                foregroundColor: AppTheme.black,
              ),
              child: const Text('Create company'),
            ),
          ],
          );
        },
      );
      if (confirmed != true) return false;

      final companyName = companyNameCtrl.text.trim();
      if (companyName.isEmpty) {
        _showError('Company name is required to complete setup.');
        return false;
      }
      final ownerFirst = ownerFirstCtrl.text.trim();
      if (ownerFirst.isEmpty) {
        _showError(
          'Your first name is required so we can create your owner employee profile.',
        );
        return false;
      }

      try {
        final result = await SupabaseTimesheetStorage.registerCompanySelfService(
          companyName: companyName,
          ownerFirstName: ownerFirst,
          ownerLastName: ownerLastCtrl.text,
        );
        await HrSelfRegisterDraft.clear();
        if (!mounted) return false;
        AppTelemetry.logInfo(
          screen: 'hr_sign_in_screen',
          action: 'company_setup_completed',
          details: 'company_code=${result.companyCode}',
        );
        return true;
      } catch (e) {
        if (!mounted) return false;
        AppTelemetry.logError(
          screen: 'hr_sign_in_screen',
          action: 'company_setup',
          error: e,
        );
        _showError(
          friendlyErrorMessage(e, fallback: 'Could not complete company setup.'),
        );
        return false;
      }
    } finally {
      companyNameCtrl.dispose();
      ownerFirstCtrl.dispose();
      ownerLastCtrl.dispose();
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    showErrorSnack(context, message);
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
          'HR Sign In',
          style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(horizontalPadding),
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: Responsive.contentMaxWidth(context).clamp(0, 520)),
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
                      'KaiSync Workforce',
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF111827),
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                      textAlign: TextAlign.center,
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
                            decoration: const InputDecoration(labelText: 'HR email'),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: _passwordCtrl,
                            obscureText: _obscure,
                            autofillHints: const [AutofillHints.password],
                            textInputAction: TextInputAction.done,
                            onSubmitted: (_) => _loading ? null : _signIn(),
                            decoration: InputDecoration(
                              labelText: 'Password',
                              suffixIcon: IconButton(
                                onPressed: () => setState(() => _obscure = !_obscure),
                                icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
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
                        onPressed: _loading ? null : _signIn,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.gold,
                          foregroundColor: AppTheme.black,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        child: _loading
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppTheme.black,
                                ),
                              )
                            : Text(
                                'Sign in as HR',
                                style: GoogleFonts.poppins(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 15,
                                ),
                              ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'Your company is resolved automatically from your HR account mapping.',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF6B7280),
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: _loading
                          ? null
                          : () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => const HrRegisterScreen(),
                                ),
                              ),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.gold,
                        side: const BorderSide(color: AppTheme.gold),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      icon: const Icon(Icons.app_registration),
                      label: Text(
                        'New company? Register here',
                        style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
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
