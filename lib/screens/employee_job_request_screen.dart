import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/client.dart';
import '../models/inventory_item.dart';
import '../models/inventory_usage.dart';
import '../models/job.dart';
import '../models/job_card.dart';
import '../models/site.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/storage_service.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import 'job_card_screen.dart';

class EmployeeJobRequestScreen extends StatefulWidget {
  final bool embedded;

  const EmployeeJobRequestScreen({super.key, this.embedded = false});

  @override
  State<EmployeeJobRequestScreen> createState() => _EmployeeJobRequestScreenState();
}

class _EmployeeJobRequestScreenState extends State<EmployeeJobRequestScreen> {
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _clientNameCtrl = TextEditingController();
  final _siteLocationCtrl = TextEditingController();
  bool _saving = false;
  List<Map<String, dynamic>> _recipients = [];
  final Set<String> _selectedRecipients = {};

  bool _loadingClients = false;
  List<Client> _clients = [];
  List<Site> _sites = [];
  String? _selectedClientId;
  String? _selectedSiteId;
  bool _useCustomClient = false;
  bool _useCustomSiteLocation = false;

  final _picker = ImagePicker();
  bool _uploadingMedia = false;
  List<String> _beforePhotoUrls = [];
  List<String> _afterPhotoUrls = [];

  List<InventoryItem> _inventoryItems = [];
  final List<_UsageDraft> _usageDrafts = [];

