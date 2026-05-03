import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:signature/signature.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/job.dart';
import '../models/job_card.dart';
import '../models/inventory_item.dart';
import '../models/inventory_usage.dart';
import '../models/inventory_allocation.dart';
import '../providers/job_provider.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../services/location_service.dart';
import '../services/storage_service.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';

class JobCardScreen extends StatefulWidget {
  final Job job;

  const JobCardScreen({super.key, required this.job});

  @override
  State<JobCardScreen> createState() => _JobCardScreenState();
}

class _JobCardScreenState extends State<JobCardScreen> {
  final _workPerformedController = TextEditingController();
  final _materialsController = TextEditingController();
  final _notesController = TextEditingController();

  JobCard? _existing;
  bool _loading = true;
  DateTime? _actualStart;
  DateTime? _actualEnd;
  final _signatureController = SignatureController(
    penStrokeWidth: 3,
    penColor: AppTheme.gold,
  );
  final _picker = ImagePicker();
  bool _uploadingMedia = false;
  List<String> _photoUrls = [];
  String? _signatureUrl;
  List<InventoryItem> _inventoryItems = [];
  List<_UsageDraft> _usageDrafts = [];

  /// Inventory allocations issued to this worker for this job.
  List<InventoryAllocation> _allocations = const [];

  /// Per-allocation draft state — keyed by allocation ID. Captures the
  /// used / leftover / extra inputs the worker fills in.
  final Map<String, _AllocationDraft> _allocationDrafts = {};

