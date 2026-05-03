import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../models/client.dart';
import '../models/site.dart';
import '../models/incident_report.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/supabase_timesheet_storage.dart';
import '../services/storage_service.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';

class IncidentReportScreen extends StatefulWidget {
  const IncidentReportScreen({super.key});

  @override
  State<IncidentReportScreen> createState() => _IncidentReportScreenState();
}

class _IncidentReportScreenState extends State<IncidentReportScreen> {
  final _descriptionController = TextEditingController();
  String _severity = 'low';
  bool _saving = false;
  bool _uploading = false;
  final _picker = ImagePicker();
  List<String> _photoUrls = [];
  List<Map<String, dynamic>> _recipients = [];
  final Set<String> _selectedRecipients = {};

  bool _loadingClients = false;
  List<Client> _clients = [];
  List<Site> _sites = [];
  String? _selectedClientId;
  String? _selectedSiteId;

  bool _isImageUrl(String url) {
    final u = url.toLowerCase();
    return u.endsWith('.jpg') ||
        u.endsWith('.jpeg') ||
        u.endsWith('.png') ||
        u.endsWith('.gif') ||
        u.endsWith('.webp');
  }

  String _guessMimeTypeFromName(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.mp4')) return 'video/mp4';
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.mkv')) return 'video/x-matroska';
    return 'application/octet-stream';
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadRecipients());
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadClients());
  }

  Future<void> _loadRecipients() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      final data = await SupabaseTimesheetStorage.getRecipientUsers(companyId: companyId);
      if (!mounted) return;
      setState(() => _recipients = data);
    } catch (_) {}
  }

  Future<void> _loadClients() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    setState(() => _loadingClients = true);
    try {
      final clients = await SupabaseTimesheetStorage.getClients(companyId: companyId);
      if (!mounted) return;
      setState(() {
        _clients = clients;
        _selectedClientId = clients.isNotEmpty ? clients.first.id : null;
        _selectedSiteId = null;
      });
      if (_selectedClientId != null) {
        await _loadSitesForClient(_selectedClientId!);
      }
    } catch (e) {
      AppTelemetry.logError(screen: 'incident_report_screen', action: 'load_clients', error: e);
      if (!mounted) return;
      setState(() => _clients = []);
    } finally {
      if (mounted) setState(() => _loadingClients = false);
    }
  }

  Future<void> _loadSitesForClient(String clientId) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      final sites = await SupabaseTimesheetStorage.getSitesForClient(clientId, companyId: companyId);
      if (!mounted) return;
      setState(() {
        _sites = sites;
        _selectedSiteId = sites.isNotEmpty ? sites.first.id : null;
      });
    } catch (e) {
      AppTelemetry.logError(screen: 'incident_report_screen', action: 'load_sites', error: e);
      if (!mounted) return;
      setState(() => _sites = []);
    }
  }

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _addPhoto() async {
    setState(() => _uploading = true);
    try {
      final img = await _picker.pickImage(source: ImageSource.camera, imageQuality: 80);
      if (img == null || !mounted) return;
      final bytes = await img.readAsBytes();
      final url = await StorageService.uploadBytes(
        folder: 'incidents',
        fileName: img.name.isNotEmpty
            ? img.name
            : 'incident_${DateTime.now().millisecondsSinceEpoch}.jpg',
        bytes: bytes,
        contentType: _guessMimeTypeFromName(img.name),
      );
      if (!mounted) return;
      setState(() => _photoUrls = [..._photoUrls, url]);
      showSuccessSnack(context, 'Photo uploaded.');
      AppTelemetry.logInfo(screen: 'incident_report_screen', action: 'photo_uploaded');
    } catch (e) {
      if (!mounted) return;
      AppTelemetry.logError(screen: 'incident_report_screen', action: 'photo_upload', error: e);
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Photo upload failed.'));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _addVideo() async {
    setState(() => _uploading = true);
    try {
      final vid = await _picker.pickVideo(source: ImageSource.camera);
      if (vid == null || !mounted) return;
      final bytes = await vid.readAsBytes();
      final url = await StorageService.uploadBytes(
        folder: 'incidents',
        fileName: vid.name.isNotEmpty
            ? vid.name
            : 'incident_${DateTime.now().millisecondsSinceEpoch}.mp4',
        bytes: bytes,
        contentType: _guessMimeTypeFromName(vid.name),
      );
      if (!mounted) return;
      setState(() => _photoUrls = [..._photoUrls, url]);
      showSuccessSnack(context, 'Video uploaded.');
      AppTelemetry.logInfo(screen: 'incident_report_screen', action: 'video_uploaded');
    } catch (e) {
      if (!mounted) return;
      AppTelemetry.logError(screen: 'incident_report_screen', action: 'video_upload', error: e);
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Video upload failed.'));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _submit() async {
    final employee = context.read<TimesheetProvider>().currentEmployee;
    if (employee == null) return;
    final desc = _descriptionController.text.trim();
    if (desc.isEmpty) {
      showInfoSnack(context, 'Please enter a description.');
      return;
    }
    if (_selectedSiteId == null) {
      showInfoSnack(context, 'Please select a site.');
      return;
    }

    setState(() => _saving = true);
    try {
      final fallbackRecipients = _recipients
          .where((r) {
            final role = (r['role']?.toString().toLowerCase() ?? '');
            return role == 'manager' || role == 'admin' || role == 'owner';
          })
          .map((r) => r['auth_user_id']?.toString() ?? '')
          .where((id) => id.isNotEmpty)
          .toSet()
          .toList();
      final recipientIds =
          _selectedRecipients.isNotEmpty ? _selectedRecipients.toList() : fallbackRecipients;

      final incident = IncidentReport(
        id: '',
        employeeId: employee.id,
        description: desc,
        severity: _severity,
        createdAt: DateTime.now(),
        siteId: _selectedSiteId,
        photoUrls: _photoUrls,
      );
      await SupabaseTimesheetStorage.insertIncident(
        incident,
        companyId: context.read<TimesheetProvider>().currentCompanyId,
        employeeCode: employee.employeeCode,
        recipientUserIds: recipientIds,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Incident submitted.');
      AppTelemetry.logInfo(screen: 'incident_report_screen', action: 'incident_submitted');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      AppTelemetry.logError(screen: 'incident_report_screen', action: 'submit_incident', error: e);
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Incident submission failed.'));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final employee = context.watch<TimesheetProvider>().currentEmployee;
    final busy = _saving || _uploading;
    final horizontalPadding = Responsive.horizontalPadding(context);
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text('Incident Report', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppTheme.gold),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: employee == null
          ? Center(child: Text('No employee selected.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280))))
          : SingleChildScrollView(
              padding: EdgeInsets.all(horizontalPadding),
              child: Center(
                child: ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: Responsive.contentMaxWidth(context).clamp(0, 920)),
                  child: Card(
                    color: Colors.white,
                    elevation: 4,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: const BorderSide(color: Color(0xFFE5E7EB)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_loadingClients)
                        const Center(child: CircularProgressIndicator(color: AppTheme.gold))
                      else ...[
                        DropdownButtonFormField<String>(
                          key: ValueKey<String>('incident_client_${_selectedClientId ?? 'none'}'),
                          initialValue: _selectedClientId,
                          items: _clients
                              .map((c) => DropdownMenuItem<String>(value: c.id, child: Text(c.name)))
                              .toList(),
                          onChanged: _clients.isEmpty
                              ? null
                              : (v) async {
                                  if (v == null) return;
                                  setState(() {
                                    _selectedClientId = v;
                                    _selectedSiteId = null;
                                  });
                                  await _loadSitesForClient(v);
                                },
                          decoration: const InputDecoration(labelText: 'Client', isDense: true),
                        ),
                        const SizedBox(height: 10),
                        DropdownButtonFormField<String>(
                          key: ValueKey<String>('incident_site_${_selectedSiteId ?? 'none'}'),
                          initialValue: _selectedSiteId,
                          items: _sites
                              .map(
                                (s) => DropdownMenuItem<String>(
                                  value: s.id,
                                  child: Text(s.name.isNotEmpty ? s.name : s.address ?? s.id),
                                ),
                              )
                              .toList(),
                          onChanged: _sites.isEmpty ? null : (v) => setState(() => _selectedSiteId = v),
                          decoration: const InputDecoration(labelText: 'Site', isDense: true),
                        ),
                        const SizedBox(height: 12),
                      ],

                      Text('Severity', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      DropdownButtonFormField<String>(
                        key: ValueKey<String>('incident_severity_$_severity'),
                        initialValue: _severity,
                        items: const [
                          DropdownMenuItem(value: 'low', child: Text('Low')),
                          DropdownMenuItem(value: 'medium', child: Text('Medium')),
                          DropdownMenuItem(value: 'high', child: Text('High')),
                        ],
                        onChanged: busy ? null : (v) => setState(() => _severity = v ?? 'low'),
                        decoration: const InputDecoration(isDense: true),
                      ),
                      const SizedBox(height: 12),
                      Text('Description', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _descriptionController,
                        maxLines: 5,
                        enabled: !busy,
                        decoration: const InputDecoration(hintText: 'Describe what happened...'),
                      ),
                      const SizedBox(height: 14),
                      Text('Notify HR/Managers', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      if (_recipients.isEmpty)
                        Text(
                          'No recipients configured.',
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                        )
                      else
                        ..._recipients.map((r) {
                          final id = r['auth_user_id']?.toString() ?? '';
                          final label = r['display_name']?.toString().isNotEmpty == true
                              ? r['display_name'].toString()
                              : '${r['role'] ?? 'hr'}';
                          return CheckboxListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            title: Text(label, style: GoogleFonts.poppins(fontSize: 12)),
                            subtitle: Text('Role: ${r['role'] ?? 'hr'}', style: GoogleFonts.poppins(fontSize: 10)),
                            value: _selectedRecipients.contains(id),
                            onChanged: busy
                                ? null
                                : (v) => setState(() {
                                      if (v == true) {
                                        _selectedRecipients.add(id);
                                      } else {
                                        _selectedRecipients.remove(id);
                                      }
                                    }),
                          );
                        }),
                      const SizedBox(height: 8),
                      Text('Media', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: busy ? null : _addPhoto,
                              icon: const Icon(Icons.photo_camera, size: 18),
                              label: Text('Add photo', style: GoogleFonts.poppins(fontSize: 12)),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: busy ? null : _addVideo,
                              icon: const Icon(Icons.videocam_outlined, size: 18),
                              label: Text('Add video', style: GoogleFonts.poppins(fontSize: 12)),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      if (_photoUrls.isNotEmpty)
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: _photoUrls.take(6).map((u) {
                            final isImg = _isImageUrl(u);
                            return ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: isImg
                                  ? Image.network(
                                      u,
                                      width: 84,
                                      height: 84,
                                      fit: BoxFit.cover,
                                    )
                                  : Container(
                                      width: 84,
                                      height: 84,
                                      color: const Color(0xFFF3F4F6),
                                      alignment: Alignment.center,
                                      child: const Icon(Icons.videocam_outlined, color: Color(0xFF9CA3AF)),
                                    ),
                            );
                          }).toList(),
                        )
                      else
                        Text(
                          'No media yet.',
                          style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                        ),
                      const SizedBox(height: 16),
                      SizedBox(
                        height: 52,
                        child: ElevatedButton.icon(
                          onPressed: busy ? null : _submit,
                          icon: _saving
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                                )
                              : const Icon(Icons.send),
                          label: Text(
                            _saving ? 'Submitting...' : 'Submit incident',
                            style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
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

