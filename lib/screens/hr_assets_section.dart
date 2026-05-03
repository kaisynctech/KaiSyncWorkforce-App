import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../models/asset.dart';
import '../models/site.dart';
import '../models/unit.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';

/// Asset register — physical things that need maintenance and compliance.
/// Top of screen: a compliance summary (counts by inspection / certificate
/// status). Below: a list of assets with status badges.
class HrAssetsSection extends StatefulWidget {
  const HrAssetsSection({super.key});

  @override
  State<HrAssetsSection> createState() => _HrAssetsSectionState();
}

class _HrAssetsSectionState extends State<HrAssetsSection> {
  bool _loading = true;
  String? _error;
  List<Asset> _assets = const [];
  List<Site> _sites = const [];
  List<Unit> _units = const [];
  List<ComplianceEntry> _calendar = const [];
  String _filter = '';

  Map<String, Site> get _sitesById => {for (final s in _sites) s.id: s};
  Map<String, Unit> get _unitsById => {for (final u in _units) u.id: u};
  Map<String, ComplianceEntry> get _calendarByAsset =>
      {for (final c in _calendar) c.assetId: c};

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
      final assets = await SupabaseTimesheetStorage.getAssetsForCompany(companyId: companyId);
      final sites = await SupabaseTimesheetStorage.getCompanySites(companyId: companyId);
      final units = await SupabaseTimesheetStorage.getUnitsForCompany(companyId: companyId);
      final calendar = await SupabaseTimesheetStorage.getComplianceCalendar(companyId: companyId);
      if (!mounted) return;
      setState(() {
        _assets = assets;
        _sites = sites;
        _units = units;
        _calendar = calendar;
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

  Future<void> _showAssetDialog({Asset? existing}) async {
    if (_sites.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Create at least one property first.')),
      );
      return;
    }
    final result = await showDialog<Asset>(
      context: context,
      builder: (_) => _AssetDialog(
        sites: _sites,
        units: _units,
        existing: existing,
      ),
    );
    if (result == null) return;
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      if (existing == null) {
        await SupabaseTimesheetStorage.insertAssetReturning(
          companyId: companyId,
          asset: result,
        );
      } else {
        await SupabaseTimesheetStorage.updateAsset(asset: result);
      }
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to save asset: $e')),
      );
    }
  }

  Future<void> _confirmDelete(Asset a) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Delete asset?'),
        content: Text('Remove ${a.label}? Inspections and certificates linked to this asset will also be removed.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await SupabaseTimesheetStorage.deleteAsset(assetId: a.id);
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Delete failed: $e')),
      );
    }
  }

  Future<void> _generatePreventiveJobs() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    int daysAhead = 30;
    bool autoAssign = true;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Generate preventive jobs'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<int>(
                  initialValue: daysAhead,
                  decoration: const InputDecoration(labelText: 'Due horizon'),
                  items: const [
                    DropdownMenuItem(value: 7, child: Text('Next 7 days')),
                    DropdownMenuItem(value: 30, child: Text('Next 30 days')),
                    DropdownMenuItem(value: 90, child: Text('Next 90 days')),
                    DropdownMenuItem(value: 180, child: Text('Next 180 days')),
                    DropdownMenuItem(value: 365, child: Text('Next 12 months')),
                  ],
                  onChanged: (v) {
                    if (v != null) setLocal(() => daysAhead = v);
                  },
                ),
                const SizedBox(height: 8),
                SwitchListTile.adaptive(
                  value: autoAssign,
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Auto-assign best available worker'),
                  subtitle: const Text('Uses dispatch score during generation.'),
                  onChanged: (v) => setLocal(() => autoAssign = v),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Generate')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final result = await SupabaseTimesheetStorage.generatePreventiveJobsFromDueInspections(
      companyId: companyId,
      daysAhead: daysAhead,
      autoAssignBestWorker: autoAssign,
    );
    if (!mounted) return;
    final created = result['created'] ?? 0;
    final skippedExisting = result['skipped_existing'] ?? 0;
    final skippedMissing = result['skipped_missing_site_client'] ?? 0;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Preventive jobs generated: $created • existing skipped: $skippedExisting • missing client/site: $skippedMissing',
        ),
      ),
    );
  }

  ({int overdue, int dueSoon, int expired, int expiringSoon}) _summary() {
    int overdue = 0, dueSoon = 0, expired = 0, expiringSoon = 0;
    for (final c in _calendar) {
      if (c.inspectionStatus == 'overdue') overdue++;
      if (c.inspectionStatus == 'due_soon') dueSoon++;
      if (c.certificateStatus == 'expired') expired++;
      if (c.certificateStatus == 'expiring_soon') expiringSoon++;
    }
    return (overdue: overdue, dueSoon: dueSoon, expired: expired, expiringSoon: expiringSoon);
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
          child: Text(_error!, style: GoogleFonts.poppins(color: const Color(0xFFB91C1C))),
        ),
      );
    }
    final summary = _summary();
    final filtered = _assets.where((a) {
      if (_filter.isEmpty) return true;
      final q = _filter.toLowerCase();
      final site = _sitesById[a.siteId]?.name ?? '';
      return a.label.toLowerCase().contains(q) ||
          a.assetType.toLowerCase().contains(q) ||
          site.toLowerCase().contains(q) ||
          (a.serialNumber?.toLowerCase().contains(q) ?? false);
    }).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _SummaryChip(
                label: 'Overdue inspections',
                value: '${summary.overdue}',
                color: const Color(0xFFDC2626),
              ),
              _SummaryChip(
                label: 'Due in 30 days',
                value: '${summary.dueSoon}',
                color: const Color(0xFFF59E0B),
              ),
              _SummaryChip(
                label: 'Expired certs',
                value: '${summary.expired}',
                color: const Color(0xFFDC2626),
              ),
              _SummaryChip(
                label: 'Cert expiring 60d',
                value: '${summary.expiringSoon}',
                color: const Color(0xFFF59E0B),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search),
                    hintText: 'Search assets…',
                    isDense: true,
                  ),
                  onChanged: (v) => setState(() => _filter = v),
                ),
              ),
              const SizedBox(width: 10),
              FilledButton.icon(
                onPressed: () => _showAssetDialog(),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add asset'),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: _generatePreventiveJobs,
                icon: const Icon(Icons.event_repeat_outlined, size: 16),
                label: const Text('Generate PM jobs'),
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
                        const Icon(Icons.precision_manufacturing_outlined, size: 56, color: Color(0xFF9CA3AF)),
                        const SizedBox(height: 12),
                        Text(
                          _assets.isEmpty
                              ? 'No assets registered yet. Add geysers, lifts, fire equipment, etc.'
                              : 'No assets match your search.',
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
                      final a = filtered[i];
                      final site = _sitesById[a.siteId];
                      final unit = a.unitId != null ? _unitsById[a.unitId!] : null;
                      final calendar = _calendarByAsset[a.id];
                      return _AssetTile(
                        asset: a,
                        siteName: site?.name ?? 'Site #${a.siteId}',
                        unitNumber: unit?.unitNumber,
                        calendar: calendar,
                        onEdit: () => _showAssetDialog(existing: a),
                        onDelete: () => _confirmDelete(a),
                      );
                    },
                  ),
                ),
        ),
      ],
    );
  }
}

