import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../theme/app_theme.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../widgets/load_error_panel.dart';
import '../widgets/app_feedback.dart';
import '_dashboard_decorators.dart';

class HrSettingsSection extends StatefulWidget {
  final bool canViewSensitiveData;
  final bool canTransferOwnership;

  const HrSettingsSection({
    super.key,
    required this.canViewSensitiveData,
    this.canTransferOwnership = false,
  });

  @override
  State<HrSettingsSection> createState() => _HrSettingsSectionState();
}

class _HrSettingsSectionState extends State<HrSettingsSection> {
  @override
  Widget build(BuildContext context) {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) {
      return const Center(
        child: PremiumEmptyState(
          icon: Icons.apartment_outlined,
          title: 'No company selected',
          subtitle: 'Choose a company to manage settings.',
        ),
      );
    }
    return FutureBuilder<
      (CompanySettings?, List<HrAccessUser>, List<String>, List<String>)
    >(
      future: () async {
        final settings = await SupabaseTimesheetStorage.getCompanySettings(
          companyId: companyId,
        );
        final accessUsers = await SupabaseTimesheetStorage.getHrAccessUsers(
          companyId: companyId,
        );
        final branches = await SupabaseTimesheetStorage.getCompanyBranches(
          companyId: companyId,
        );
        final employeeTypes =
            await SupabaseTimesheetStorage.getCompanyEmployeeTypes(
              companyId: companyId,
            );
        return (settings, accessUsers, branches, employeeTypes);
      }(),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(
              snapshot.error,
              fallback: 'Could not load company settings.',
            ),
            onRetry: () => setState(() {}),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting &&
            !snapshot.hasData) {
          return const PremiumLoadingIndicator(
            label: 'Loading company settings...',
          );
        }
        final settings = snapshot.data?.$1;
        final accessUsers = snapshot.data?.$2 ?? const <HrAccessUser>[];
        final branches = snapshot.data?.$3 ?? const <String>[];
        final employeeTypes = snapshot.data?.$4 ?? const <String>[];
        if (settings == null) {
          return const Center(child: Text('Company settings unavailable.'));
        }

