import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../models/resident.dart';
import '../models/site.dart';
import '../models/unit.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';

/// Property management — Properties (Sites) and the units within them.
///
/// Top level: list of sites (complexes/estates) with unit counts.
/// Drilling into a site: list of its units with create / edit / delete.
///
/// Sites themselves are still created via the Clients flow (a site is
/// created the first time a job is scheduled at a new address). This
/// screen lists what's already in the system.
class HrPropertiesSection extends StatefulWidget {
  const HrPropertiesSection({super.key});

  @override
  State<HrPropertiesSection> createState() => _HrPropertiesSectionState();
}

class _HrPropertiesSectionState extends State<HrPropertiesSection> {
  bool _loading = true;
  String? _error;
  List<Site> _sites = const [];
  Map<String, int> _unitCounts = const {};

  /// Null = top-level site list. Otherwise we're drilled into this site.
  Site? _selectedSite;
  List<Unit> _selectedSiteUnits = const [];
  Map<String, List<Resident>> _residentsByUnitId = const {};
  bool _loadingUnits = false;

  List<Resident> _occupantsForTile(String unitId) {
    final list = _residentsByUnitId[unitId];
    if (list == null || list.isEmpty) return const [];
    final sorted = List<Resident>.from(list)
      ..sort((a, b) {
        if (a.isPrimary != b.isPrimary) {
          return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0);
        }
        return a.fullName.toLowerCase().compareTo(b.fullName.toLowerCase());
      });
    return sorted.length <= 2 ? sorted : sorted.sublist(0, 2);
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadSites());
  }

  Future<void> _loadSites() async {
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
      final sites = await SupabaseTimesheetStorage.getCompanySites(companyId: companyId);
      final counts = await SupabaseTimesheetStorage.getUnitCountsBySite(companyId: companyId);
      if (!mounted) return;
      setState(() {
        _sites = sites;
        _unitCounts = counts;
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

  Future<void> _loadUnits(Site site) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    setState(() {
      _selectedSite = site;
      _loadingUnits = true;
      _selectedSiteUnits = const [];
    });
    try {
      final units = await SupabaseTimesheetStorage.getUnitsForSite(
        companyId: companyId,
        siteId: site.id,
      );
      final unitIds = units.map((u) => u.id).toList();
      final residents = unitIds.isEmpty
          ? const <Resident>[]
          : await SupabaseTimesheetStorage.getResidentsForUnits(
              companyId: companyId,
              unitIds: unitIds,
            );
      final byUnit = <String, List<Resident>>{};
      for (final r in residents) {
        byUnit.putIfAbsent(r.unitId, () => []).add(r);
      }
      if (!mounted) return;
      setState(() {
        _selectedSiteUnits = units;
        _residentsByUnitId = byUnit;
        _loadingUnits = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingUnits = false);
    }
  }

  void _backToSites() {
    setState(() {
      _selectedSite = null;
      _selectedSiteUnits = const [];
      _residentsByUnitId = const {};
    });
    _loadSites();
  }

  List<Resident> _sortedResidentsForEdit(Unit unit) {
    final raw = List<Resident>.from(_residentsByUnitId[unit.id] ?? const []);
    raw.sort((a, b) {
      if (a.isPrimary != b.isPrimary) {
        return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0);
      }
      return a.fullName.toLowerCase().compareTo(b.fullName.toLowerCase());
    });
    return raw;
  }

  /// Writes up to two occupants for [unitId]; trims extra DB rows beyond two.
  Future<void> _syncResidentsForUnit({
    required String companyId,
    required String unitId,
    required String occ1Name,
    required String occ1Phone,
    required String occ1Email,
    required String occ2Name,
    required String occ2Phone,
    required String occ2Email,
  }) async {
    String? nz(String s) {
      final t = s.trim();
      return t.isEmpty ? null : t;
    }

    List<Resident> desired() {
      final n1 = occ1Name.trim();
      final n2 = occ2Name.trim();
      if (n1.isEmpty && n2.isEmpty) return [];
      if (n1.isEmpty && n2.isNotEmpty) {
        return [
          Resident(
            id: '',
            unitId: unitId,
            fullName: n2,
            phone: nz(occ2Phone),
            email: nz(occ2Email),
            isPrimary: true,
          ),
        ];
      }
      if (n1.isNotEmpty && n2.isEmpty) {
        return [
          Resident(
            id: '',
            unitId: unitId,
            fullName: n1,
            phone: nz(occ1Phone),
            email: nz(occ1Email),
            isPrimary: true,
          ),
        ];
      }
      return [
        Resident(
          id: '',
          unitId: unitId,
          fullName: n1,
          phone: nz(occ1Phone),
          email: nz(occ1Email),
          isPrimary: true,
        ),
        Resident(
          id: '',
          unitId: unitId,
          fullName: n2,
          phone: nz(occ2Phone),
          email: nz(occ2Email),
          isPrimary: false,
        ),
      ];
    }

    final target = desired();
    var existing = await SupabaseTimesheetStorage.getResidentsForUnit(
      companyId: companyId,
      unitId: unitId,
    );
    existing.sort((a, b) {
      if (a.isPrimary != b.isPrimary) {
        return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0);
      }
      return a.id.compareTo(b.id);
    });

    while (existing.length > target.length) {
      await SupabaseTimesheetStorage.deleteResident(
        residentId: existing.last.id,
      );
      existing.removeLast();
    }

    for (var i = 0; i < target.length; i++) {
      final d = target[i];
      if (i < existing.length) {
        await SupabaseTimesheetStorage.updateResident(
          resident: existing[i].copyWith(
            fullName: d.fullName,
            phone: d.phone,
            email: d.email,
            isPrimary: d.isPrimary,
          ),
        );
      } else {
        await SupabaseTimesheetStorage.insertResidentReturning(
          companyId: companyId,
          resident: d,
        );
      }
    }
  }

  Future<void> _showUnitDialog({Unit? existing}) async {
    final site = _selectedSite;
    if (site == null) return;
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;

    Resident? seed1;
    Resident? seed2;
    if (existing != null) {
      final sorted = _sortedResidentsForEdit(existing);
      if (sorted.isNotEmpty) seed1 = sorted[0];
      if (sorted.length > 1) seed2 = sorted[1];
    }

    final result = await showDialog<_UnitEditorResult>(
      context: context,
      builder: (_) => _UnitDialog(
        siteId: site.id,
        existing: existing,
        occupant1Seed: seed1,
        occupant2Seed: seed2,
      ),
    );
    if (result == null) return;
    try {
      String unitId = result.unit.id;
      if (existing == null) {
        final created = await SupabaseTimesheetStorage.insertUnitReturning(
          companyId: companyId,
          unit: result.unit,
        );
        unitId = created.id;
      } else {
        await SupabaseTimesheetStorage.updateUnit(unit: result.unit);
      }
      await _syncResidentsForUnit(
        companyId: companyId,
        unitId: unitId,
        occ1Name: result.occ1Name,
        occ1Phone: result.occ1Phone,
        occ1Email: result.occ1Email,
        occ2Name: result.occ2Name,
        occ2Phone: result.occ2Phone,
        occ2Email: result.occ2Email,
      );
      await _loadUnits(site);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to save unit: $e')),
      );
    }
  }

  Future<void> _showAddPropertyDialog() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;

    final nameCtrl = TextEditingController();
    final addressCtrl = TextEditingController();
    final contactCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    final emailCtrl = TextEditingController();
    final notesCtrl = TextEditingController();

    Future<void> cleanup() async {
      nameCtrl.dispose();
      addressCtrl.dispose();
      contactCtrl.dispose();
      phoneCtrl.dispose();
      emailCtrl.dispose();
      notesCtrl.dispose();
    }

    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Add property'),
          content: SizedBox(
            width: 460,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Adds a Property-type client under Clients and creates this site so you can add units and occupants.',
                    style: GoogleFonts.poppins(
                      fontSize: 12,
                      color: const Color(0xFF64748B),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: nameCtrl,
                    autofocus: true,
                    decoration: const InputDecoration(
                      labelText: 'Property / estate name *',
                      hintText: 'e.g. Sunrise Heights',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: addressCtrl,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      labelText: 'Address',
                      hintText: 'Street, suburb — shown on client & site',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: contactCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Contact person',
                      hintText: 'Body corporate / manager (optional)',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: phoneCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Phone'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: emailCtrl,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Email'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: notesCtrl,
                    maxLines: 2,
                    decoration: const InputDecoration(labelText: 'Notes'),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (nameCtrl.text.trim().isEmpty) {
                  ScaffoldMessenger.of(ctx).showSnackBar(
                    const SnackBar(content: Text('Enter a property name.')),
                  );
                  return;
                }
                Navigator.of(ctx).pop(true);
              },
              child: const Text('Create'),
            ),
          ],
        ),
      );

      if (confirmed != true || !mounted) {
        await cleanup();
        return;
      }

      await SupabaseTimesheetStorage.createPropertyClientAndSiteReturning(
        companyId: companyId,
        propertyName: nameCtrl.text,
        address: addressCtrl.text,
        contactPerson: contactCtrl.text,
        phone: phoneCtrl.text,
        email: emailCtrl.text,
        notes: notesCtrl.text,
      );
      await cleanup();

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Property added — it appears under Clients and here.')),
      );
      await _loadSites();
    } catch (e) {
      await cleanup();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not add property: $e')),
      );
    }
  }

  Future<void> _confirmDelete(Unit unit) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Delete unit?'),
        content: Text('Remove unit ${unit.unitNumber}? Linked residents and jobs will lose their unit reference.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await SupabaseTimesheetStorage.deleteUnit(unitId: unit.id);
      if (_selectedSite != null) await _loadUnits(_selectedSite!);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Delete failed: $e')),
      );
    }
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
    if (_selectedSite == null) {
      return _buildSitesList();
    }
    return _buildSiteDetail();
  }

  Widget _buildSitesList() {
    final header = Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              'Estates and complexes linked to your company. Add one here — it is created as a Property client too.',
              style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF64748B)),
            ),
          ),
          const SizedBox(width: 12),
          FilledButton.icon(
            onPressed: _showAddPropertyDialog,
            icon: const Icon(Icons.add_home_work_outlined, size: 18),
            label: const Text('Add property'),
          ),
        ],
      ),
    );

    if (_sites.isEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          header,
          Expanded(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.apartment_outlined, size: 56, color: Color(0xFF9CA3AF)),
                    const SizedBox(height: 16),
                    Text(
                      'No properties yet.',
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF111827),
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Use Add property to create a Property-type client and site. You can still add sites from the Clients screen or when scheduling jobs.',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        header,
        Expanded(
          child: RefreshIndicator(
            onRefresh: _loadSites,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              itemCount: _sites.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                final site = _sites[i];
                final count = _unitCounts[site.id] ?? 0;
                return Card(
                  color: Colors.white,
                  elevation: 2,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                    side: const BorderSide(color: Color(0xFFE5E7EB)),
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    leading: const CircleAvatar(
                      backgroundColor: Color(0xFFE5EDFF),
                      child: Icon(Icons.apartment_outlined, color: Color(0xFF111827)),
                    ),
                    title: Text(
                      site.name,
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF111827),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    subtitle: site.address != null && site.address!.isNotEmpty
                        ? Text(
                            site.address!,
                            style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                          )
                        : null,
                    trailing: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE5EDFF),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        count == 1 ? '1 unit' : '$count units',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF111827),
                          fontWeight: FontWeight.w600,
                          fontSize: 11,
                        ),
                      ),
                    ),
                    onTap: () => _loadUnits(site),
                  ),
                );
              },
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSiteDetail() {
    final site = _selectedSite!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back, color: AppTheme.gold),
                onPressed: _backToSites,
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      site.name,
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF111827),
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (site.address != null && site.address!.isNotEmpty)
                      Text(
                        site.address!,
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF6B7280),
                          fontSize: 12,
                        ),
                      ),
                  ],
                ),
              ),
              FilledButton.icon(
                onPressed: () => _showUnitDialog(),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add unit'),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(56, 0, 16, 8),
          child: Text(
            'Residents are saved on each unit (edit unit → occupants).',
            style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFF64748B)),
          ),
        ),
        const Divider(height: 1, color: Color(0xFFE5E7EB)),
        Expanded(
          child: _loadingUnits
              ? const Center(child: CircularProgressIndicator(color: AppTheme.gold))
              : _selectedSiteUnits.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Text(
                          'No units yet. Tap "Add unit" to create the first one.',
                          textAlign: TextAlign.center,
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280),
                            fontSize: 13,
                          ),
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.all(16),
                      itemCount: _selectedSiteUnits.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (context, i) {
                        final unit = _selectedSiteUnits[i];
                        return _UnitTile(
                          unit: unit,
                          occupants: _occupantsForTile(unit.id),
                          onEdit: () => _showUnitDialog(existing: unit),
                          onDelete: () => _confirmDelete(unit),
                        );
                      },
                    ),
        ),
      ],
    );
  }
}

