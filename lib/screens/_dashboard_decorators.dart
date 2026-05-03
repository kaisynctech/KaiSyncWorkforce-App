import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../services/export_service.dart';
import '../services/app_telemetry.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';

Widget buildExportButton({
  required BuildContext context,
  required String fileName,
  required List<String> headers,
  required List<List<String>> rows,
}) {
  Future<void> doExport(ExportFormat format) async {
    try {
      await ExportService.exportTable(
        fileBaseName: fileName,
        headers: headers,
        rows: rows,
        format: format,
      );
      if (!context.mounted) return;
      showSuccessSnack(context, 'Export completed.');
    } catch (e) {
      AppTelemetry.logError(screen: 'dashboard', action: 'export', error: e);
      if (!context.mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Export failed.'),
      );
    }
  }

  return PopupMenuButton<ExportFormat>(
    tooltip: 'Export',
    onSelected: doExport,
    itemBuilder: (_) => const [
      PopupMenuItem(value: ExportFormat.csv, child: Text('Export CSV')),
      PopupMenuItem(
        value: ExportFormat.excelCsv,
        child: Text('Export Excel (CSV)'),
      ),
      PopupMenuItem(value: ExportFormat.pdf, child: Text('Export PDF')),
    ],
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.download_outlined, size: 16, color: AppTheme.gold),
          const SizedBox(width: 6),
          Text(
            'Export',
            style: GoogleFonts.poppins(
              color: AppTheme.gold,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    ),
  );
}

class DashboardStatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const DashboardStatCard({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      width: Responsive.statCardWidth(context),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF0F172A), Color(0xFF1E293B)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0x22FFFFFF)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.10 * 255),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppTheme.gold.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Icon(icon, size: 20, color: AppTheme.gold),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: GoogleFonts.poppins(
                    color: AppTheme.textGray,
                    fontSize: 11,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: GoogleFonts.poppins(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

enum DashboardSection {
  dashboard,
  notifications,
  payments,
  inventory,
  attendance,
  reports,
  scheduling,
  myPa,
  leave,
  messages,
  jobs,
  clients,
  incidents,
  employees,
  /// Property management hub: properties, residents, assets (module-gated).
  propertyManagement,
  contractors,
  settings,
}

class DashboardSidebar extends StatelessWidget {
  final DashboardSection selected;
  final ValueChanged<DashboardSection> onSectionSelected;
  final String? companyCode;
  final String? companyName;
  final VoidCallback? onBackTap;

  /// Module flags (key -> enabled). When null or empty, all sections show
  /// (back-compat for screens that haven't been updated yet).
  final Map<String, bool>? enabledModules;

  const DashboardSidebar({
    super.key,
    required this.selected,
    required this.onSectionSelected,
    this.companyCode,
    this.companyName,
    this.onBackTap,
    this.enabledModules,
  });

  bool _moduleOn(String key, {bool defaultIfMissing = true}) {
    final m = enabledModules;
    if (m == null || m.isEmpty) return defaultIfMissing;
    return m[key] ?? defaultIfMissing;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: Responsive.sidebarWidth(context),
      decoration: BoxDecoration(
        color: const Color(0xFFE5EDFF),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 20,
            offset: const Offset(2, 0),
          ),
        ],
      ),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          height: 82,
                          child: Image.asset(
                            'assets/images/kaisync_logo.png',
                            fit: BoxFit.contain,
                            alignment: Alignment.centerLeft,
                            errorBuilder: (context, error, stackTrace) =>
                                const SizedBox.shrink(),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          'KaiSync Workforce',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF111827),
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'HR',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280),
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (companyCode != null && companyCode!.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(
                                color: const Color(0xFFD1D5DB),
                              ),
                            ),
                            child: Text(
                              'Company code: $companyCode',
                              style: GoogleFonts.poppins(
                                color: const Color(0xFF374151),
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                        if (companyName != null &&
                            companyName!.trim().isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            companyName!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF111827),
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  _SidebarSectionTitle(label: 'General'),
                  _SidebarItem(
                    icon: Icons.dashboard_outlined,
                    label: 'Dashboard',
                    isActive: selected == DashboardSection.dashboard,
                    onTap: () => onSectionSelected(DashboardSection.dashboard),
                  ),
                  _SidebarItem(
                    icon: Icons.notifications_none,
                    label: 'Notifications',
                    isActive: selected == DashboardSection.notifications,
                    onTap: () =>
                        onSectionSelected(DashboardSection.notifications),
                  ),
                  if (_moduleOn('payroll'))
                    _SidebarItem(
                      icon: Icons.payments_outlined,
                      label: 'Payments',
                      isActive: selected == DashboardSection.payments,
                      onTap: () => onSectionSelected(DashboardSection.payments),
                    ),
                  if (_moduleOn('inventory'))
                    _SidebarItem(
                      icon: Icons.inventory_2_outlined,
                      label: 'Inventory',
                      isActive: selected == DashboardSection.inventory,
                      onTap: () =>
                          onSectionSelected(DashboardSection.inventory),
                    ),
                  if (_moduleOn('ticketing'))
                    _SidebarItem(
                      icon: Icons.work_outline,
                      label: 'Jobs/Projects',
                      isActive: selected == DashboardSection.jobs,
                      onTap: () => onSectionSelected(DashboardSection.jobs),
                    ),
                  if (_moduleOn('clients'))
                    _SidebarItem(
                      icon: Icons.handshake_outlined,
                      label: 'Clients',
                      isActive: selected == DashboardSection.clients,
                      onTap: () => onSectionSelected(DashboardSection.clients),
                    ),
                  if (_moduleOn('attendance'))
                    _SidebarItem(
                      icon: Icons.access_time_outlined,
                      label: 'Attendance',
                      isActive: selected == DashboardSection.attendance,
                      onTap: () =>
                          onSectionSelected(DashboardSection.attendance),
                    ),
                  if (_moduleOn('reports'))
                    _SidebarItem(
                      icon: Icons.calendar_today_outlined,
                      label: 'Reports',
                      isActive: selected == DashboardSection.reports,
                      onTap: () => onSectionSelected(DashboardSection.reports),
                    ),
                  if (_moduleOn('scheduling'))
                    _SidebarItem(
                      icon: Icons.event_note_outlined,
                      label: 'Scheduling',
                      isActive: selected == DashboardSection.scheduling,
                      onTap: () =>
                          onSectionSelected(DashboardSection.scheduling),
                    ),
                  if (_moduleOn('my_pa'))
                    _SidebarItem(
                      icon: Icons.assistant_navigation,
                      label: 'My PA',
                      isActive: selected == DashboardSection.myPa,
                      onTap: () => onSectionSelected(DashboardSection.myPa),
                    ),
                  if (_moduleOn('leave'))
                    _SidebarItem(
                      icon: Icons.event_note_outlined,
                      label: 'Leave',
                      isActive: selected == DashboardSection.leave,
                      onTap: () => onSectionSelected(DashboardSection.leave),
                    ),
                  if (_moduleOn('messaging'))
                    _SidebarItem(
                      icon: Icons.forum_outlined,
                      label: 'Messages',
                      isActive: selected == DashboardSection.messages,
                      onTap: () => onSectionSelected(DashboardSection.messages),
                    ),
                  if (_moduleOn('paperless'))
                    _SidebarItem(
                      icon: Icons.receipt_long_outlined,
                      label: 'Incidents',
                      isActive: selected == DashboardSection.incidents,
                      onTap: () =>
                          onSectionSelected(DashboardSection.incidents),
                    ),
                  if (_moduleOn('employees'))
                    _SidebarItem(
                      icon: Icons.people_outline,
                      label: 'Employees',
                      isActive: selected == DashboardSection.employees,
                      onTap: () =>
                          onSectionSelected(DashboardSection.employees),
                    ),
                  if (_moduleOn('contractors'))
                    _SidebarItem(
                      icon: Icons.engineering_outlined,
                      label: 'Contractors',
                      isActive: selected == DashboardSection.contractors,
                      onTap: () =>
                          onSectionSelected(DashboardSection.contractors),
                    ),
                  if (_moduleOn('property_management')) ...[
                    const SizedBox(height: 8),
                    _SidebarSectionTitle(label: 'Property Management'),
                    _SidebarItem(
                      icon: Icons.domain_outlined,
                      label: 'Property management',
                      isActive: selected == DashboardSection.propertyManagement,
                      onTap: () =>
                          onSectionSelected(DashboardSection.propertyManagement),
                    ),
                  ],
                  if (_moduleOn('settings'))
                    _SidebarItem(
                      icon: Icons.settings_outlined,
                      label: 'Settings',
                      isActive: selected == DashboardSection.settings,
                      onTap: () => onSectionSelected(DashboardSection.settings),
                    ),
                  const SizedBox(height: 10),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF1E3A8A),
                  side: const BorderSide(color: Color(0xFF93C5FD)),
                  backgroundColor: const Color(0xFFEAF1FF),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(30),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                ),
                onPressed: onBackTap ?? () => Navigator.of(context).pop(),
                icon: const Icon(Icons.logout, size: 18),
                label: Text('Back', style: GoogleFonts.poppins(fontSize: 12)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SidebarItem extends StatefulWidget {
  final IconData icon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _SidebarItem({
    required this.icon,
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  State<_SidebarItem> createState() => _SidebarItemState();
}

class _SidebarItemState extends State<_SidebarItem> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final active = widget.isActive;
    final hovered = _hover && !active;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      child: MouseRegion(
        onEnter: (_) => setState(() => _hover = true),
        onExit: (_) => setState(() => _hover = false),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOut,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            color: active
                ? const Color(0xFFF3F4FF)
                : hovered
                ? const Color(0xFFF8FAFC)
                : Colors.transparent,
          ),
          child: ListTile(
            dense: true,
            leading: Icon(
              widget.icon,
              size: 20,
              color: active ? AppTheme.gold : const Color(0xFF9CA3AF),
            ),
            title: Text(
              widget.label,
              style: GoogleFonts.poppins(
                color: active
                    ? const Color(0xFF111827)
                    : const Color(0xFF6B7280),
                fontSize: 13,
                fontWeight: active ? FontWeight.w600 : FontWeight.w500,
              ),
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
            tileColor: Colors.transparent,
            onTap: widget.onTap,
          ),
        ),
      ),
    );
  }
}