class _SummaryChip extends StatelessWidget {
  final String label;
  final String value;
  final Color color;

  const _SummaryChip({required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10 * 255),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.25 * 255)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(value, style: GoogleFonts.poppins(color: color, fontWeight: FontWeight.w700, fontSize: 16)),
          const SizedBox(width: 8),
          Text(label, style: GoogleFonts.poppins(color: color, fontSize: 11, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class _AssetTile extends StatelessWidget {
  final Asset asset;
  final String siteName;
  final String? unitNumber;
  final ComplianceEntry? calendar;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _AssetTile({
    required this.asset,
    required this.siteName,
    required this.calendar,
    required this.onEdit,
    required this.onDelete,
    this.unitNumber,
  });

  static final _dateFmt = DateFormat('MMM d, y');

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: const Color(0xFFE5EDFF),
          child: Icon(_iconFor(asset.assetType), color: const Color(0xFF111827), size: 18),
        ),
        title: Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              asset.label,
              style: GoogleFonts.poppins(
                color: const Color(0xFF111827),
                fontWeight: FontWeight.w600,
              ),
            ),
            if (calendar != null) _statusBadge(_inspectionLabel(calendar!.inspectionStatus, calendar!.daysUntilDue), _colorFor(calendar!.inspectionStatus)),
            if (calendar != null && calendar!.certificateStatus != 'no_certificate')
              _statusBadge(_certLabel(calendar!.certificateStatus, calendar!.certExpiresAt), _colorFor(calendar!.certificateStatus)),
          ],
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            [
              asset.assetType,
              siteName,
              if (unitNumber != null) 'Unit $unitNumber',
              if (asset.serialNumber != null && asset.serialNumber!.isNotEmpty) 'SN ${asset.serialNumber}',
            ].join(' · '),
            style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
          ),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
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
      ),
    );
  }

  Widget _statusBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10 * 255),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: GoogleFonts.poppins(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  static IconData _iconFor(String type) {
    final t = type.toLowerCase();
    if (t.contains('geyser') || t.contains('water')) return Icons.water_drop_outlined;
    if (t.contains('lift') || t.contains('elevator')) return Icons.elevator_outlined;
    if (t.contains('fire')) return Icons.local_fire_department_outlined;
    if (t.contains('electric')) return Icons.electrical_services_outlined;
    if (t.contains('hvac') || t.contains('air')) return Icons.air_outlined;
    return Icons.precision_manufacturing_outlined;
  }

  static Color _colorFor(String status) {
    switch (status) {
      case 'overdue':
      case 'expired':
        return const Color(0xFFDC2626);
      case 'due_soon':
      case 'expiring_soon':
        return const Color(0xFFF59E0B);
      case 'on_track':
      case 'valid':
        return const Color(0xFF059669);
      default:
        return const Color(0xFF6B7280);
    }
  }

  static String _inspectionLabel(String status, int? days) {
    switch (status) {
      case 'overdue':
        return days != null ? 'Inspection ${-days}d overdue' : 'Inspection overdue';
      case 'due_soon':
        return days != null ? 'Inspection in ${days}d' : 'Inspection due soon';
      case 'on_track':
        return 'Inspection on track';
      default:
        return 'No inspection schedule';
    }
  }

  String _certLabel(String status, DateTime? expires) {
    switch (status) {
      case 'expired':
        return expires != null ? 'Cert expired ${_dateFmt.format(expires)}' : 'Cert expired';
      case 'expiring_soon':
        return expires != null ? 'Cert expires ${_dateFmt.format(expires)}' : 'Cert expiring soon';
      case 'valid':
        return 'Cert valid';
      default:
        return 'No certificate';
    }
  }
}