class _UnitEditorResult {
  final Unit unit;
  final String occ1Name;
  final String occ1Phone;
  final String occ1Email;
  final String occ2Name;
  final String occ2Phone;
  final String occ2Email;

  const _UnitEditorResult({
    required this.unit,
    required this.occ1Name,
    required this.occ1Phone,
    required this.occ1Email,
    required this.occ2Name,
    required this.occ2Phone,
    required this.occ2Email,
  });
}

class _UnitTile extends StatelessWidget {
  final Unit unit;
  final List<Resident> occupants;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _UnitTile({
    required this.unit,
    required this.occupants,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final statusColor = switch (unit.occupancyStatus) {
      'occupied' => const Color(0xFF059669),
      'vacant' => const Color(0xFF6B7280),
      'reserved' => const Color(0xFF2563EB),
      'off_market' => const Color(0xFFB91C1C),
      _ => const Color(0xFF6B7280),
    };
    final meta = [
      if (unit.label != null && unit.label!.isNotEmpty) unit.label!,
      if (unit.floor != null && unit.floor!.isNotEmpty) 'Floor ${unit.floor}',
    ].join(' · ');

    Widget occupantBlock(Resident r, int index) {
      final label = index == 0 ? 'Occupant 1' : 'Occupant 2';
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: GoogleFonts.poppins(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF64748B),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              r.fullName,
              style: GoogleFonts.poppins(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF111827),
              ),
            ),
            if (r.phone != null && r.phone!.trim().isNotEmpty)
              Text(
                r.phone!,
                style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF475569)),
              ),
            if (r.email != null && r.email!.trim().isNotEmpty)
              Text(
                r.email!,
                style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF475569)),
              ),
          ],
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 4, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Row(
                    children: [
                      Flexible(
                        child: Text(
                          'Unit ${unit.unitNumber}',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF111827),
                            fontWeight: FontWeight.w600,
                            fontSize: 15,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.10 * 255),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          unit.occupancyStatus.replaceAll('_', ' '),
                          style: GoogleFonts.poppins(
                            color: statusColor,
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'Edit',
                  icon: const Icon(Icons.edit_outlined, size: 18, color: Color(0xFF6B7280)),
                  onPressed: onEdit,
                ),
                IconButton(
                  tooltip: 'Delete',
                  icon: const Icon(Icons.delete_outline, size: 18, color: Color(0xFFB91C1C)),
                  onPressed: onDelete,
                ),
              ],
            ),
            if (meta.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 4, right: 8),
                child: Text(
                  meta,
                  style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                ),
              ),
            if (occupants.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'No occupants registered — edit this unit to add up to two.',
                  style: GoogleFonts.poppins(color: const Color(0xFF9CA3AF), fontSize: 12),
                ),
              )
            else
              ...occupants.asMap().entries.map((e) => occupantBlock(e.value, e.key)),
          ],
        ),
      ),
    );
  }
}