        final nameCtrl = TextEditingController(text: settings.companyName);
        final canEdit = widget.canViewSensitiveData;
        final normalizedPlan = settings.effectivePlanCode;
        final planCatalog =
            <
              ({
                String code,
                String title,
                double price,
                int maxUsers,
                List<String> features,
              })
            >[
              (
                code: 'free_trial',
                title: 'Free Trial',
                price: 0,
                maxUsers: 20,
                features: const [
                  'Two months free access',
                  'Up to 20 users',
                  'Upgrade required after trial period',
                ],
              ),
              (
                code: 'basic',
                title: 'Basic',
                price: 700,
                maxUsers: 20,
                features: const [
                  'Core workforce management',
                  'Attendance, jobs, incidents',
                  'Branch + employee type setup',
                ],
              ),
              (
                code: 'pro',
                title: 'Pro',
                price: 1000,
                maxUsers: 80,
                features: const [
                  'Everything in Basic',
                  'Larger teams and operations',
                  'Advanced scheduling scale',
                ],
              ),
              (
                code: 'premium',
                title: 'Premium',
                price: 1500,
                maxUsers: 250,
                features: const [
                  'Everything in Pro',
                  'Highest user capacity',
                  'Priority support (placeholder)',
                ],
              ),
            ];

        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
          children: [
            const PremiumSectionHeader(
              icon: Icons.settings_outlined,
              title: 'Settings',
              subtitle:
                  'Control company profile, modules, plans, and governance.',
            ),
            const SizedBox(height: 12),

            // Branch Setup
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Branch Setup',
                      style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    if (branches.isEmpty)
                      Text(
                        'No branches added yet.',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF6B7280),
                          fontSize: 12,
                        ),
                      )
                    else
                      ...branches.map(
                        (b) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            b,
                            style: GoogleFonts.poppins(fontSize: 13),
                          ),
                          trailing: canEdit
                              ? Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      tooltip: 'Rename',
                                      icon: const Icon(Icons.edit_outlined),
                                      onPressed: () async {
                                        final ctrl = TextEditingController(
                                          text: b,
                                        );
                                        final renamed =
                                            await showDialog<String>(
                                              context: context,
                                              builder: (ctx) => AlertDialog(
                                                title: const Text(
                                                  'Rename branch',
                                                ),
                                                content: TextField(
                                                  controller: ctrl,
                                                  autofocus: true,
                                                  decoration:
                                                      const InputDecoration(
                                                        labelText:
                                                            'Branch name',
                                                      ),
                                                ),
                                                actions: [
                                                  TextButton(
                                                    onPressed: () =>
                                                        Navigator.of(ctx).pop(),
                                                    child: const Text('Cancel'),
                                                  ),
                                                  ElevatedButton(
                                                    onPressed: () =>
                                                        Navigator.of(
                                                          ctx,
                                                        ).pop(ctrl.text.trim()),
                                                    child: const Text('Save'),
                                                  ),
                                                ],
                                              ),
                                            );
                                        if (renamed == null ||
                                            renamed.trim().isEmpty)
                                          return;
                                        await SupabaseTimesheetStorage.renameCompanyBranch(
                                          companyId: companyId,
                                          oldName: b,
                                          newName: renamed,
                                        );
                                        if (!mounted) return;
                                        setState(() {});
                                        showSuccessSnack(
                                          this.context,
                                          'Branch renamed.',
                                        );
                                      },
                                    ),
                                    IconButton(
                                      tooltip: 'Delete',
                                      icon: const Icon(
                                        Icons.delete_outline,
                                        color: Colors.redAccent,
                                      ),
                                      onPressed: () async {
                                        final confirm = await showDialog<bool>(
                                          context: context,
                                          builder: (ctx) => AlertDialog(
                                            title: const Text('Remove branch?'),
                                            content: Text(
                                              'Branch "$b" will be removed from active options. Existing records stay intact.',
                                              style: GoogleFonts.poppins(
                                                fontSize: 13,
                                              ),
                                            ),
                                            actions: [
                                              TextButton(
                                                onPressed: () => Navigator.of(
                                                  ctx,
                                                ).pop(false),
                                                child: const Text('Cancel'),
                                              ),
                                              ElevatedButton(
                                                onPressed: () =>
                                                    Navigator.of(ctx).pop(true),
                                                style: ElevatedButton.styleFrom(
                                                  backgroundColor: const Color(
                                                    0xFFDC2626,
                                                  ),
                                                  foregroundColor: Colors.white,
                                                ),
                                                child: const Text('Remove'),
                                              ),
                                            ],
                                          ),
                                        );
                                        if (confirm != true) return;
                                        await SupabaseTimesheetStorage.deleteCompanyBranch(
                                          companyId: companyId,
                                          name: b,
                                        );
                                        if (!mounted) return;
                                        setState(() {});
                                        showSuccessSnack(
                                          this.context,
                                          'Branch removed.',
                                        );
                                      },
                                    ),
                                  ],
                                )
                              : null,
                        ),
                      ),
                    const SizedBox(height: 8),
                    if (canEdit)
                      OutlinedButton.icon(
                        onPressed: () async {
                          final ctrl = TextEditingController();
                          final added = await showDialog<String>(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              title: const Text('Add branch'),
                              content: TextField(
                                controller: ctrl,
                                autofocus: true,
                                decoration: const InputDecoration(
                                  labelText: 'Branch name',
                                ),
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.of(ctx).pop(),
                                  child: const Text('Cancel'),
                                ),
                                ElevatedButton(
                                  onPressed: () =>
                                      Navigator.of(ctx).pop(ctrl.text.trim()),
                                  child: const Text('Save'),
                                ),
                              ],
                            ),
                          );
                          if (added == null || added.trim().isEmpty) return;
                          await SupabaseTimesheetStorage.upsertCompanyBranch(
                            companyId: companyId,
                            name: added,
                          );
                          if (!mounted) return;
                          setState(() {});
                          showSuccessSnack(this.context, 'Branch added.');
                        },
                        icon: const Icon(Icons.add),
                        label: const Text('Add branch'),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            // App Release Config
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: FutureBuilder<AppReleaseConfig?>(
                  future: SupabaseTimesheetStorage.getAppReleaseConfig(),
                  builder: (context, releaseSnap) {
                    if (releaseSnap.connectionState ==
                            ConnectionState.waiting &&
                        !releaseSnap.hasData) {
                      return const Padding(
                        padding: EdgeInsets.symmetric(vertical: 18),
                        child: PremiumLoadingIndicator(
                          label: 'Loading app release settings...',
                        ),
                      );
                    }
                    if (releaseSnap.hasError) {
                      return Text(
                        'Could not load app release settings.',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFFB91C1C),
                          fontSize: 12,
                        ),
                      );
                    }
                    final cfg = releaseSnap.data;
                    final latestCtrl = TextEditingController(
                      text: cfg?.latestVersion ?? '0.1.0',
                    );
                    final minCtrl = TextEditingController(
                      text: cfg?.minimumSupportedVersion ?? '',
                    );
                    final androidCtrl = TextEditingController(
                      text: cfg?.updateUrlAndroid ?? '',
                    );
                    final iosCtrl = TextEditingController(
                      text: cfg?.updateUrlIos ?? '',
                    );
                    final webCtrl = TextEditingController(
                      text: cfg?.updateUrlWeb ?? '',
                    );
                    bool isEnabled = cfg?.isEnabled ?? true;
                    bool forceUpdate = cfg?.forceUpdate ?? false;

                    return StatefulBuilder(
                      builder: (context, setLocal) => Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'App Release & Update Policy',
                            style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Controls in-app update prompts for all users.',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF6B7280),
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(height: 10),
                          SwitchListTile(
                            value: isEnabled,
                            onChanged: canEdit
                                ? (v) => setLocal(() => isEnabled = v)
                                : null,
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Enable update checks'),
                          ),
                          SwitchListTile(
                            value: forceUpdate,
                            onChanged: canEdit
                                ? (v) => setLocal(() => forceUpdate = v)
                                : null,
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Force update'),
                            subtitle: const Text(
                              'When enabled, users cannot skip update.',
                            ),
                          ),
                          const SizedBox(height: 8),
                          TextField(
                            controller: latestCtrl,
                            enabled: canEdit,
                            decoration: const InputDecoration(
                              labelText: 'Latest version',
                              helperText: 'Example: 0.1.1',
                            ),
                          ),
                          const SizedBox(height: 8),
                          TextField(
                            controller: minCtrl,
                            enabled: canEdit,
                            decoration: const InputDecoration(
                              labelText: 'Minimum supported version (optional)',
                              helperText:
                                  'If current app is below this, update is mandatory.',
                            ),
                          ),
                          const SizedBox(height: 8),
                          TextField(
                            controller: androidCtrl,
                            enabled: canEdit,
                            decoration: const InputDecoration(
                              labelText: 'Android update URL',
                            ),
                          ),
                          const SizedBox(height: 8),
                          TextField(
                            controller: iosCtrl,
                            enabled: canEdit,
                            decoration: const InputDecoration(
                              labelText: 'iOS update URL',
                            ),
                          ),
                          const SizedBox(height: 8),
                          TextField(
                            controller: webCtrl,
                            enabled: canEdit,
                            decoration: const InputDecoration(
                              labelText: 'Web update URL',
                            ),
                          ),
                          const SizedBox(height: 10),
                          if (canEdit)
                            Align(
                              alignment: Alignment.centerRight,
                              child: ElevatedButton.icon(
                                onPressed: () async {
                                  final latest = latestCtrl.text.trim();
                                  if (latest.isEmpty) {
                                    showInfoSnack(
                                      context,
                                      'Latest version is required.',
                                    );
                                    return;
                                  }
                                  await SupabaseTimesheetStorage.upsertAppReleaseConfig(
                                    isEnabled: isEnabled,
                                    latestVersion: latest,
                                    minimumSupportedVersion: minCtrl.text
                                        .trim(),
                                    forceUpdate: forceUpdate,
                                    updateUrlAndroid: androidCtrl.text.trim(),
                                    updateUrlIos: iosCtrl.text.trim(),
                                    updateUrlWeb: webCtrl.text.trim(),
                                  );
                                  if (!context.mounted) return;
                                  showSuccessSnack(
                                    context,
                                    'App release settings updated.',
                                  );
                                  setState(() {});
                                },
                                icon: const Icon(Icons.system_update_alt),
                                label: const Text('Save release settings'),
                              ),
                            )
                          else
                            Text(
                              'Only HR Admin can edit app release settings.',
                              style: GoogleFonts.poppins(
                                color: const Color(0xFF6B7280),
                                fontSize: 12,
                              ),
                            ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ),
            const SizedBox(height: 12),

            // Employee Types Setup
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Employee Types Setup',
                      style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    if (employeeTypes.isEmpty)
                      Text(
                        'No employee types added yet.',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF6B7280),
                          fontSize: 12,
                        ),
                      )
                    else
                      ...employeeTypes.map(
                        (t) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            t,
                            style: GoogleFonts.poppins(fontSize: 13),
                          ),
                          trailing: canEdit
                              ? Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      tooltip: 'Rename',
                                      icon: const Icon(Icons.edit_outlined),
                                      onPressed: () async {
                                        final ctrl = TextEditingController(
                                          text: t,
                                        );
                                        final renamed =
                                            await showDialog<String>(
                                              context: context,
                                              builder: (ctx) => AlertDialog(
                                                title: const Text(
                                                  'Rename employee type',
                                                ),
                                                content: TextField(
                                                  controller: ctrl,
                                                  autofocus: true,
                                                  decoration:
                                                      const InputDecoration(
                                                        labelText: 'Type name',
                                                      ),
                                                ),
                                                actions: [
                                                  TextButton(
                                                    onPressed: () =>
                                                        Navigator.of(ctx).pop(),
                                                    child: const Text('Cancel'),
                                                  ),
                                                  ElevatedButton(
                                                    onPressed: () =>
                                                        Navigator.of(
                                                          ctx,
                                                        ).pop(ctrl.text.trim()),
                                                    child: const Text('Save'),
                                                  ),
                                                ],
                                              ),
                                            );
                                        if (renamed == null ||
                                            renamed.trim().isEmpty)
                                          return;
                                        await SupabaseTimesheetStorage.renameCompanyEmployeeType(
                                          companyId: companyId,
                                          oldName: t,
                                          newName: renamed,
                                        );
                                        if (!mounted) return;
                                        setState(() {});
                                        showSuccessSnack(
                                          this.context,
                                          'Employee type renamed.',
                                        );
                                      },
                                    ),
                                    IconButton(
                                      tooltip: 'Delete',
                                      icon: const Icon(
                                        Icons.delete_outline,
                                        color: Colors.redAccent,
                                      ),
                                      onPressed: () async {
                                        final confirm = await showDialog<bool>(
                                          context: context,
                                          builder: (ctx) => AlertDialog(
                                            title: const Text(
                                              'Remove employee type?',
                                            ),
                                            content: Text(
                                              'Employee type "$t" will be removed from active options. Existing records stay intact.',
                                              style: GoogleFonts.poppins(
                                                fontSize: 13,
                                              ),
                                            ),
                                            actions: [
                                              TextButton(
                                                onPressed: () => Navigator.of(
                                                  ctx,
                                                ).pop(false),
                                                child: const Text('Cancel'),
                                              ),
                                              ElevatedButton(
                                                onPressed: () =>
                                                    Navigator.of(ctx).pop(true),
                                                style: ElevatedButton.styleFrom(
                                                  backgroundColor: const Color(
                                                    0xFFDC2626,
                                                  ),
                                                  foregroundColor: Colors.white,
                                                ),
                                                child: const Text('Remove'),
                                              ),
                                            ],
                                          ),
                                        );
                                        if (confirm != true) return;
                                        await SupabaseTimesheetStorage.deleteCompanyEmployeeType(
                                          companyId: companyId,
                                          name: t,
                                        );
                                        if (!mounted) return;
                                        setState(() {});
                                        showSuccessSnack(
                                          this.context,
                                          'Employee type removed.',
                                        );
                                      },
                                    ),
                                  ],
                                )
                              : null,
                        ),
                      ),
                    const SizedBox(height: 8),
                    if (canEdit)
                      OutlinedButton.icon(
                        onPressed: () async {
                          final ctrl = TextEditingController();
                          final added = await showDialog<String>(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              title: const Text('Add employee type'),
                              content: TextField(
                                controller: ctrl,
                                autofocus: true,
                                decoration: const InputDecoration(
                                  labelText: 'Type name',
                                ),
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.of(ctx).pop(),
                                  child: const Text('Cancel'),
                                ),
                                ElevatedButton(
                                  onPressed: () =>
                                      Navigator.of(ctx).pop(ctrl.text.trim()),
                                  child: const Text('Save'),
                                ),
                              ],
                            ),
                          );
                          if (added == null || added.trim().isEmpty) return;
                          await SupabaseTimesheetStorage.upsertCompanyEmployeeType(
                            companyId: companyId,
                            name: added,
                          );
                          if (!mounted) return;
                          setState(() {});
                          showSuccessSnack(
                            this.context,
                            'Employee type added.',
                          );
                        },
                        icon: const Icon(Icons.add),
                        label: const Text('Add employee type'),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            // Company profile
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextField(
                      controller: nameCtrl,
                      enabled: canEdit,
                      decoration: const InputDecoration(
                        labelText: 'Company name',
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: TextEditingController(
                        text: settings.companyCode,
                      ),
                      enabled: false,
                      decoration: const InputDecoration(
                        labelText: 'Company code',
                        helperText:
                            'Company code is system generated and cannot be changed.',
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (canEdit)
                      Align(
                        alignment: Alignment.centerRight,
                        child: ElevatedButton.icon(
                          onPressed: () async {
                            final newName = nameCtrl.text.trim();
                            if (newName.isEmpty) {
                              showInfoSnack(
                                context,
                                'Company name is required.',
                              );
                              return;
                            }
                            await SupabaseTimesheetStorage.updateCompanyName(
                              companyId: companyId,
                              name: newName,
                            );
                            if (!mounted) return;
                            setState(() {});
                            showSuccessSnack(
                              this.context,
                              'Company name updated.',
                            );
                          },
                          icon: const Icon(Icons.save_outlined),
                          label: const Text('Save profile'),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            _DispatchIntelligenceCard(
              companyId: companyId,
              initialSettings: settings.dispatchSettings,
              canEdit: canEdit,
            ),
            const SizedBox(height: 12),

            // Modules — toggle features on/off per company
            const _ModulesCard(),
            const SizedBox(height: 12),

            // Subscription Plans
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Subscription Plans',
                      style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF9FAFB),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFE5E7EB)),
                      ),
                      child: Text(
                        'Current users: ${settings.currentUsers}/${settings.isInFreeTrial ? 20 : settings.maxUsers}\n'
                        '${settings.canAddUser ? 'You can add more users on this plan.' : 'Plan limit reached. Upgrade required before adding users.'}\n'
                        'Current plan: ${settings.effectivePlanCode.replaceAll('_', ' ').toUpperCase()}',
                        style: GoogleFonts.poppins(
                          fontSize: 12,
                          color: const Color(0xFF374151),
                        ),
                      ),
                    ),
                    if (settings.isInFreeTrial)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          'Free trial ends on ${DateFormat('yyyy-MM-dd').format(settings.trialEndsAt)}',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            color: const Color(0xFF6B7280),
                          ),
                        ),
                      ),
                    const SizedBox(height: 12),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        final useCarousel = constraints.maxWidth < 980;
                        Widget buildPlanCard(
                          ({
                            String code,
                            String title,
                            double price,
                            int maxUsers,
                            List<String> features,
                          })
                          p, {
                          required double width,
                        }) {
                          final isCurrent = p.code == normalizedPlan;
                          final isPopular = p.code == 'pro';
                          final isPremium = p.code == 'premium';
                          final isFreeTrial = p.code == 'free_trial';
                          final isLightCard =
                              isCurrent && !isPremium && !isFreeTrial;
                          return Container(
                            width: width,
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              gradient: isPremium
                                  ? const LinearGradient(
                                      colors: [
                                        Color(0xFF2B2F6E),
                                        Color(0xFF3C2B78),
                                      ],
                                      begin: Alignment.topLeft,
                                      end: Alignment.bottomRight,
                                    )
                                  : null,
                              color: isPremium
                                  ? null
                                  : (isFreeTrial
                                        ? const Color(0xFF1E2A78)
                                        : (isCurrent
                                              ? const Color(0xFFEFF4FF)
                                              : const Color(0xFF111827))),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: isCurrent
                                    ? AppTheme.gold
                                    : (isPremium
                                          ? const Color(0xFF6366F1)
                                          : const Color(0xFF374151)),
                                width: isCurrent ? 1.4 : 1,
                              ),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(
                                      p.title,
                                      style: GoogleFonts.poppins(
                                        fontSize: 18,
                                        fontWeight: FontWeight.w700,
                                        color: (isPremium || isFreeTrial)
                                            ? Colors.white
                                            : (isLightCard
                                                  ? const Color(0xFF111827)
                                                  : const Color(0xFFF9FAFB)),
                                      ),
                                    ),
                                    const Spacer(),
                                    if (isPopular)
                                      Container(
                                        margin: const EdgeInsets.only(right: 6),
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 8,
                                          vertical: 4,
                                        ),
                                        decoration: BoxDecoration(
                                          color: const Color(
                                            0xFF6366F1,
                                          ).withValues(alpha: 0.20),
                                          borderRadius: BorderRadius.circular(
                                            999,
                                          ),
                                          border: Border.all(
                                            color: const Color(0xFF6366F1),
                                          ),
                                        ),
                                        child: Text(
                                          'Popular',
                                          style: GoogleFonts.poppins(
                                            fontSize: 10,
                                            fontWeight: FontWeight.w700,
                                            color: const Color(0xFFA5B4FC),
                                          ),
                                        ),
                                      ),
                                    if (isCurrent)
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 8,
                                          vertical: 4,
                                        ),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFD1FAE5)
                                              .withValues(
                                                alpha: isPremium ? 0.18 : 1,
                                              ),
                                          borderRadius: BorderRadius.circular(
                                            999,
                                          ),
                                        ),
                                        child: Text(
                                          'Current plan',
                                          style: GoogleFonts.poppins(
                                            fontSize: 10,
                                            fontWeight: FontWeight.w600,
                                            color: const Color(0xFF065F46),
                                          ),
                                        ),
                                      ),
                                  ],
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'R ${p.price.toStringAsFixed(0)} / month',
                                  style: GoogleFonts.poppins(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w700,
                                    color: (isPremium || isFreeTrial)
                                        ? Colors.white
                                        : (isLightCard
                                              ? const Color(0xFF111827)
                                              : const Color(0xFFF9FAFB)),
                                  ),
                                ),
                                Text(
                                  'Up to ${p.maxUsers} users',
                                  style: GoogleFonts.poppins(
                                    fontSize: 12,
                                    color: (isPremium || isFreeTrial)
                                        ? const Color(0xFFD1D5DB)
                                        : (isLightCard
                                              ? const Color(0xFF374151)
                                              : const Color(0xFF9CA3AF)),
                                  ),
                                ),
                                const SizedBox(height: 10),
                                ...p.features.map(
                                  (f) => Padding(
                                    padding: const EdgeInsets.only(bottom: 4),
                                    child: Text(
                                      '- $f',
                                      style: GoogleFonts.poppins(
                                        fontSize: 12,
                                        color: (isPremium || isFreeTrial)
                                            ? const Color(0xFFE5E7EB)
                                            : (isLightCard
                                                  ? const Color(0xFF111827)
                                                  : const Color(0xFFD1D5DB)),
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 10),
                                SizedBox(
                                  width: double.infinity,
                                  child: ElevatedButton(
                                    onPressed: (!canEdit || isCurrent)
                                        ? null
                                        : () async {
                                            if (p.code == 'free_trial') return;
                                            await SupabaseTimesheetStorage.updateSubscriptionPlaceholders(
                                              companyId: companyId,
                                              planCode: p.code,
                                              planPriceZar: p.price,
                                              maxUsers: p.maxUsers,
                                              subscriptionActive: true,
                                            );
                                            if (!context.mounted) return;
                                            showSuccessSnack(
                                              context,
                                              'Plan upgraded to ${p.title}.',
                                            );
                                            setState(() {});
                                          },
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: isPremium
                                          ? const Color(0xFF6366F1)
                                          : AppTheme.gold,
                                      foregroundColor: isPremium
                                          ? Colors.white
                                          : AppTheme.black,
                                    ),
                                    child: Text(
                                      isCurrent
                                          ? 'Your current plan'
                                          : (p.code == 'free_trial'
                                                ? 'Trial plan'
                                                : 'Upgrade to ${p.title}'),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          );
                        }

                        if (useCarousel) {
                          final cardWidth = (constraints.maxWidth * 0.86).clamp(
                            260.0,
                            340.0,
                          );
                          return SizedBox(
                            height: 360,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: planCatalog.length,
                              separatorBuilder: (_, _) =>
                                  const SizedBox(width: 12),
                              itemBuilder: (_, i) => buildPlanCard(
                                planCatalog[i],
                                width: cardWidth,
                              ),
                            ),
                          );
                        }
                        return Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: planCatalog
                              .map((p) => buildPlanCard(p, width: 300))
                              .toList(),
                        );
                      },
                    ),
                    if (!canEdit)
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Text(
                          'Only HR Admin can upgrade plans.',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280),
                            fontSize: 12,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),

            // HR / Manager Access
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'HR / Manager Access',
                      style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                    if (accessUsers.isEmpty)
                      Text(
                        'No HR access users configured yet.',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF6B7280),
                          fontSize: 12,
                        ),
                      )
                    else
                      ...accessUsers.map((u) {
                        final roleLabel = switch (u.role) {
                          'manager' => 'Manager',
                          'owner' => 'Company owner',
                          'admin' => 'HR Admin',
                          'hr_admin' || 'hr' => 'HR Admin',
                          _ => u.role,
                        };
                        final display =
                            (u.displayName?.trim().isNotEmpty == true)
                            ? u.displayName!
                            : (u.role == 'manager'
                                  ? 'Manager account'
                                  : (u.role == 'admin' ||
                                        u.role == 'owner' ||
                                        u.role == 'hr_admin')
                                  ? 'HR account'
                                  : 'Account');
                        final myUid =
                            Supabase.instance.client.auth.currentUser?.id;
                        final canOfferTransfer = widget.canTransferOwnership &&
                            widget.canViewSensitiveData &&
                            myUid != null &&
                            u.isActive &&
                            u.authUserId != myUid &&
                            u.role != 'owner';
                        return ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            u.isActive
                                ? Icons.verified_user_outlined
                                : Icons.person_off_outlined,
                            size: 18,
                            color: u.isActive
                                ? const Color(0xFF059669)
                                : const Color(0xFF9CA3AF),
                          ),
                          title: Text(
                            display,
                            style: GoogleFonts.poppins(fontSize: 13),
                          ),
                          subtitle: Text(
                            '$roleLabel${u.isActive ? '' : ' (inactive)'}',
                            style: GoogleFonts.poppins(
                              fontSize: 11,
                              color: const Color(0xFF6B7280),
                            ),
                          ),
                          trailing: canOfferTransfer
                              ? TextButton(
                                  onPressed: () async {
                                    final ok = await showDialog<bool>(
                                      context: context,
                                      builder: (ctx) => AlertDialog(
                                        title: const Text('Transfer ownership'),
                                        content: Text(
                                          'Make this user the company owner? '
                                          'You will keep HR admin access.',
                                          style: GoogleFonts.poppins(fontSize: 13),
                                        ),
                                        actions: [
                                          TextButton(
                                            onPressed: () =>
                                                Navigator.pop(ctx, false),
                                            child: const Text('Cancel'),
                                          ),
                                          ElevatedButton(
                                            onPressed: () =>
                                                Navigator.pop(ctx, true),
                                            child: const Text('Transfer'),
                                          ),
                                        ],
                                      ),
                                    );
                                    if (ok != true || !context.mounted) return;
                                    try {
                                      await SupabaseTimesheetStorage
                                          .transferHrCompanyOwnership(
                                        companyId: companyId,
                                        newOwnerAuthUserId: u.authUserId,
                                      );
                                      if (!context.mounted) return;
                                      showSuccessSnack(
                                        context,
                                        'Ownership transferred. Reload the app or sign out and '
                                        'back in so menus pick up your new role.',
                                      );
                                      setState(() {});
                                    } catch (e) {
                                      if (!context.mounted) return;
                                      showErrorSnack(
                                        context,
                                        friendlyErrorMessage(
                                          e,
                                          fallback:
                                              'Could not transfer ownership.',
                                        ),
                                      );
                                    }
                                  },
                                  child: const Text('Make owner'),
                                )
                              : null,
                        );
                      }),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Module on/off switches. Reads from / writes to the active company's