  String? _pickDefaultRecipientId(List<Map<String, dynamic>> recipients) {
    if (recipients.isEmpty) return null;
    for (final role in const ['owner', 'admin', 'manager']) {
      final match = recipients.firstWhere(
        (r) => (r['role']?.toString().toLowerCase() ?? '') == role,
        orElse: () => <String, dynamic>{},
      );
      final id = match['auth_user_id']?.toString();
      if (id != null && id.isNotEmpty) return id;
    }
    final first = recipients.first['auth_user_id']?.toString();
    return (first != null && first.isNotEmpty) ? first : null;
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await _loadRecipients();
      await _loadClients();
    });
  }

  Future<void> _loadRecipients() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      final data = await SupabaseTimesheetStorage.getRecipientUsers(companyId: companyId);
      final validRecipients = data
          .where((r) => (r['auth_user_id']?.toString().trim().isNotEmpty ?? false))
          .toList();
      if (validRecipients.isEmpty) {
        final currentUser = Supabase.instance.client.auth.currentUser;
        if (currentUser != null) {
          validRecipients.add({
            'auth_user_id': currentUser.id,
            'role': 'owner',
            'is_active': true,
            'display_name':
                (currentUser.email?.trim().isNotEmpty ?? false) ? currentUser.email : 'HR Admin account',
          });
        }
      }
      final defaultRecipientId = _pickDefaultRecipientId(validRecipients);
      if (!mounted) return;
      setState(() {
        _recipients = validRecipients;
        if (defaultRecipientId != null && _selectedRecipients.isEmpty) {
          _selectedRecipients.add(defaultRecipientId);
        }
      });
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
        _selectedClientId ??= clients.isNotEmpty ? clients.first.id : null;
        _selectedSiteId = null;
      });

      if (_selectedClientId != null) {
        await _loadSitesForClient(_selectedClientId!);
      }
      final inventory = await SupabaseTimesheetStorage.getInventoryItems(companyId: companyId);
      if (!mounted) return;
      setState(() => _inventoryItems = inventory);
    } catch (e) {
      AppTelemetry.logError(screen: 'employee_job_request_screen', action: 'load_clients', error: e);
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
      AppTelemetry.logError(screen: 'employee_job_request_screen', action: 'load_sites', error: e);
      if (!mounted) return;
      setState(() => _sites = []);
    }
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _clientNameCtrl.dispose();
    _siteLocationCtrl.dispose();
    super.dispose();
  }

  Future<String> _uploadPhotoForJobRequest({
    required bool before,
    required String titleSeed,
  }) async {
    final img = await _picker.pickImage(source: ImageSource.camera, imageQuality: 80);
    if (img == null) {
      throw StateError('no_image_selected');
    }
    final bytes = await img.readAsBytes();
    final safeSeed = titleSeed.trim().replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
    return StorageService.uploadBytes(
      folder: 'job_requests/${safeSeed.isEmpty ? 'untitled' : safeSeed}',
      fileName:
          '${before ? 'before' : 'after'}_${DateTime.now().millisecondsSinceEpoch}.jpg',
      bytes: bytes,
      contentType: 'image/jpeg',
    );
  }

  Future<void> _addBeforePhoto() async {
    setState(() => _uploadingMedia = true);
    try {
      final url = await _uploadPhotoForJobRequest(before: true, titleSeed: _titleCtrl.text);
      if (!mounted) return;
      setState(() => _beforePhotoUrls = [..._beforePhotoUrls, url]);
      showSuccessSnack(context, 'Before photo uploaded.');
    } catch (e) {
      if (!mounted || e.toString().contains('no_image_selected')) return;
      AppTelemetry.logError(screen: 'employee_job_request_screen', action: 'add_before_photo', error: e);
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not upload before photo.'));
    } finally {
      if (mounted) setState(() => _uploadingMedia = false);
    }
  }

  Future<void> _addAfterPhoto() async {
    setState(() => _uploadingMedia = true);
    try {
      final url = await _uploadPhotoForJobRequest(before: false, titleSeed: _titleCtrl.text);
      if (!mounted) return;
      setState(() => _afterPhotoUrls = [..._afterPhotoUrls, url]);
      showSuccessSnack(context, 'After photo uploaded.');
    } catch (e) {
      if (!mounted || e.toString().contains('no_image_selected')) return;
      AppTelemetry.logError(screen: 'employee_job_request_screen', action: 'add_after_photo', error: e);
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not upload after photo.'));
    } finally {
      if (mounted) setState(() => _uploadingMedia = false);
    }
  }

  Future<void> _submit() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    final employee = context.read<TimesheetProvider>().currentEmployee;
    if (companyId == null || employee == null) return;
    if (_titleCtrl.text.trim().isEmpty) {
      showInfoSnack(context, 'Please enter a title.');
      return;
    }

    String? resolvedClientId = _selectedClientId;
    final customClientName = _clientNameCtrl.text.trim();
    if (_useCustomClient) {
      if (customClientName.isEmpty) {
        showInfoSnack(context, 'Please enter a client name.');
        return;
      }
    } else if (resolvedClientId == null) {
      showInfoSnack(context, 'Please select a client.');
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
      final recipientIds = _selectedRecipients.isNotEmpty
          ? _selectedRecipients.toList()
          : (fallbackRecipients.isNotEmpty
              ? fallbackRecipients
              : _recipients
                  .map((r) => r['auth_user_id']?.toString() ?? '')
                  .where((id) => id.isNotEmpty)
                  .toSet()
                  .toList());
      if (recipientIds.isEmpty) {
        showInfoSnack(context, 'No HR/manager recipient found yet. Ask HR admin to sign in first.');
        return;
      }

      if (_useCustomClient) {
        final existing = await SupabaseTimesheetStorage.findClientByName(
          customClientName,
          companyId: companyId,
        );
        if (existing != null) {
          resolvedClientId = existing.id;
        } else {
          final created = await SupabaseTimesheetStorage.createClientReturning(
            Client(id: '', name: customClientName),
            companyId: companyId,
          );
          resolvedClientId = created.id;
        }
      }

      if (resolvedClientId == null) {
        if (!mounted) return;
        showErrorSnack(context, 'Could not resolve client.');
        return;
      }

      String? resolvedSiteId = _selectedSiteId;
      final customLocation = _siteLocationCtrl.text.trim();
      if (_useCustomSiteLocation && customLocation.isNotEmpty) {
        final createdSite = await SupabaseTimesheetStorage.createSiteReturning(
          Site(
            id: '',
            clientId: resolvedClientId,
            name: customLocation,
            address: customLocation,
          ),
          companyId: companyId,
        );
        resolvedSiteId = createdSite.id;
      }

      final selectedUsages = _usageDrafts
          .where((d) => d.itemId != null && d.quantity != null && d.quantity! > 0)
          .map((d) => InventoryUsage(
                id: '',
                jobId: '',
                inventoryItemId: d.itemId!,
                quantity: d.quantity!,
                employeeId: employee.id,
              ))
          .toList();

      final mediaSummary =
          'Before photos: ${_beforePhotoUrls.length}, After photos: ${_afterPhotoUrls.length}';
      final enrichedDescription = [
        if (_descCtrl.text.trim().isNotEmpty) _descCtrl.text.trim(),
        if (_useCustomSiteLocation && customLocation.isNotEmpty) 'Location: $customLocation',
        mediaSummary,
      ].join('\n');

      // 1) Insert the submission record for routing/notifications to managers.
      final requestId = await SupabaseTimesheetStorage.insertEmployeeJobRequest(
        companyId: companyId,
        employeeId: employee.id,
        title: _titleCtrl.text.trim(),
        description: enrichedDescription.trim().isEmpty ? null : enrichedDescription.trim(),
        recipientUserIds: recipientIds,
      );

      // 2) Create the actual job immediately so the employee can fill the job card.
      final createdJobId = await SupabaseTimesheetStorage.createJobReturningId(
        Job(
          id: '',
          title: _titleCtrl.text.trim(),
          description: enrichedDescription.trim().isEmpty ? null : enrichedDescription.trim(),
          clientId: resolvedClientId,
          siteId: resolvedSiteId,
          status: JobStatus.scheduled,
          assignedEmployeeIds: [employee.id],
        ),
        companyId: companyId,
      );

      if (createdJobId == null) {
        if (!mounted) return;
        showErrorSnack(context, 'Could not create the job. Please ask HR to create it.');
        return;
      }

      // 3) Mark the request as converted so HR dashboards don’t show it as pending.
      if (requestId != null) {
        await SupabaseTimesheetStorage.updateEmployeeJobRequestStatus(
          companyId: companyId,
          requestId: requestId,
          status: 'converted',
        );
      }

      if (selectedUsages.isNotEmpty) {
        await SupabaseTimesheetStorage.setInventoryUsageForJob(
          jobId: createdJobId,
          employeeId: employee.id,
          companyId: companyId,
          usages: selectedUsages
              .map((u) => InventoryUsage(
                    id: '',
                    jobId: createdJobId,
                    inventoryItemId: u.inventoryItemId,
                    quantity: u.quantity,
                    employeeId: employee.id,
                  ))
              .toList(),
        );
      }

      final allMedia = [..._beforePhotoUrls, ..._afterPhotoUrls];
      if (allMedia.isNotEmpty) {
        final notesParts = <String>[
          if (_beforePhotoUrls.isNotEmpty) 'Before: ${_beforePhotoUrls.join(', ')}',
          if (_afterPhotoUrls.isNotEmpty) 'After: ${_afterPhotoUrls.join(', ')}',
        ];
        await SupabaseTimesheetStorage.upsertJobCard(
          JobCard(
            id: '',
            jobId: createdJobId,
            photoUrls: allMedia,
            notes: notesParts.join('\n'),
          ),
          companyId: companyId,
          employeeId: employee.id,
        );
      }

      final createdJob = Job(
        id: createdJobId,
        title: _titleCtrl.text.trim(),
        description: enrichedDescription.trim().isEmpty ? null : enrichedDescription.trim(),
        clientId: resolvedClientId,
        siteId: resolvedSiteId,
        status: JobStatus.scheduled,
        assignedEmployeeIds: [employee.id],
      );

      if (!mounted) return;
      showSuccessSnack(context, 'Job added with your request details.');

      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => JobCardScreen(job: createdJob)),
      );
    } catch (e) {
      AppTelemetry.logError(screen: 'employee_job_request_screen', action: 'add_job', error: e);
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not add job.'));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = Responsive.horizontalPadding(context);
    final content = SingleChildScrollView(
        padding: EdgeInsets.all(horizontalPadding),
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: Responsive.contentMaxWidth(context).clamp(0, 920)),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _titleCtrl,
                  decoration: const InputDecoration(labelText: 'Job title'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: _descCtrl,
                  maxLines: 4,
                  decoration: const InputDecoration(labelText: 'Job description'),
                ),
                const SizedBox(height: 12),

                // Client + site are required to create the actual job row.
                _loadingClients
                    ? const Center(child: CircularProgressIndicator(color: AppTheme.gold))
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          SwitchListTile(
                            value: _useCustomClient,
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Type new client name'),
                            onChanged: (v) => setState(() => _useCustomClient = v),
                          ),
                          if (_useCustomClient)
                            TextField(
                              controller: _clientNameCtrl,
                              decoration: const InputDecoration(
                                labelText: 'Client name',
                                isDense: true,
                              ),
                            )
                          else
                          DropdownButtonFormField<String>(
                            key: ValueKey<String?>('client_${_selectedClientId ?? ''}'),
                            initialValue: _selectedClientId,
                            items: _clients
                                .map(
                                  (c) => DropdownMenuItem<String>(
                                    value: c.id,
                                    child: Text(c.name),
                                  ),
                                )
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
                            decoration: const InputDecoration(
                              labelText: 'Client',
                              isDense: true,
                            ),
                          ),
                          const SizedBox(height: 10),
                          SwitchListTile(
                            value: _useCustomSiteLocation,
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Type site/location manually'),
                            onChanged: (v) => setState(() => _useCustomSiteLocation = v),
                          ),
                          if (_useCustomSiteLocation)
                            TextField(
                              controller: _siteLocationCtrl,
                              decoration: const InputDecoration(
                                labelText: 'Site or location',
                                isDense: true,
                              ),
                            )
                          else if (_sites.isNotEmpty)
                            DropdownButtonFormField<String>(
                              key: ValueKey<String?>('site_${_selectedSiteId ?? ''}'),
                              initialValue: _selectedSiteId,
                              items: _sites
                                  .map(
                                    (s) => DropdownMenuItem<String>(
                                      value: s.id,
                                      child: Text(s.name.isNotEmpty ? s.name : s.address ?? s.id),
                                    ),
                                  )
                                  .toList(),
                              onChanged: (v) => setState(() => _selectedSiteId = v),
                              decoration: const InputDecoration(
                                labelText: 'Site (optional)',
                                isDense: true,
                              ),
                            )
                          else
                            Text(
                              'No sites found for this client.',
                              style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                            ),
                        ],
                      ),

                const SizedBox(height: 12),

                Text('Inventory used', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                if (_inventoryItems.isEmpty)
                  Text('No inventory items found for your company.',
                      style: GoogleFonts.poppins(color: const Color(0xFF6B7280)))
                else ...[
                  OutlinedButton.icon(
                    onPressed: () => setState(() => _usageDrafts.add(const _UsageDraft())),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Add inventory item'),
                  ),
                  const SizedBox(height: 8),
                  ..._usageDrafts.asMap().entries.map((entry) {
                    final idx = entry.key;
                    final draft = entry.value;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        children: [
                          Expanded(
                            flex: 3,
                            child: DropdownButtonFormField<String>(
                              key: ValueKey<String?>('inv_${draft.itemId}_$idx'),
                              initialValue: draft.itemId,
                              items: _inventoryItems
                                  .map(
                                    (it) => DropdownMenuItem<String>(
                                      value: it.id,
                                      child: Text('${it.name} (stock: ${it.stockCount.toStringAsFixed(0)})'),
                                    ),
                                  )
                                  .toList(),
                              onChanged: (v) => setState(() => _usageDrafts[idx] = draft.copyWith(itemId: v)),
                              decoration: const InputDecoration(isDense: true, labelText: 'Item'),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            flex: 2,
                            child: TextFormField(
                              initialValue: draft.quantity?.toString() ?? '',
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: const InputDecoration(isDense: true, labelText: 'Qty'),
                              onChanged: (v) {
                                setState(() {
                                  _usageDrafts[idx] = draft.copyWith(quantity: double.tryParse(v.trim()));
                                });
                              },
                            ),
                          ),
                          IconButton(
                            onPressed: () => setState(() => _usageDrafts.removeAt(idx)),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                    );
                  }),
                ],

                const SizedBox(height: 12),

                Text('Before/After job photos', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _saving || _uploadingMedia ? null : _addBeforePhoto,
                        icon: const Icon(Icons.photo_camera_outlined),
                        label: Text('Before (${_beforePhotoUrls.length})'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _saving || _uploadingMedia ? null : _addAfterPhoto,
                        icon: const Icon(Icons.photo_camera),
                        label: Text('After (${_afterPhotoUrls.length})'),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 12),

                Text('Select HR/manager recipients', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                if (_recipients.isEmpty)
                  Text('No HR users found.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280)))
                else
                  ..._recipients.map((r) {
                    final id = r['auth_user_id']?.toString() ?? '';
                    final label = r['display_name']?.toString().isNotEmpty == true
                        ? r['display_name'].toString()
                        : '${r['role'] ?? 'hr'}';
                    return CheckboxListTile(
                      value: _selectedRecipients.contains(id),
                      title: Text(label),
                      subtitle: Text('Role: ${r['role'] ?? 'hr'}'),
                      onChanged: (v) {
                        setState(() {
                          if (v == true) {
                            _selectedRecipients.add(id);
                          } else {
                            _selectedRecipients.remove(id);
                          }
                        });
                      },
                    );
                  }),
                const SizedBox(height: 14),
                SizedBox(
                  height: 50,
                  child: ElevatedButton(
                    onPressed: _saving ? null : _submit,
                    style: ElevatedButton.styleFrom(backgroundColor: AppTheme.gold, foregroundColor: AppTheme.black),
                    child: _saving || _uploadingMedia
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text('Add job', style: GoogleFonts.poppins(fontWeight: FontWeight.w700)),
                  ),
                ),
              ],
                ),
              ),
            ),
          ),
        ),
      );
    if (widget.embedded) return content;
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text('Add Job', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
      ),
      body: content,
    );
  }
}

class _UsageDraft {
  final String? itemId;
  final double? quantity;

  const _UsageDraft({this.itemId, this.quantity});

  _UsageDraft copyWith({String? itemId, double? quantity}) {
    return _UsageDraft(
      itemId: itemId ?? this.itemId,
      quantity: quantity ?? this.quantity,
    );
  }
}