  Future<void> _captureClientFeedbackOnDevice() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    int rating = 5;
    final commentsCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Client feedback'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Rating: $rating / 5'),
                Slider(
                  value: rating.toDouble(),
                  min: 1,
                  max: 5,
                  divisions: 4,
                  onChanged: (v) => setLocal(() => rating = v.round()),
                ),
                TextField(
                  controller: commentsCtrl,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Comments (optional)'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
            ElevatedButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Submit')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await SupabaseTimesheetStorage.upsertJobFeedback(
        companyId: companyId,
        jobId: widget.job.id,
        rating: rating,
        comments: commentsCtrl.text.trim(),
        channel: 'on_device',
      );
      await SupabaseTimesheetStorage.markFeedbackRequestSent(
        companyId: companyId,
        jobId: widget.job.id,
        sentVia: 'on_device',
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Client feedback submitted.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not submit feedback.'));
    }
  }

  Future<void> _requestClientFeedbackViaEmail() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      final client = await SupabaseTimesheetStorage.getClientById(
        widget.job.clientId,
        companyId: companyId,
      );
      final email = client?.email?.trim() ?? '';
      if (email.isEmpty) {
        if (!mounted) return;
        showInfoSnack(context, 'This client has no email. Add one in Clients.');
        return;
      }
      final token = await SupabaseTimesheetStorage.createJobFeedbackRequestToken(
        companyId: companyId,
        jobId: widget.job.id,
      );
      if (token == null) {
        if (!mounted) return;
        showErrorSnack(context, 'Could not generate feedback request link.');
        return;
      }
      final link = SupabaseTimesheetStorage.buildPublicFeedbackLink(token);
      final subject = Uri.encodeComponent('Feedback request for ${widget.job.title}');
      final body = Uri.encodeComponent(
        'Hi,\n\nPlease share your feedback for the completed job "${widget.job.title}".\n\n$link\n\nThank you.',
      );
      final mailto = Uri.parse('mailto:$email?subject=$subject&body=$body');
      final opened = await launchUrl(mailto, mode: LaunchMode.externalApplication);
      if (!mounted) return;
      if (opened) {
        await SupabaseTimesheetStorage.markFeedbackRequestSent(
          companyId: companyId,
          jobId: widget.job.id,
          sentVia: 'email',
        );
        showSuccessSnack(context, 'Email app opened with the feedback request.');
      } else {
        showErrorSnack(context, 'Could not open email app on this device.');
      }
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not prepare feedback email.'));
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final timesheet = context.read<TimesheetProvider>();
      final companyId = timesheet.currentCompanyId;
      final employeeId = timesheet.currentEmployee?.id;
      final card = await context.read<JobProvider>().loadJobCard(widget.job.id);
      final invItems = await SupabaseTimesheetStorage.getInventoryItems(
        companyId: companyId,
        employeeId: employeeId,
      );
      final existingUsage = await SupabaseTimesheetStorage.getInventoryUsageForJob(
        widget.job.id,
        companyId: companyId,
        employeeId: employeeId,
      );
      // Allocations issued to this worker for this job specifically.
      final allocations = (companyId != null && employeeId != null)
          ? await SupabaseTimesheetStorage.getAllocationsForWorker(
              companyId: companyId,
              workerEmployeeId: employeeId,
              jobId: widget.job.id,
            )
          : const <InventoryAllocation>[];
      if (!mounted) return;
      setState(() {
        _existing = card;
        _workPerformedController.text = card?.workPerformed ?? '';
        _materialsController.text = card?.materialsUsed ?? '';
        _notesController.text = card?.notes ?? '';
        _actualStart = card?.actualStart;
        _actualEnd = card?.actualEnd;
        _photoUrls = card?.photoUrls ?? const [];
        _signatureUrl = card?.customerSignatureUrl;
        _inventoryItems = invItems;
        // Keep free-form usage rows that weren't linked to an allocation.
        // Allocation-linked rows are managed separately via _allocations.
        _usageDrafts = existingUsage
            .where((u) => u.quantity > 0)
            .map((u) => _UsageDraft(itemId: u.inventoryItemId, quantity: u.quantity))
            .toList();
        _allocations = allocations;
        for (final a in allocations) {
          _allocationDrafts.putIfAbsent(
            a.id,
            () => _AllocationDraft(
              used: a.quantityUsed,
              leftover: a.quantityReturned,
              extra: a.quantityExtra,
            ),
          );
        }
        _loading = false;
      });
    });
  }

  @override
  void dispose() {
    _workPerformedController.dispose();
    _materialsController.dispose();
    _notesController.dispose();
    _signatureController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final prov = context.read<JobProvider>();
    final card = JobCard(
      id: _existing?.id ?? '',
      jobId: widget.job.id,
      actualStart: _actualStart,
      actualEnd: _actualEnd,
      workPerformed: _workPerformedController.text.trim().isEmpty ? null : _workPerformedController.text.trim(),
      materialsUsed: _materialsController.text.trim().isEmpty ? null : _materialsController.text.trim(),
      notes: _notesController.text.trim().isEmpty ? null : _notesController.text.trim(),
      photoUrls: _photoUrls,
      customerSignatureUrl: _signatureUrl,
    );

    final employeeId = context.read<TimesheetProvider>().currentEmployee?.id;
    final usages = _usageDrafts
        .where((d) => d.itemId != null && d.quantity != null && d.quantity! > 0)
        .map(
          (d) => InventoryUsage(
            id: '',
            jobId: widget.job.id,
            inventoryItemId: d.itemId!,
            quantity: d.quantity!,
            employeeId: employeeId,
          ),
        )
        .toList();
    try {
      await SupabaseTimesheetStorage.setInventoryUsageForJob(
        jobId: widget.job.id,
        employeeId: employeeId,
        companyId: context.read<TimesheetProvider>().currentCompanyId,
        usages: usages,
      );
      // Allocation-linked usage rows: replace per-allocation so the
      // computed remaining/extra columns on v_inventory_allocations stay
      // in sync with what the worker actually consumed.
      final companyId = context.read<TimesheetProvider>().currentCompanyId;
      if (companyId != null) {
        for (final a in _allocations) {
          final draft = _allocationDrafts[a.id];
          if (draft == null) continue;
          await SupabaseTimesheetStorage.replaceAllocationUsage(
            companyId: companyId,
            jobId: widget.job.id,
            allocationId: a.id,
            inventoryItemId: a.inventoryItemId,
            quantityUsed: draft.used,
            leftoverReturned: draft.leftover > 0 ? draft.leftover : null,
            extraUsed: draft.extra > 0 ? draft.extra : null,
            employeeId: employeeId,
          );
        }
      }
    } catch (e) {
      if (!mounted) return;
      AppTelemetry.logError(screen: 'job_card_screen', action: 'inventory_update', error: e);
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Inventory update failed.'));
      return;
    }

    await prov.saveJobCard(card);

    if (!mounted) return;
    showSuccessSnack(context, 'Job card saved.');
    AppTelemetry.logInfo(screen: 'job_card_screen', action: 'job_card_saved');
  }

  Future<void> _addPhoto() async {
    setState(() => _uploadingMedia = true);
    try {
      final img = await _picker.pickImage(source: ImageSource.camera, imageQuality: 80);
      if (img == null || !mounted) return;
      final bytes = await img.readAsBytes();
      final url = await StorageService.uploadBytes(
        folder: 'job_cards/${widget.job.id}',
        fileName: 'photo_${DateTime.now().millisecondsSinceEpoch}.jpg',
        bytes: bytes,
        contentType: 'image/jpeg',
      );
      if (!mounted) return;
      setState(() => _photoUrls = [..._photoUrls, url]);
      showSuccessSnack(context, 'Photo uploaded.');
      AppTelemetry.logInfo(screen: 'job_card_screen', action: 'photo_uploaded');
    } catch (e) {
      if (!mounted) return;
      AppTelemetry.logError(screen: 'job_card_screen', action: 'photo_upload', error: e);
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Photo upload failed.'));
    } finally {
      if (mounted) setState(() => _uploadingMedia = false);
    }
  }

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

  Future<void> _addVideo() async {
    setState(() => _uploadingMedia = true);
    try {
      final vid = await _picker.pickVideo(source: ImageSource.camera);
      if (vid == null || !mounted) return;
      final bytes = await vid.readAsBytes();
      final ext = vid.name.isNotEmpty && vid.name.contains('.') ? vid.name.split('.').last : 'mp4';
      final url = await StorageService.uploadBytes(
        folder: 'job_cards/${widget.job.id}',
        fileName: 'video_${DateTime.now().millisecondsSinceEpoch}.$ext',
        bytes: bytes,
        contentType: _guessMimeTypeFromName(vid.name),
      );
      if (!mounted) return;
      setState(() => _photoUrls = [..._photoUrls, url]);
      showSuccessSnack(context, 'Video uploaded.');
      AppTelemetry.logInfo(screen: 'job_card_screen', action: 'video_uploaded');
    } catch (e) {
      if (!mounted) return;
      AppTelemetry.logError(screen: 'job_card_screen', action: 'video_upload', error: e);
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Video upload failed.'));
    } finally {
      if (mounted) setState(() => _uploadingMedia = false);
    }
  }

  Future<void> _saveSignature() async {
    if (_signatureController.isEmpty) {
      showInfoSnack(context, 'Please sign first.');
      return;
    }
    setState(() => _uploadingMedia = true);
    try {
      final bytes = await _signatureController.toPngBytes();
      if (bytes == null || !mounted) return;
      final url = await StorageService.uploadBytes(
        folder: 'job_cards/${widget.job.id}',
        fileName: 'signature_${DateTime.now().millisecondsSinceEpoch}.png',
        bytes: bytes,
        contentType: 'image/png',
      );
      if (!mounted) return;
      setState(() => _signatureUrl = url);
      showSuccessSnack(context, 'Signature saved.');
      AppTelemetry.logInfo(screen: 'job_card_screen', action: 'signature_saved');
    } catch (e) {
      if (!mounted) return;
      AppTelemetry.logError(screen: 'job_card_screen', action: 'signature_upload', error: e);
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Signature upload failed.'));
    } finally {
      if (mounted) setState(() => _uploadingMedia = false);
    }
  }

  Future<void> _captureLocationNow() async {
    final position = await LocationService.getCurrentPosition();
    if (!mounted) return;
    if (position == null) {
      showErrorSnack(context, 'Could not capture location. Check permission.');
      AppTelemetry.logError(screen: 'job_card_screen', action: 'capture_location', error: 'position_null');
      return;
    }
    await LocationService.getAddressFromPosition(position.latitude, position.longitude);
    if (!mounted) return;
    // Phase 6 will replace this with proper job location + job-site validation.
    // For now, this is a UI-only capture hook and does not modify job data.
    showSuccessSnack(context, 'Location captured.');
    AppTelemetry.logInfo(screen: 'job_card_screen', action: 'location_captured');
  }

  Future<void> _setStatus(JobStatus status) async {
    final updated = Job(
      id: widget.job.id,
      title: widget.job.title,
      clientId: widget.job.clientId,
      description: widget.job.description,
      siteId: widget.job.siteId,
      scheduledStart: widget.job.scheduledStart,
      scheduledEnd: widget.job.scheduledEnd,
      status: status,
      assignedEmployeeIds: widget.job.assignedEmployeeIds,
    );
    await context.read<JobProvider>().updateJob(updated);
    if (!mounted) return;
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final jobsProv = context.watch<JobProvider>();
    final isBusy = _loading || jobsProv.isLoading || _uploadingMedia;

    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text('Job Card', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppTheme.gold),
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          TextButton(
            onPressed: isBusy ? null : _save,
            child: Text(
              'Save',
              style: GoogleFonts.poppins(
                color: isBusy ? const Color(0xFF9CA3AF) : AppTheme.gold,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
      body: isBusy
          ? const Center(child: CircularProgressIndicator(color: AppTheme.gold))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Card(
                    color: Colors.white,
                    elevation: 4,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(20),
                      side: const BorderSide(color: Color(0xFFE5E7EB)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.job.title,
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF111827),
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (widget.job.description != null && widget.job.description!.trim().isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Text(
                                widget.job.description!,
                                style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  if (_allocations.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    _AllocatedToYouCard(
                      allocations: _allocations,
                      drafts: _allocationDrafts,
                      onChanged: () => setState(() {}),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Card(
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
                          Row(
                            children: [
                              Text(
                                _allocations.isNotEmpty ? 'Other inventory used' : 'Inventory used',
                                style: GoogleFonts.poppins(
                                  color: const Color(0xFF111827),
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const Spacer(),
                              OutlinedButton.icon(
                                onPressed: () => setState(() => _usageDrafts.add(const _UsageDraft())),
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: AppTheme.gold,
                                  side: const BorderSide(color: AppTheme.gold),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                ),
                                icon: const Icon(Icons.add, size: 18),
                                label: Text('Add', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          if (_inventoryItems.isEmpty)
                            Text(
                              'No inventory items found.',
                              style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                            )
                          else if (_usageDrafts.isEmpty)
                            Text(
                              'Add the inventory you used for this job.',
                              style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                            )
                          else
                            ..._usageDrafts.asMap().entries.map((entry) {
                              final idx = entry.key;
                              final draft = entry.value;
                              return Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: Row(
                                  children: [
                                    Expanded(
                                      flex: 3,
                                      child: DropdownButtonFormField<String>(
                                        key: ValueKey<String?>(draft.itemId),
                                        initialValue: draft.itemId,
                                        isExpanded: true,
                                        items: _inventoryItems
                                            .map(
                                              (it) => DropdownMenuItem(
                                                value: it.id,
                                                child: Text(
                                                  '${it.name}  (stock: ${it.stockCount.toStringAsFixed(0)}${it.unit != null ? ' ${it.unit}' : ''})',
                                                  overflow: TextOverflow.ellipsis,
                                                ),
                                              ),
                                            )
                                            .toList(),
                                        onChanged: (v) => setState(() {
                                          _usageDrafts[idx] = draft.copyWith(itemId: v);
                                        }),
                                        decoration: InputDecoration(
                                          filled: true,
                                          fillColor: Colors.white,
                                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                                          border: OutlineInputBorder(
                                            borderRadius: BorderRadius.circular(14),
                                            borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
                                          ),
                                          enabledBorder: OutlineInputBorder(
                                            borderRadius: BorderRadius.circular(14),
                                            borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
                                          ),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      flex: 2,
                                      child: TextFormField(
                                        initialValue: draft.quantity?.toString() ?? '',
                                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                        decoration: InputDecoration(
                                          labelText: 'Qty',
                                          filled: true,
                                          fillColor: Colors.white,
                                          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                                          border: OutlineInputBorder(
                                            borderRadius: BorderRadius.circular(14),
                                            borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
                                          ),
                                          enabledBorder: OutlineInputBorder(
                                            borderRadius: BorderRadius.circular(14),
                                            borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
                                          ),
                                        ),
                                        onChanged: (v) => setState(() {
                                          final parsed = double.tryParse(v.trim());
                                          _usageDrafts[idx] = draft.copyWith(quantity: parsed);
                                        }),
                                      ),
                                    ),
                                    const SizedBox(width: 10),
                                    IconButton(
                                      tooltip: 'Remove',
                                      onPressed: () => setState(() => _usageDrafts.removeAt(idx)),
                                      icon: const Icon(Icons.close, color: Color(0xFF9CA3AF)),
                                    ),
                                  ],
                                ),
                              );
                            }),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Card(
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
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: () async {
                                    setState(() => _actualStart = DateTime.now());
                                    await _setStatus(JobStatus.inProgress);
                                  },
                                  icon: const Icon(Icons.play_arrow, size: 18),
                                  label: Text('Start job', style: GoogleFonts.poppins(fontSize: 12)),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: () async {
                                    setState(() => _actualEnd = DateTime.now());
                                    await _setStatus(JobStatus.completed);
                                  },
                                  icon: const Icon(Icons.check_circle_outline, size: 18),
                                  label: Text('Complete', style: GoogleFonts.poppins(fontSize: 12)),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          OutlinedButton.icon(
                            onPressed: _captureLocationNow,
                            icon: const Icon(Icons.my_location, size: 18),
                            label: Text('Capture location now', style: GoogleFonts.poppins(fontSize: 12)),
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: _captureClientFeedbackOnDevice,
                                  icon: const Icon(Icons.rate_review_outlined, size: 18),
                                  label: Text('Request feedback (on phone)', style: GoogleFonts.poppins(fontSize: 12)),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: _requestClientFeedbackViaEmail,
                                  icon: const Icon(Icons.email_outlined, size: 18),
                                  label: Text('Request via email', style: GoogleFonts.poppins(fontSize: 12)),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Text(
                            'Actual start: ${_actualStart?.toIso8601String() ?? "—"}',
                            style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                          ),
                          Text(
                            'Actual end: ${_actualEnd?.toIso8601String() ?? "—"}',
                            style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Card(
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
                          Text('Work performed', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                          const SizedBox(height: 8),
                          TextField(
                            controller: _workPerformedController,
                            maxLines: 4,
                            decoration: const InputDecoration(hintText: 'Describe what you did'),
                          ),
                          const SizedBox(height: 12),
                          Text('Materials used', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                          const SizedBox(height: 8),
                          TextField(
                            controller: _materialsController,
                            maxLines: 2,
                            decoration: const InputDecoration(hintText: 'e.g. Copper pipe, sealant'),
                          ),
                          const SizedBox(height: 12),
                          Text('Notes', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                          const SizedBox(height: 8),
                          TextField(
                            controller: _notesController,
                            maxLines: 3,
                            decoration: const InputDecoration(hintText: 'Any extra notes'),
                          ),
                          const SizedBox(height: 14),
                          Text(
                            'Media',
                            style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: isBusy ? null : _addPhoto,
                                  icon: const Icon(Icons.photo_camera, size: 18),
                                  label: Text('Add photo', style: GoogleFonts.poppins(fontSize: 12)),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: isBusy ? null : _addVideo,
                                  icon: const Icon(Icons.videocam_outlined, size: 18),
                                  label: Text('Add video', style: GoogleFonts.poppins(fontSize: 12)),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          if (_photoUrls.isEmpty)
                            Text(
                              'No media yet.',
                              style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                            )
                          else
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
                                          errorBuilder: (_, _, _) => Container(
                                            width: 84,
                                            height: 84,
                                            color: const Color(0xFFF3F4F6),
                                            alignment: Alignment.center,
                                            child: const Icon(Icons.broken_image_outlined, color: Color(0xFF9CA3AF)),
                                          ),
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
                            ),
                          const SizedBox(height: 16),
                          Text(
                            'Customer signature',
                            style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 8),
                          Container(
                            height: 160,
                            decoration: BoxDecoration(
                              color: const Color(0xFFF9FAFB),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: const Color(0xFFE5E7EB)),
                            ),
                            child: Signature(
                              controller: _signatureController,
                              backgroundColor: Colors.transparent,
                            ),
                          ),
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: isBusy ? null : () => _signatureController.clear(),
                                  icon: const Icon(Icons.delete_outline, size: 18),
                                  label: Text('Clear', style: GoogleFonts.poppins(fontSize: 12)),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: ElevatedButton.icon(
                                  onPressed: isBusy ? null : _saveSignature,
                                  icon: const Icon(Icons.save_outlined, size: 18),
                                  label: Text('Save signature', style: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w600)),
                                ),
                              ),
                            ],
                          ),
                          if (_signatureUrl != null) ...[
                            const SizedBox(height: 10),
                            Text(
                              'Signature saved.',
                              style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

@immutable
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

/// Mutable per-allocation draft: how much the worker actually used,
/// returned (leftover) and consumed beyond what was issued (extra).
class _AllocationDraft {
  double used;
  double leftover;
  double extra;

  _AllocationDraft({
    this.used = 0,
    this.leftover = 0,
    this.extra = 0,
  });
}

/// "Allocated to you" panel on the job card. Shows each active
/// allocation with the issued quantity and three small inputs for
/// used, leftover returned, and extra consumed.
class _AllocatedToYouCard extends StatelessWidget {
  final List<InventoryAllocation> allocations;
  final Map<String, _AllocationDraft> drafts;
  final VoidCallback onChanged;

  const _AllocatedToYouCard({
    required this.allocations,
    required this.drafts,
    required this.onChanged,
  });

  String _fmt(double v) => v.toStringAsFixed(v % 1 == 0 ? 0 : 2);

  @override
  Widget build(BuildContext context) {
    return Card(
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
            Row(
              children: [
                const Icon(Icons.outbox_outlined, color: Color(0xFF7C3AED), size: 18),
                const SizedBox(width: 6),
                Text(
                  'Allocated to you',
                  style: GoogleFonts.poppins(
                    color: const Color(0xFF111827),
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: const Color(0xFF7C3AED).withValues(alpha: 0.10 * 255),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '${allocations.length}',
                    style: GoogleFonts.poppins(
                      color: const Color(0xFF7C3AED),
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Record what you actually used. Anything left over goes back to stock; extra usage shows up to HR for review.',
              style: GoogleFonts.poppins(
                color: const Color(0xFF6B7280),
                fontSize: 11,
              ),
            ),
            const SizedBox(height: 12),
            ...allocations.map((a) {
              final draft = drafts.putIfAbsent(a.id, () => _AllocationDraft());
              final unitSuffix = (a.unit != null && a.unit!.isNotEmpty) ? ' ${a.unit}' : '';
              return Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF9FAFB),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFE5E7EB)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            a.itemName ?? 'Item',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF111827),
                              fontWeight: FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: const Color(0xFFEFF4FF),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: Text(
                              'Issued ${_fmt(a.quantityAllocated)}$unitSuffix',
                              style: GoogleFonts.poppins(
                                color: const Color(0xFF2563EB),
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          if (a.jobTitle != null)
                            Text(
                              'For: ${a.jobTitle}',
                              style: GoogleFonts.poppins(
                                color: const Color(0xFF6B7280),
                                fontSize: 11,
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              initialValue: draft.used > 0 ? _fmt(draft.used) : '',
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: InputDecoration(
                                labelText: 'Used',
                                isDense: true,
                                suffixText: a.unit,
                              ),
                              onChanged: (v) {
                                draft.used = double.tryParse(v.replaceAll(',', '.')) ?? 0;
                                onChanged();
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextFormField(
                              initialValue: draft.leftover > 0 ? _fmt(draft.leftover) : '',
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: InputDecoration(
                                labelText: 'Leftover',
                                isDense: true,
                                suffixText: a.unit,
                                helperText: 'Returned to stock',
                              ),
                              onChanged: (v) {
                                draft.leftover = double.tryParse(v.replaceAll(',', '.')) ?? 0;
                                onChanged();
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextFormField(
                              initialValue: draft.extra > 0 ? _fmt(draft.extra) : '',
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: InputDecoration(
                                labelText: 'Extra',
                                isDense: true,
                                suffixText: a.unit,
                                helperText: 'Used above issued',
                              ),
                              onChanged: (v) {
                                draft.extra = double.tryParse(v.replaceAll(',', '.')) ?? 0;
                                onChanged();
                              },
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