/// `enabled_modules` JSONB via TimesheetProvider.
class _ModulesCard extends StatelessWidget {
  const _ModulesCard();

  static const _modules = <_ModuleSpec>[
    _ModuleSpec(
      key: 'ticketing',
      title: 'Jobs/Projects',
      description: 'Create and assign field jobs and linked projects.',
      icon: Icons.work_outline,
    ),
    _ModuleSpec(
      key: 'clients',
      title: 'Clients',
      description: 'Client register, details, linked projects and payments.',
      icon: Icons.handshake_outlined,
    ),
    _ModuleSpec(
      key: 'inventory',
      title: 'Inventory',
      description: 'Inventory register, stock and usage allocation.',
      icon: Icons.inventory_2_outlined,
    ),
    _ModuleSpec(
      key: 'attendance',
      title: 'Attendance',
      description: 'Clock-ins, sessions, and attendance history.',
      icon: Icons.access_time_outlined,
    ),
    _ModuleSpec(
      key: 'reports',
      title: 'Reports',
      description: 'Operational, executive, and compliance reporting.',
      icon: Icons.calendar_today_outlined,
    ),
    _ModuleSpec(
      key: 'scheduling',
      title: 'Scheduling',
      description: 'Recurring shift templates and assignments.',
      icon: Icons.event_note_outlined,
    ),
    _ModuleSpec(
      key: 'payroll',
      title: 'Payments',
      description: 'Salary, hourly rates, payment approvals.',
      icon: Icons.payments_outlined,
    ),
    _ModuleSpec(
      key: 'paperless',
      title: 'Paperless Ops & Incidents',
      description: 'Custom forms, signatures, incident reporting.',
      icon: Icons.receipt_long_outlined,
    ),
    _ModuleSpec(
      key: 'employees',
      title: 'Employees',
      description: 'Employee records, assignments, and access controls.',
      icon: Icons.people_outline,
    ),
    _ModuleSpec(
      key: 'contractors',
      title: 'Contractors',
      description: 'External service providers with their own scorecard.',
      icon: Icons.engineering_outlined,
    ),
    _ModuleSpec(
      key: 'property_management',
      title: 'Property Management',
      description:
          'Sites → units → residents. Repeat-issue detection, '
          'per-unit reporting.',
      icon: Icons.apartment_outlined,
    ),
    _ModuleSpec(
      key: 'asset_compliance',
      title: 'Asset Compliance',
      description:
          'Geysers, lifts, fire panels — inspection schedules and '
          'certificate expiry tracking.',
      icon: Icons.precision_manufacturing_outlined,
    ),
    _ModuleSpec(
      key: 'my_pa',
      title: 'My PA',
      description: 'Personal assistant tasks, reminders, and follow-ups.',
      icon: Icons.assistant_navigation,
    ),
    _ModuleSpec(
      key: 'leave',
      title: 'Leave',
      description:
          'Employee leave applications, approvals, and payroll-ready export.',
      icon: Icons.event_note_outlined,
    ),
    _ModuleSpec(
      key: 'messaging',
      title: 'Messaging',
      description:
          'In-app team messaging feed between employees and management.',
      icon: Icons.forum_outlined,
    ),
    _ModuleSpec(
      key: 'settings',
      title: 'Settings',
      description: 'Company profile, module controls, and system preferences.',
      icon: Icons.settings_outlined,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Consumer<TimesheetProvider>(
      builder: (context, prov, _) {
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Modules',
                  style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 4),
                Text(
                  'Turn features on or off for this company. Disabling a '
                  'module hides it from the sidebar — your data is kept.',
                  style: GoogleFonts.poppins(
                    fontSize: 11,
                    color: const Color(0xFF6B7280),
                  ),
                ),
                const SizedBox(height: 12),
                Align(
                  alignment: Alignment.centerRight,
                  child: Wrap(
                    spacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: () async {
                          final keys = _modules
                              .map((m) => m.key)
                              .toList(growable: false);
                          await prov.setAllModulesEnabled(
                            keys: keys,
                            enabled: true,
                          );
                          if (!context.mounted) return;
                          showSuccessSnack(context, 'All modules enabled.');
                        },
                        icon: const Icon(Icons.done_all_outlined, size: 16),
                        label: const Text('Enable all'),
                      ),
                      OutlinedButton.icon(
                        onPressed: () async {
                          final keys = _modules
                              .map((m) => m.key)
                              .toList(growable: false);
                          await prov.setAllModulesEnabled(
                            keys: keys,
                            enabled: false,
                          );
                          if (!context.mounted) return;
                          showSuccessSnack(context, 'All modules disabled.');
                        },
                        icon: const Icon(Icons.remove_done_outlined, size: 16),
                        label: const Text('Disable all'),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
                ..._modules.map((m) {
                  final value = prov.isModuleEnabled(
                    m.key,
                    defaultIfMissing: true,
                  );
                  return SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: value,
                    title: Row(
                      children: [
                        Icon(m.icon, size: 18, color: const Color(0xFF6B7280)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            m.title,
                            style: GoogleFonts.poppins(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: const Color(0xFF111827),
                            ),
                          ),
                        ),
                      ],
                    ),
                    subtitle: Padding(
                      padding: const EdgeInsets.only(left: 26, top: 2),
                      child: Text(
                        m.description,
                        style: GoogleFonts.poppins(
                          fontSize: 11,
                          color: const Color(0xFF6B7280),
                        ),
                      ),
                    ),
                    onChanged: (v) async {
                      try {
                        await prov.setModuleEnabled(m.key, v);
                        if (!context.mounted) return;
                        showSuccessSnack(
                          context,
                          v ? '${m.title} enabled.' : '${m.title} disabled.',
                        );
                      } catch (e) {
                        if (!context.mounted) return;
                        showErrorSnack(
                          context,
                          'Could not update module: ${friendlyErrorMessage(e, fallback: 'unknown error')}',
                        );
                      }
                    },
                  );
                }),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _DispatchIntelligenceCard extends StatefulWidget {
  final String companyId;
  final Map<String, dynamic> initialSettings;
  final bool canEdit;

  const _DispatchIntelligenceCard({
    required this.companyId,
    required this.initialSettings,
    required this.canEdit,
  });

  @override
  State<_DispatchIntelligenceCard> createState() =>
      _DispatchIntelligenceCardState();
}

class _DispatchIntelligenceCardState extends State<_DispatchIntelligenceCard> {
  late double _workloadPenalty;
  late double _conflictPenalty;
  late double _employeeBonus;
  late double _technicianBonus;
  late double _contractorPenalty;
  late double _maxActiveJobs;
  late bool _excludeConflicts;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final s = widget.initialSettings;
    _workloadPenalty =
        (s['workload_penalty_per_active_job'] as num?)?.toDouble() ?? 10;
    _conflictPenalty = (s['conflict_penalty'] as num?)?.toDouble() ?? 25;
    _employeeBonus = (s['employee_preference_bonus'] as num?)?.toDouble() ?? 8;
    _technicianBonus =
        (s['technician_preference_bonus'] as num?)?.toDouble() ?? 4;
    _contractorPenalty = (s['contractor_penalty'] as num?)?.toDouble() ?? 6;
    _maxActiveJobs = (s['max_active_jobs'] as num?)?.toDouble() ?? 8;
    _excludeConflicts = (s['exclude_conflicts'] as bool?) ?? false;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await SupabaseTimesheetStorage.updateDispatchSettings(
        companyId: widget.companyId,
        settings: {
          'workload_penalty_per_active_job': _workloadPenalty,
          'conflict_penalty': _conflictPenalty,
          'employee_preference_bonus': _employeeBonus,
          'technician_preference_bonus': _technicianBonus,
          'contractor_penalty': _contractorPenalty,
          'max_active_jobs': _maxActiveJobs,
          'exclude_conflicts': _excludeConflicts,
        },
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Dispatch intelligence settings saved.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Could not save dispatch settings.'),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _sliderRow({
    required String label,
    required String hint,
    required double value,
    required double min,
    required double max,
    required int divisions,
    required ValueChanged<double> onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: GoogleFonts.poppins(
                  fontWeight: FontWeight.w500,
                  fontSize: 12,
                ),
              ),
            ),
            Text(
              value.toStringAsFixed(0),
              style: GoogleFonts.poppins(
                color: const Color(0xFF6B7280),
                fontSize: 12,
              ),
            ),
          ],
        ),
        Slider(
          value: value.clamp(min, max),
          min: min,
          max: max,
          divisions: divisions,
          onChanged: widget.canEdit && !_saving ? onChanged : null,
        ),
        Text(
          hint,
          style: GoogleFonts.poppins(
            fontSize: 11,
            color: const Color(0xFF6B7280),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Dispatch Intelligence',
              style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              'Tune how the best-worker score is calculated for job assignment suggestions.',
              style: GoogleFonts.poppins(
                fontSize: 11,
                color: const Color(0xFF6B7280),
              ),
            ),
            const SizedBox(height: 10),
            _sliderRow(
              label: 'Workload penalty (per active job)',
              hint: 'Higher values push work toward less busy workers.',
              value: _workloadPenalty,
              min: 0,
              max: 30,
              divisions: 30,
              onChanged: (v) => setState(() => _workloadPenalty = v),
            ),
            _sliderRow(
              label: 'Conflict penalty',
              hint: 'Penalty applied for overlapping schedules.',
              value: _conflictPenalty,
              min: 0,
              max: 60,
              divisions: 60,
              onChanged: (v) => setState(() => _conflictPenalty = v),
            ),
            _sliderRow(
              label: 'Employee preference bonus',
              hint: 'Bias toward internal employees when scores are close.',
              value: _employeeBonus,
              min: 0,
              max: 20,
              divisions: 20,
              onChanged: (v) => setState(() => _employeeBonus = v),
            ),
            _sliderRow(
              label: 'Technician preference bonus',
              hint: 'Additional preference for technician worker type.',
              value: _technicianBonus,
              min: 0,
              max: 20,
              divisions: 20,
              onChanged: (v) => setState(() => _technicianBonus = v),
            ),
            _sliderRow(
              label: 'Contractor penalty',
              hint: 'Penalty applied to contractor/subcontractor suggestions.',
              value: _contractorPenalty,
              min: 0,
              max: 20,
              divisions: 20,
              onChanged: (v) => setState(() => _contractorPenalty = v),
            ),
            _sliderRow(
              label: 'Soft max active jobs',
              hint:
                  'Workers above this count receive an extra score reduction.',
              value: _maxActiveJobs,
              min: 1,
              max: 20,
              divisions: 19,
              onChanged: (v) => setState(() => _maxActiveJobs = v),
            ),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              title: Text(
                'Exclude workers with schedule conflicts',
                style: GoogleFonts.poppins(fontSize: 12),
              ),
              value: _excludeConflicts,
              onChanged: widget.canEdit && !_saving
                  ? (v) => setState(() => _excludeConflicts = v)
                  : null,
            ),
            if (widget.canEdit)
              Align(
                alignment: Alignment.centerRight,
                child: ElevatedButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.save_outlined),
                  label: const Text('Save dispatch settings'),
                ),
              )
            else
              Text(
                'Only HR Admin can edit dispatch intelligence settings.',
                style: GoogleFonts.poppins(
                  fontSize: 11,
                  color: const Color(0xFF6B7280),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ModuleSpec {
  final String key;
  final String title;
  final String description;
  final IconData icon;

  const _ModuleSpec({
    required this.key,
    required this.title,
    required this.description,
    required this.icon,
  });
}