class _SidebarSectionTitle extends StatelessWidget {
  final String label;

  const _SidebarSectionTitle({required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 6),
      child: Text(
        label.toUpperCase(),
        style: GoogleFonts.poppins(
          color: AppTheme.textGray.withValues(alpha: 0.7),
          fontSize: 10,
          letterSpacing: 0.8,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class PremiumSectionHeader extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final List<Widget> actions;

  const PremiumSectionHeader({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.actions = const [],
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFFFFFF), Color(0xFFF4F7FF)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE5E7EB)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.015 * 255),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: AppTheme.gold.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 18, color: AppTheme.gold),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.poppins(
                    color: const Color(0xFF111827),
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: GoogleFonts.poppins(
                    color: const Color(0xFF6B7280),
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          if (actions.isNotEmpty) ...actions,
        ],
      ),
    );
  }
}

class PremiumEmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;

  const PremiumEmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: const Color(0xFFEFF4FF),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 20, color: AppTheme.gold),
          ),
          const SizedBox(height: 8),
          Text(
            title,
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
              color: const Color(0xFF111827),
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            subtitle,
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
              color: const Color(0xFF6B7280),
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}

class PremiumLoadingIndicator extends StatelessWidget {
  final String label;

  const PremiumLoadingIndicator({super.key, this.label = 'Loading...'});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(
              strokeWidth: 2.2,
              color: AppTheme.gold,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            label,
            style: GoogleFonts.poppins(
              color: const Color(0xFF6B7280),
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}