class _AssetDialog extends StatefulWidget {
  final List<Site> sites;
  final List<Unit> units;
  final Asset? existing;

  const _AssetDialog({required this.sites, required this.units, this.existing});

  @override
  State<_AssetDialog> createState() => _AssetDialogState();
}

class _AssetDialogState extends State<_AssetDialog> {
  late final TextEditingController _labelCtrl;
  late final TextEditingController _manufacturerCtrl;
  late final TextEditingController _modelCtrl;
  late final TextEditingController _serialCtrl;
  late String? _siteId;
  late String? _unitId;
  late String _assetType;
  late String _status;

  static const _assetTypes = [
    'Geyser',
    'Lift / Elevator',
    'Fire equipment',
    'Electrical board',
    'HVAC',
    'Plumbing',
    'Solar / PV',
    'Generator',
    'Other',
  ];

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _labelCtrl = TextEditingController(text: e?.label ?? '');
    _manufacturerCtrl = TextEditingController(text: e?.manufacturer ?? '');
    _modelCtrl = TextEditingController(text: e?.modelNumber ?? '');
    _serialCtrl = TextEditingController(text: e?.serialNumber ?? '');
    _siteId = e?.siteId ?? (widget.sites.isNotEmpty ? widget.sites.first.id : null);
    _unitId = e?.unitId;
    _assetType = e?.assetType ?? _assetTypes.first;
    _status = e?.status ?? 'active';
  }

  @override
  void dispose() {
    _labelCtrl.dispose();
    _manufacturerCtrl.dispose();
    _modelCtrl.dispose();
    _serialCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.existing != null;
    final unitsForSite = widget.units.where((u) => u.siteId == _siteId).toList();
    return AlertDialog(
      title: Text(isEdit ? 'Edit asset' : 'New asset'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _labelCtrl,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Label *',
                  hintText: 'e.g. Block A roof geyser',
                ),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _assetType,
                items: _assetTypes
                    .map((t) => DropdownMenuItem<String>(value: t, child: Text(t)))
                    .toList(),
                onChanged: (v) {
                  if (v == null) return;
                  setState(() => _assetType = v);
                },
                decoration: const InputDecoration(labelText: 'Type *'),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _siteId,
                items: widget.sites
                    .map((s) => DropdownMenuItem<String>(
                          value: s.id,
                          child: Text(s.name, overflow: TextOverflow.ellipsis),
                        ))
                    .toList(),
                onChanged: (v) {
                  setState(() {
                    _siteId = v;
                    // Reset unit when site changes
                    _unitId = null;
                  });
                },
                decoration: const InputDecoration(labelText: 'Site *'),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String?>(
                initialValue: _unitId,
                items: [
                  const DropdownMenuItem<String?>(
                    value: null,
                    child: Text('— Site-level (no specific unit) —'),
                  ),
                  ...unitsForSite.map((u) => DropdownMenuItem<String?>(
                        value: u.id,
                        child: Text('Unit ${u.unitNumber}', overflow: TextOverflow.ellipsis),
                      )),
                ],
                onChanged: (v) => setState(() => _unitId = v),
                decoration: const InputDecoration(labelText: 'Unit (optional)'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _manufacturerCtrl,
                decoration: const InputDecoration(labelText: 'Manufacturer'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _modelCtrl,
                decoration: const InputDecoration(labelText: 'Model number'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _serialCtrl,
                decoration: const InputDecoration(labelText: 'Serial number'),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: _status,
                items: const [
                  DropdownMenuItem(value: 'active', child: Text('Active')),
                  DropdownMenuItem(value: 'retired', child: Text('Retired')),
                  DropdownMenuItem(value: 'out_of_service', child: Text('Out of service')),
                ],
                onChanged: (v) {
                  if (v == null) return;
                  setState(() => _status = v);
                },
                decoration: const InputDecoration(labelText: 'Status'),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        FilledButton(
          onPressed: () {
            final label = _labelCtrl.text.trim();
            if (label.isEmpty) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Label is required.')),
              );
              return;
            }
            if (_siteId == null) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Pick a site.')),
              );
              return;
            }
            final asset = Asset(
              id: widget.existing?.id ?? '',
              siteId: _siteId!,
              unitId: _unitId,
              assetType: _assetType,
              label: label,
              manufacturer: _manufacturerCtrl.text.trim().isEmpty ? null : _manufacturerCtrl.text.trim(),
              modelNumber: _modelCtrl.text.trim().isEmpty ? null : _modelCtrl.text.trim(),
              serialNumber: _serialCtrl.text.trim().isEmpty ? null : _serialCtrl.text.trim(),
              installDate: widget.existing?.installDate,
              warrantyExpires: widget.existing?.warrantyExpires,
              status: _status,
            );
            Navigator.of(context).pop(asset);
          },
          child: Text(isEdit ? 'Save' : 'Create'),
        ),
      ],
    );
  }
}