class _UnitDialog extends StatefulWidget {
  final String siteId;
  final Unit? existing;
  final Resident? occupant1Seed;
  final Resident? occupant2Seed;

  const _UnitDialog({
    required this.siteId,
    this.existing,
    this.occupant1Seed,
    this.occupant2Seed,
  });

  @override
  State<_UnitDialog> createState() => _UnitDialogState();
}

class _UnitDialogState extends State<_UnitDialog> {
  late final TextEditingController _numberCtrl;
  late final TextEditingController _labelCtrl;
  late final TextEditingController _floorCtrl;
  late final TextEditingController _notesCtrl;
  late final TextEditingController _o1NameCtrl;
  late final TextEditingController _o1PhoneCtrl;
  late final TextEditingController _o1EmailCtrl;
  late final TextEditingController _o2NameCtrl;
  late final TextEditingController _o2PhoneCtrl;
  late final TextEditingController _o2EmailCtrl;
  late String _status;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    final o1 = widget.occupant1Seed;
    final o2 = widget.occupant2Seed;
    _numberCtrl = TextEditingController(text: e?.unitNumber ?? '');
    _labelCtrl = TextEditingController(text: e?.label ?? '');
    _floorCtrl = TextEditingController(text: e?.floor ?? '');
    _notesCtrl = TextEditingController(text: e?.notes ?? '');
    _o1NameCtrl = TextEditingController(text: o1?.fullName ?? '');
    _o1PhoneCtrl = TextEditingController(text: o1?.phone ?? '');
    _o1EmailCtrl = TextEditingController(text: o1?.email ?? '');
    _o2NameCtrl = TextEditingController(text: o2?.fullName ?? '');
    _o2PhoneCtrl = TextEditingController(text: o2?.phone ?? '');
    _o2EmailCtrl = TextEditingController(text: o2?.email ?? '');
    _status = e?.occupancyStatus ?? 'occupied';
  }

  @override
  void dispose() {
    _numberCtrl.dispose();
    _labelCtrl.dispose();
    _floorCtrl.dispose();
    _notesCtrl.dispose();
    _o1NameCtrl.dispose();
    _o1PhoneCtrl.dispose();
    _o1EmailCtrl.dispose();
    _o2NameCtrl.dispose();
    _o2PhoneCtrl.dispose();
    _o2EmailCtrl.dispose();
    super.dispose();
  }

  Widget _occupantFields({
    required String title,
    required TextEditingController name,
    required TextEditingController phone,
    required TextEditingController email,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: GoogleFonts.poppins(
            fontWeight: FontWeight.w600,
            fontSize: 13,
            color: const Color(0xFF374151),
          ),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: name,
          decoration: const InputDecoration(
            labelText: 'Full name',
            hintText: 'Required if registering this occupant',
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: phone,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(labelText: 'Phone'),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: email,
          keyboardType: TextInputType.emailAddress,
          decoration: const InputDecoration(labelText: 'Email'),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.existing != null;
    return AlertDialog(
      title: Text(isEdit ? 'Edit unit' : 'New unit'),
      content: SizedBox(
        width: 480,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Unit details',
                style: GoogleFonts.poppins(
                  fontWeight: FontWeight.w600,
                  fontSize: 12,
                  color: const Color(0xFF64748B),
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _numberCtrl,
                decoration: const InputDecoration(labelText: 'Unit number *', hintText: 'e.g. 12A'),
                autofocus: true,
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _labelCtrl,
                decoration: const InputDecoration(labelText: 'Label / nickname'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _floorCtrl,
                decoration: const InputDecoration(labelText: 'Floor'),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _status,
                items: const [
                  DropdownMenuItem(value: 'occupied', child: Text('Occupied')),
                  DropdownMenuItem(value: 'vacant', child: Text('Vacant')),
                  DropdownMenuItem(value: 'reserved', child: Text('Reserved')),
                  DropdownMenuItem(value: 'off_market', child: Text('Off market')),
                ],
                onChanged: (v) {
                  if (v == null) return;
                  setState(() => _status = v);
                },
                decoration: const InputDecoration(labelText: 'Occupancy status'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _notesCtrl,
                maxLines: 2,
                decoration: const InputDecoration(labelText: 'Notes'),
              ),
              const SizedBox(height: 20),
              Text(
                'Occupants (optional — up to two per unit)',
                style: GoogleFonts.poppins(
                  fontWeight: FontWeight.w600,
                  fontSize: 12,
                  color: const Color(0xFF64748B),
                ),
              ),
              const SizedBox(height: 10),
              _occupantFields(
                title: 'Occupant 1',
                name: _o1NameCtrl,
                phone: _o1PhoneCtrl,
                email: _o1EmailCtrl,
              ),
              const SizedBox(height: 16),
              _occupantFields(
                title: 'Occupant 2',
                name: _o2NameCtrl,
                phone: _o2PhoneCtrl,
                email: _o2EmailCtrl,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            final num = _numberCtrl.text.trim();
            if (num.isEmpty) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Unit number is required.')),
              );
              return;
            }
            final unit = Unit(
              id: widget.existing?.id ?? '',
              siteId: widget.siteId,
              unitNumber: num,
              label: _labelCtrl.text.trim().isEmpty ? null : _labelCtrl.text.trim(),
              occupancyStatus: _status,
              floor: _floorCtrl.text.trim().isEmpty ? null : _floorCtrl.text.trim(),
              notes: _notesCtrl.text.trim().isEmpty ? null : _notesCtrl.text.trim(),
            );
            Navigator.of(context).pop(
              _UnitEditorResult(
                unit: unit,
                occ1Name: _o1NameCtrl.text,
                occ1Phone: _o1PhoneCtrl.text,
                occ1Email: _o1EmailCtrl.text,
                occ2Name: _o2NameCtrl.text,
                occ2Phone: _o2PhoneCtrl.text,
                occ2Email: _o2EmailCtrl.text,
              ),
            );
          },
          child: Text(isEdit ? 'Save' : 'Create'),
        ),
      ],
    );
  }
}
