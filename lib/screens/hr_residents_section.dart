import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../models/resident.dart';
import '../models/site.dart';
import '../models/unit.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';

/// Read-only directory of residents across all units. Add or edit occupants on
/// **Properties → site → unit → Edit unit**.
class HrResidentsSection extends StatefulWidget {
  const HrResidentsSection({super.key});

  @override
  State<HrResidentsSection> createState() => _HrResidentsSectionState();
}

class _HrResidentsSectionState extends State<HrResidentsSection> {
  bool _loading = true;
  String? _error;
  List<Resident> _residents = const [];
  List<Unit> _units = const [];
  List<Site> _sites = const [];
  String _filter = '';

  Map<String, Unit> get _unitsById => {for (final u in _units) u.id: u};
  Map<String, Site> get _sitesById => {for (final s in _sites) s.id: s};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) {
      setState(() {
        _loading = false;
        _error = 'No company selected.';
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final residents =
          await SupabaseTimesheetStorage.getResidentsForCompany(companyId: companyId);
      final units = await SupabaseTimesheetStorage.getUnitsForCompany(companyId: companyId);
      final sites = await SupabaseTimesheetStorage.getCompanySites(companyId: companyId);
      if (!mounted) return;
      setState(() {
        _residents = residents;
        _units = units;
        _sites = sites;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  String _unitDescriptor(String unitId) {
    final u = _unitsById[unitId];
    if (u == null) return 'Unknown unit';
    final site = _sitesById[u.siteId];
    final siteName = site?.name ?? 'Site #${u.siteId}';
    return '$siteName · Unit ${u.unitNumber}';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
    }
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Text(
            _error!,
            style: GoogleFonts.poppins(color: const Color(0xFFB91C1C)),
          ),
        ),
      );
    }
    final filtered = _residents.where((r) {
      if (_filter.isEmpty) return true;
      final q = _filter.toLowerCase();
      return r.fullName.toLowerCase().contains(q) ||
          (r.email?.toLowerCase().contains(q) ?? false) ||
          (r.phone?.toLowerCase().contains(q) ?? false) ||
          _unitDescriptor(r.unitId).toLowerCase().contains(q);
    }).toList()
      ..sort((a, b) {
        final ua = _unitDescriptor(a.unitId);
        final ub = _unitDescriptor(b.unitId);
        final c = ua.compareTo(ub);
        if (c != 0) return c;
        return a.fullName.toLowerCase().compareTo(b.fullName.toLowerCase());
      });

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Directory (read-only)',
                style: GoogleFonts.poppins(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: const Color(0xFF374151),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'To add or change occupants, open Properties, choose the site and unit, then Edit unit.',
                style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF64748B)),
              ),
              const SizedBox(height: 12),
              TextField(
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Search by name, phone, email, or unit…',
                  isDense: true,
                ),
                onChanged: (v) => setState(() => _filter = v),
              ),
            ],
          ),
        ),
        Expanded(
          child: filtered.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.group_outlined, size: 56, color: Color(0xFF9CA3AF)),
                        const SizedBox(height: 12),
                        Text(
                          _residents.isEmpty
                              ? 'No occupants recorded yet. Register them when you edit a unit under Properties.'
                              : 'No rows match your search.',
                          textAlign: TextAlign.center,
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: filtered.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, i) {
                      final r = filtered[i];
                      return _ResidentDirectoryTile(
                        resident: r,
                        unitDescriptor: _unitDescriptor(r.unitId),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }
}

class _ResidentDirectoryTile extends StatelessWidget {
  final Resident resident;
  final String unitDescriptor;

  const _ResidentDirectoryTile({
    required this.resident,
    required this.unitDescriptor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        leading: CircleAvatar(
          backgroundColor: const Color(0xFFE5EDFF),
          child: Text(
            (resident.fullName.isNotEmpty ? resident.fullName[0] : '?').toUpperCase(),
            style: GoogleFonts.poppins(
              color: const Color(0xFF111827),
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        title: Row(
          children: [
            Expanded(
              child: Text(
                resident.fullName,
                style: GoogleFonts.poppins(
                  color: const Color(0xFF111827),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            if (resident.isPrimary)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppTheme.gold.withValues(alpha: 0.12 * 255),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  'Primary',
                  style: GoogleFonts.poppins(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFFB45309),
                  ),
                ),
              ),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                unitDescriptor,
                style: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 12),
              ),
              if ((resident.phone?.isNotEmpty ?? false) ||
                  (resident.email?.isNotEmpty ?? false))
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    [resident.phone, resident.email]
                        .whereType<String>()
                        .where((s) => s.isNotEmpty)
                        .join(' · '),
                    style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
