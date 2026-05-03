import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/client.dart';
import '../models/employee.dart';
import '../models/incident_report.dart';
import '../models/job.dart';
import '../models/job_card.dart';
import '../models/site.dart';
import '../models/inventory_item.dart';
import '../models/inventory_usage.dart';
import '../models/contractor.dart';
import '../providers/timesheet_provider.dart';
import '../strings/workspace_terms.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import '_dashboard_decorators.dart';
import 'hr_simple_thread_chat_screen.dart';

class HrJobDetailsScreen extends StatefulWidget {
  final Job job;
  final List<Employee> employees;

  const HrJobDetailsScreen({
    super.key,
    required this.job,
    required this.employees,
  });

  @override
  State<HrJobDetailsScreen> createState() => _HrJobDetailsScreenState();
}

class _HrJobDetailsScreenState extends State<HrJobDetailsScreen> {
  static final _dt = DateFormat('MMM d, y · h:mm a');

  /// Local mutable job — initialised from widget.job and refreshed after
  /// SLA / lifecycle actions so the UI reflects the latest state.
  late Job _job;
  bool _runningAction = false;

  Future<void> _openJobTeamChat(BuildContext context) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final nav = Navigator.of(context);
    setState(() => _runningAction = true);
    try {
      final tid = await SupabaseTimesheetStorage.ensureJobTeamMessageThread(
        companyId: companyId,
        jobId: _job.id,
      );
      if (!mounted) return;
      if (tid == null) {
        showErrorSnack(context, 'Could not open job chat.');
        return;
      }
      await nav.push<void>(
        MaterialPageRoute<void>(
          builder: (_) => HrSimpleThreadChatScreen(
            companyId: companyId,
            threadId: tid,
            title: _job.title,
            subtitle: 'Job team channel',
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Could not open job chat.'),
      );
    } finally {
      if (mounted) setState(() => _runningAction = false);
    }
  }

  Future<void> _captureClientFeedback(
    Map<String, dynamic>? existingFeedback,
  ) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    int rating = ((existingFeedback?['rating_1_to_5'] as num?)?.toInt() ?? 5)
        .clamp(1, 5);
    final commentsCtrl = TextEditingController(
      text: existingFeedback?['comments']?.toString() ?? '',
    );
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: const Text('Capture client feedback'),
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
                  label: '$rating',
                  onChanged: (v) => setLocal(() => rating = v.round()),
                ),
                TextField(
                  controller: commentsCtrl,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Comments (optional)',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await SupabaseTimesheetStorage.upsertJobFeedback(
        companyId: companyId,
        jobId: _job.id,
        rating: rating,
        comments: commentsCtrl.text.trim(),
        channel: 'hr_verified',
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Client feedback saved.');
      setState(() {});
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Could not save client feedback.'),
      );
    }
  }

  String? _feedbackLinkFromRow(Map<String, dynamic>? feedback) {
    final token = feedback?['request_token']?.toString();
    if (token == null || token.isEmpty) return null;
    return SupabaseTimesheetStorage.buildPublicFeedbackLink(token);
  }

  String _feedbackStatus(Map<String, dynamic>? feedback) {
    if (feedback == null) return 'Missing';
    final rating = (feedback['rating_1_to_5'] as num?)?.toInt();
    if (rating != null && rating >= 1 && rating <= 5) return 'Submitted';
    final token = feedback['request_token']?.toString();
    if (token != null && token.isNotEmpty) return 'Requested';
    return 'Missing';
  }

  Future<String?> _ensureFeedbackLink(Map<String, dynamic>? feedback) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return null;
    final existing = _feedbackLinkFromRow(feedback);
    if (existing != null) return existing;
    final token = await SupabaseTimesheetStorage.createJobFeedbackRequestToken(
      companyId: companyId,
      jobId: _job.id,
    );
    if (token == null) return null;
    return SupabaseTimesheetStorage.buildPublicFeedbackLink(token);
  }

  Future<void> _generateFeedbackRequestLink(
    Map<String, dynamic>? feedback,
  ) async {
    try {
      final link = await _ensureFeedbackLink(feedback);
      if (!mounted || link == null) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Client feedback link'),
          content: SelectableText(
            link,
            style: GoogleFonts.poppins(fontSize: 13),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Could not generate feedback link.'),
      );
    }
  }

  Future<void> _emailFeedbackRequest({
    required Map<String, dynamic>? feedback,
    required Client? client,
  }) async {
    final email = client?.email?.trim() ?? '';
    if (email.isEmpty) {
      showInfoSnack(
        context,
        'Client email is missing. Add it in client profile first.',
      );
      return;
    }
    try {
      final link = await _ensureFeedbackLink(feedback);
      if (link == null) {
        showErrorSnack(context, 'Could not generate feedback request link.');
        return;
      }
      final subject = Uri.encodeComponent('Feedback request: ${_job.title}');
      final body = Uri.encodeComponent(
        'Hi,\n\nPlease share your feedback for completed job "${_job.title}".\n\n$link\n\nThank you.',
      );
      final uri = Uri.parse('mailto:$email?subject=$subject&body=$body');
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!mounted) return;
      if (ok) {
        await SupabaseTimesheetStorage.markFeedbackRequestSent(
          companyId: context.read<TimesheetProvider>().currentCompanyId!,
          jobId: _job.id,
          sentVia: 'email',
        );
        showSuccessSnack(context, 'Email app opened with feedback request.');
        setState(() {});
      } else {
        showErrorSnack(context, 'Could not open email app.');
      }
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Could not prepare feedback email.'),
      );
    }
  }

  @override
  void initState() {
    super.initState();
    _job = widget.job;
  }

  Future<_JobDetailsBundle> _load() async {
    final job = _job;
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    final client = await SupabaseTimesheetStorage.getClientById(
      job.clientId,
      companyId: companyId,
    );
    final site = job.siteId != null
        ? await SupabaseTimesheetStorage.getSiteById(
            job.siteId!,
            companyId: companyId,
          )
        : null;
    final card = await SupabaseTimesheetStorage.getJobCardForJob(
      job.id,
      companyId: companyId,
    );
    final incidents = await SupabaseTimesheetStorage.getIncidentsForJob(
      job.id,
      companyId: companyId,
    );
    final usage = await SupabaseTimesheetStorage.getInventoryUsageForJob(
      job.id,
      companyId: companyId,
    );
    final items = await SupabaseTimesheetStorage.getInventoryItems(
      companyId: companyId,
    );
    final feedback = companyId == null
        ? null
        : await SupabaseTimesheetStorage.getJobFeedback(
            companyId: companyId,
            jobId: job.id,
          );

    // Resolve cross-link references so the panel can render synchronously.
    Map<String, dynamic>? deal;
    Contractor? contractorEntity;
    if (job.dealId != null && companyId != null && client != null) {
      try {
        final allDeals = await SupabaseTimesheetStorage.getClientDeals(
          companyId: companyId,
          clientId: client.id,
        );
        deal = allDeals.firstWhere(
          (d) => d['id']?.toString() == job.dealId,
          orElse: () => <String, dynamic>{},
        );
        if (deal.isEmpty) deal = null;
      } catch (_) {}
    }
    if (job.contractorId != null && companyId != null) {
      contractorEntity = await SupabaseTimesheetStorage.getContractorById(
        companyId: companyId,
        contractorId: job.contractorId!,
      );
    }
    return _JobDetailsBundle(
      client: client,
      site: site,
      card: card,
      incidents: incidents,
      inventoryUsage: usage,
      inventoryItems: items,
      deal: deal,
      feedback: feedback,
      contractorEntity: contractorEntity,
    );
  }

  Future<void> _refreshJob() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    final updated = await SupabaseTimesheetStorage.getJobById(
      _job.id,
      companyId: companyId,
    );
    if (!mounted) return;
    if (updated != null) setState(() => _job = updated);
  }

  Future<void> _markFirstResponse() async {
    if (_runningAction) return;
    setState(() => _runningAction = true);
    try {
      await SupabaseTimesheetStorage.markJobFirstResponse(jobId: _job.id);
      await _refreshJob();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('First response recorded.')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to mark first response: $e')),
      );
    } finally {
      if (mounted) setState(() => _runningAction = false);
    }
  }

  Future<void> _closeJob() async {
    if (_runningAction) return;
    final actualCost = await _promptActualCost();
    if (actualCost == null) return; // user cancelled
    setState(() => _runningAction = true);
    try {
      await SupabaseTimesheetStorage.closeJob(
        jobId: _job.id,
        actualCost: actualCost.isNaN ? null : actualCost,
      );
      // If first_response_at wasn't set, stamp it now (close implies a response).
      if (_job.firstResponseAt == null) {
        await SupabaseTimesheetStorage.markJobFirstResponse(jobId: _job.id);
      }
      await _refreshJob();
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Job closed.')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Failed to close job: $e')));
    } finally {
      if (mounted) setState(() => _runningAction = false);
    }
  }

  Future<void> _editCostBreakdown() async {
    if (_runningAction) return;
    final laborCtrl = TextEditingController(
      text: _job.laborCost != null ? _job.laborCost!.toStringAsFixed(2) : '',
    );
    final otherCtrl = TextEditingController(
      text: _job.otherCost != null ? _job.otherCost!.toStringAsFixed(2) : '',
    );
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit job cost breakdown'),
        content: SizedBox(
          width: 460,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Inventory cost is auto-calculated from recorded inventory usage.',
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  color: const Color(0xFF6B7280),
                ),
              ),
              const SizedBox(height: 12),
              InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Inventory cost (auto)',
                  prefixText: 'R ',
                ),
                child: Text((_job.inventoryCost ?? 0).toStringAsFixed(2)),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: laborCtrl,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Labor cost',
                  prefixText: 'R ',
                ),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: otherCtrl,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Other cost',
                  prefixText: 'R ',
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (ok != true) return;

    double? parseNullableAmount(String raw) {
      final cleaned = raw.trim();
      if (cleaned.isEmpty) return null;
      return double.tryParse(cleaned.replaceAll(',', '.'));
    }

    final labor = parseNullableAmount(laborCtrl.text);
    final other = parseNullableAmount(otherCtrl.text);
    if ((laborCtrl.text.trim().isNotEmpty && labor == null) ||
        (otherCtrl.text.trim().isNotEmpty && other == null)) {
      if (!mounted) return;
      showInfoSnack(context, 'Enter valid numbers for labor/other cost.');
      return;
    }

    final inventory = _job.inventoryCost ?? 0;
    final nextActual = inventory + (labor ?? 0) + (other ?? 0);
    setState(() => _runningAction = true);
    try {
      final companyId = context.read<TimesheetProvider>().currentCompanyId;
      await SupabaseTimesheetStorage.upsertJob(
        _job.copyWith(
          laborCost: labor,
          otherCost: other,
          actualCost: nextActual > 0 ? nextActual : null,
        ),
        companyId: companyId,
      );
      await _refreshJob();
      if (!mounted) return;
      showSuccessSnack(context, 'Cost breakdown updated.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Could not update costs.'),
      );
    } finally {
      if (mounted) setState(() => _runningAction = false);
    }
  }

  Future<void> _captureLaborEntry() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final employees = widget.employees;
    if (employees.isEmpty) {
      showInfoSnack(context, 'No employees available.');
      return;
    }
    final jobCodes = await SupabaseTimesheetStorage.getJobCodes(
      companyId: companyId,
    );
    String employeeId = employees.first.id;
    String? jobCodeId = jobCodes.isEmpty ? null : jobCodes.first.id;
    DateTime workDate = DateTime.now();
    final hoursCtrl = TextEditingController(text: '8');
    final notesCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Capture labor entry'),
          content: SizedBox(
            width: 520,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: employeeId,
                  decoration: const InputDecoration(labelText: 'Employee'),
                  items: employees
                      .map(
                        (e) => DropdownMenuItem(
                          value: e.id,
                          child: Text(e.fullName),
                        ),
                      )
                      .toList(),
                  onChanged: (v) =>
                      setLocal(() => employeeId = v ?? employeeId),
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String?>(
                  initialValue: jobCodeId,
                  decoration: const InputDecoration(
                    labelText: 'Job code (optional)',
                  ),
                  items: [
                    const DropdownMenuItem<String?>(
                      value: null,
                      child: Text('— None —'),
                    ),
                    ...jobCodes.map(
                      (c) => DropdownMenuItem<String?>(
                        value: c.id,
                        child: Text('${c.code} · ${c.title}'),
                      ),
                    ),
                  ],
                  onChanged: (v) => setLocal(() => jobCodeId = v),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: hoursCtrl,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Hours'),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () async {
                    final d = await showDatePicker(
                      context: ctx,
                      initialDate: workDate,
                      firstDate: DateTime.now().subtract(
                        const Duration(days: 365),
                      ),
                      lastDate: DateTime.now().add(const Duration(days: 30)),
                    );
                    if (d == null) return;
                    setLocal(() => workDate = DateTime(d.year, d.month, d.day));
                  },
                  icon: const Icon(Icons.event_outlined, size: 16),
                  label: Text(
                    'Work date: ${DateFormat('dd MMM yyyy').format(workDate)}',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: notesCtrl,
                  minLines: 2,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Notes (optional)',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    final hours = double.tryParse(hoursCtrl.text.trim().replaceAll(',', '.'));
    if (hours == null || hours <= 0) {
      showInfoSnack(context, 'Enter valid hours greater than 0.');
      return;
    }
    final employee = employees.firstWhere((e) => e.id == employeeId);
    try {
      await SupabaseTimesheetStorage.addLaborEntry(
        companyId: companyId,
        employeeId: employeeId,
        jobId: _job.id,
        jobCodeId: jobCodeId,
        workDate: workDate,
        hours: hours,
        hourlyRate: employee.hourlyRate > 0 ? employee.hourlyRate : null,
        notes: notesCtrl.text,
      );
      await _refreshJob();
      if (!mounted) return;
      showSuccessSnack(context, 'Labor entry captured.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(
        context,
        friendlyErrorMessage(e, fallback: 'Could not save labor entry.'),
      );
    }
  }

  Future<void> _viewLaborEntries() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    final entries = await SupabaseTimesheetStorage.getLaborEntriesForJob(
      companyId: companyId,
      jobId: _job.id,
    );
    final byEmployee = {for (final e in widget.employees) e.id: e};
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Labor entries'),
        content: SizedBox(
          width: 640,
          child: entries.isEmpty
              ? const Text('No labor entries captured yet.')
              : ListView.separated(
                  shrinkWrap: true,
                  itemCount: entries.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, i) {
                    final l = entries[i];
                    final emp = byEmployee[l.employeeId];
                    return ListTile(
                      dense: true,
                      title: Text(
                        '${emp?.fullName ?? 'Employee #${l.employeeId}'} · ${l.hours.toStringAsFixed(2)}h',
                      ),
                      subtitle: Text(
                        '${DateFormat('dd MMM yyyy').format(l.workDate)}${(l.notes ?? '').trim().isNotEmpty ? ' · ${l.notes!.trim()}' : ''}',
                      ),
                      trailing: Text(
                        l.hourlyRate == null
                            ? '-'
                            : 'R ${(l.hourlyRate! * l.hours).toStringAsFixed(2)}',
                        style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                      ),
                    );
                  },
                ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  /// Returns NaN when the user enters no value (skip cost recording),
  /// a parsed double when supplied, or null when cancelled.
  Future<double?> _promptActualCost() async {
    final ctrl = TextEditingController(
      text:
          _job.actualCost?.toStringAsFixed(2) ??
          _job.estimatedCost?.toStringAsFixed(2) ??
          '',
    );
    return showDialog<double?>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Close job'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Record the final actual cost for this job. Leave blank to skip.',
              style: TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: ctrl,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Actual cost',
                prefixText: 'R ',
              ),
              autofocus: true,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(null),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              final raw = ctrl.text.trim();
              if (raw.isEmpty) {
                Navigator.of(context).pop(double.nan); // close without cost
                return;
              }
              final v = double.tryParse(raw);
              if (v == null) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Enter a valid number or leave blank.'),
                  ),
                );
                return;
              }
              Navigator.of(context).pop(v);
            },
            child: const Text('Close job'),
          ),
        ],
      ),
    );
  }

  void _showImage(String url) {
    final u = url.toLowerCase();
    final isImage =
        u.endsWith('.jpg') ||
        u.endsWith('.jpeg') ||
        u.endsWith('.png') ||
        u.endsWith('.gif') ||
        u.endsWith('.webp');

    if (!isImage) {
      showDialog<void>(
        context: context,
        builder: (_) {
          return Dialog(
            insetPadding: const EdgeInsets.all(16),
            backgroundColor: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(18),
            ),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.videocam_outlined,
                    size: 40,
                    color: AppTheme.gold,
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'This attachment is not an image.',
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          );
        },
      );
      return;
    }

    showDialog<void>(
      context: context,
      builder: (_) {
        return Dialog(
          insetPadding: const EdgeInsets.all(16),
          backgroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: InteractiveViewer(
              child: AspectRatio(
                aspectRatio: 1,
                child: Image.network(
                  url,
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) =>
                      const Center(child: Text('Failed to load image')),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final job = _job;
    final employeeById = {for (final e in widget.employees) e.id: e};
    final assigned =
        job.assignedEmployeeIds
            .map((id) => employeeById[id]?.fullName ?? 'Employee $id')
            .toList()
          ..sort();

    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
        title: Text(
          'Job details',
          style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
        actions: [
          IconButton(
            tooltip: 'Job team chat',
            icon: const Icon(Icons.forum_outlined),
            onPressed: _runningAction ? null : () => _openJobTeamChat(context),
          ),
        ],
      ),
      body: FutureBuilder<_JobDetailsBundle>(
        future: _load(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return LoadErrorPanel(
              message: friendlyErrorMessage(
                snapshot.error,
                fallback: 'Could not load job details.',
              ),
              onRetry: () => setState(() {}),
            );
          }
          if (snapshot.connectionState == ConnectionState.waiting &&
              !snapshot.hasData) {
            return const PremiumLoadingIndicator(
              label: 'Loading job details...',
            );
          }
          final bundle = snapshot.data!;
          final client = bundle.client;
          final site = bundle.site;
          final card = bundle.card;
          final incidents = bundle.incidents;
          final deal = bundle.deal;
          final contractorEntity = bundle.contractorEntity;
          final inventoryUsage = bundle.inventoryUsage;
          final inventoryById = {
            for (final it in bundle.inventoryItems) it.id: it,
          };
          final feedback = bundle.feedback;
          final feedbackLink = _feedbackLinkFromRow(feedback);
          final requestedAt = DateTime.tryParse(
            feedback?['requested_at']?.toString() ?? '',
          );
          final expiresAt = DateTime.tryParse(
            feedback?['request_token_expires_at']?.toString() ?? '',
          );
          final sentCount =
              (feedback?['request_send_count'] as num?)?.toInt() ?? 0;
          final openCount =
              (feedback?['request_open_count'] as num?)?.toInt() ?? 0;
          final status = _feedbackStatus(feedback);
          final usedByItem = <String, double>{};
          for (final u in inventoryUsage) {
            usedByItem[u.inventoryItemId] =
                (usedByItem[u.inventoryItemId] ?? 0) + u.quantity;
          }
          final usedEntries = usedByItem.entries.toList()
            ..sort((a, b) {
              final an = inventoryById[a.key]?.name ?? a.key;
              final bn = inventoryById[b.key]?.name ?? b.key;
              return an.compareTo(bn);
            });

          final statusColor = switch (job.status) {
            JobStatus.completed => const Color(0xFF059669),
            JobStatus.inProgress => const Color(0xFF2563EB),
            JobStatus.cancelled => const Color(0xFFDC2626),
            _ => const Color(0xFF6B7280),
          };

          return ListView(
            padding: const EdgeInsets.all(16),
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
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              job.title,
                              style: GoogleFonts.poppins(
                                color: const Color(0xFF111827),
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          if (job.priority != JobPriority.none) ...[
                            _PriorityChip(priority: job.priority),
                            const SizedBox(width: 6),
                          ],
                          if ((job.externalRef ?? '').startsWith(
                            'pm_sched:',
                          )) ...[
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 6,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0xFFDCFCE7),
                                borderRadius: BorderRadius.circular(999),
                                border: Border.all(
                                  color: const Color(0xFF86EFAC),
                                ),
                              ),
                              child: Text(
                                'PM generated',
                                style: GoogleFonts.poppins(
                                  color: const Color(0xFF166534),
                                  fontWeight: FontWeight.w600,
                                  fontSize: 11,
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                          ],
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: statusColor.withValues(alpha: 0.10 * 255),
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(
                                color: statusColor.withValues(
                                  alpha: 0.25 * 255,
                                ),
                              ),
                            ),
                            child: Text(
                              job.status.name,
                              style: GoogleFonts.poppins(
                                color: statusColor,
                                fontWeight: FontWeight.w600,
                                fontSize: 11,
                              ),
                            ),
                          ),
                        ],
                      ),
                      if (job.description != null &&
                          job.description!.trim().isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(
                          job.description!,
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF4B5563),
                            fontSize: 12,
                          ),
                        ),
                      ],
                      const SizedBox(height: 14),
                      _InfoRow(
                        label: 'Client',
                        value: client?.name ?? 'Client #${job.clientId}',
                        icon: Icons.business_outlined,
                      ),
                      const SizedBox(height: 8),
                      _InfoRow(
                        label: 'Site',
                        value:
                            site?.address ??
                            (job.siteId != null ? 'Site #${job.siteId}' : '—'),
                        icon: Icons.place_outlined,
                      ),
                      const SizedBox(height: 8),
                      _InfoRow(
                        label: 'Schedule',
                        value:
                            (job.scheduledStart != null ||
                                job.scheduledEnd != null)
                            ? '${job.scheduledStart != null ? _dt.format(job.scheduledStart!) : '—'}  →  ${job.scheduledEnd != null ? _dt.format(job.scheduledEnd!) : '—'}'
                            : '—',
                        icon: Icons.schedule_outlined,
                      ),
                      if (job.openedAt != null) ...[
                        const SizedBox(height: 8),
                        _InfoRow(
                          label: 'Opened',
                          value: _dt.format(job.openedAt!),
                          icon: Icons.flag_outlined,
                        ),
                      ],
                      if (job.firstResponseAt != null) ...[
                        const SizedBox(height: 8),
                        _InfoRow(
                          label: 'First response',
                          value: _dt.format(job.firstResponseAt!),
                          icon: Icons.bolt_outlined,
                        ),
                      ],
                      if (job.closedAt != null) ...[
                        const SizedBox(height: 8),
                        _InfoRow(
                          label: 'Closed',
                          value: _dt.format(job.closedAt!),
                          icon: Icons.check_circle_outline,
                        ),
                      ],
                      if (job.estimatedCost != null ||
                          job.actualCost != null ||
                          job.inventoryCost != null ||
                          job.laborCost != null ||
                          job.otherCost != null) ...[
                        const SizedBox(height: 8),
                        _InfoRow(
                          label: 'Cost (est. / actual)',
                          value: _formatCostPair(
                            job.estimatedCost,
                            job.actualCost,
                          ),
                          icon: Icons.payments_outlined,
                        ),
                        const SizedBox(height: 8),
                        _InfoRow(
                          label: 'Cost breakdown',
                          value:
                              'Inv R ${(job.inventoryCost ?? 0).toStringAsFixed(2)} · Labor R ${(job.laborCost ?? 0).toStringAsFixed(2)} · Other R ${(job.otherCost ?? 0).toStringAsFixed(2)}',
                          icon: Icons.account_balance_wallet_outlined,
                        ),
                        const SizedBox(height: 8),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              OutlinedButton.icon(
                                onPressed: _runningAction
                                    ? null
                                    : _editCostBreakdown,
                                icon: const Icon(Icons.tune_outlined, size: 16),
                                label: const Text('Edit labor/other costs'),
                              ),
                              OutlinedButton.icon(
                                onPressed: _runningAction
                                    ? null
                                    : _captureLaborEntry,
                                icon: const Icon(
                                  Icons.playlist_add_check_outlined,
                                  size: 16,
                                ),
                                label: const Text('Capture labor entry'),
                              ),
                              OutlinedButton.icon(
                                onPressed: _viewLaborEntries,
                                icon: const Icon(
                                  Icons.history_toggle_off_outlined,
                                  size: 16,
                                ),
                                label: const Text('View entries'),
                              ),
                            ],
                          ),
                        ),
                      ],
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _MiniMetric(
                            label: 'Assigned',
                            value: '${job.assignedEmployeeIds.length}',
                          ),
                          _MiniMetric(
                            label: 'Incidents',
                            value: '${incidents.length}',
                          ),
                          _MiniMetric(
                            label: 'Photos',
                            value: '${card?.photoUrls.length ?? 0}',
                          ),
                        ],
                      ),
                      // SLA / lifecycle actions — only render when there's
                      // something the user can do given the current state.
                      if (job.status != JobStatus.completed &&
                          job.status != JobStatus.cancelled) ...[
                        const SizedBox(height: 14),
                        const Divider(height: 1, color: Color(0xFFE5E7EB)),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            if (job.firstResponseAt == null)
                              FilledButton.tonalIcon(
                                onPressed: _runningAction
                                    ? null
                                    : _markFirstResponse,
                                icon: const Icon(Icons.bolt_outlined, size: 16),
                                label: const Text('Mark first response'),
                              ),
                            FilledButton.icon(
                              onPressed: _runningAction ? null : _closeJob,
                              icon: const Icon(
                                Icons.check_circle_outline,
                                size: 16,
                              ),
                              label: const Text('Close job…'),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              _ReferencesCard(
                job: job,
                client: client,
                site: site,
                deal: deal,
                contractorEntity: contractorEntity,
                employees: widget.employees,
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
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'Client feedback',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF111827),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const Spacer(),
                          OutlinedButton.icon(
                            onPressed: () => _captureClientFeedback(feedback),
                            icon: const Icon(
                              Icons.star_rate_outlined,
                              size: 16,
                            ),
                            label: Text(
                              feedback == null
                                  ? 'Request feedback'
                                  : 'Update feedback',
                            ),
                          ),
                          const SizedBox(width: 8),
                          OutlinedButton.icon(
                            onPressed: _job.status == JobStatus.completed
                                ? () => _generateFeedbackRequestLink(feedback)
                                : null,
                            icon: const Icon(Icons.link_outlined, size: 16),
                            label: const Text('Generate link'),
                          ),
                          const SizedBox(width: 8),
                          OutlinedButton.icon(
                            onPressed: _job.status == JobStatus.completed
                                ? () => _emailFeedbackRequest(
                                    feedback: feedback,
                                    client: client,
                                  )
                                : null,
                            icon: const Icon(Icons.email_outlined, size: 16),
                            label: const Text('Resend email'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _MiniMetric(label: 'Status', value: status),
                          if (requestedAt != null)
                            _MiniMetric(
                              label: 'Requested',
                              value: DateFormat(
                                'MMM d, h:mm a',
                              ).format(requestedAt),
                            ),
                          if (expiresAt != null)
                            _MiniMetric(
                              label: 'Expires',
                              value: DateFormat(
                                'MMM d, h:mm a',
                              ).format(expiresAt),
                            ),
                          _MiniMetric(label: 'Sent', value: '$sentCount'),
                          _MiniMetric(label: 'Opened', value: '$openCount'),
                        ],
                      ),
                      if (feedbackLink != null) ...[
                        const SizedBox(height: 8),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF9FAFB),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFFE5E7EB)),
                          ),
                          child: SelectableText(
                            feedbackLink,
                            style: GoogleFonts.poppins(
                              fontSize: 11,
                              color: const Color(0xFF374151),
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Align(
                          alignment: Alignment.centerRight,
                          child: OutlinedButton.icon(
                            onPressed: () async {
                              await Clipboard.setData(
                                ClipboardData(text: feedbackLink),
                              );
                              final companyId = context
                                  .read<TimesheetProvider>()
                                  .currentCompanyId;
                              if (companyId != null) {
                                await SupabaseTimesheetStorage.markFeedbackRequestSent(
                                  companyId: companyId,
                                  jobId: _job.id,
                                  sentVia: 'link_copy',
                                );
                              }
                              if (!mounted) return;
                              showSuccessSnack(
                                context,
                                'Feedback link copied.',
                              );
                            },
                            icon: const Icon(Icons.copy_outlined, size: 16),
                            label: const Text('Copy link'),
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      if (feedback == null)
                        Text(
                          'No feedback captured yet. Capture a verified client rating after completion.',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280),
                            fontSize: 12,
                          ),
                        )
                      else ...[
                        Text(
                          'Rating: ${(feedback['rating_1_to_5'] ?? '—')} / 5',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF111827),
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          (feedback['comments']?.toString().trim().isNotEmpty ==
                                  true)
                              ? feedback['comments'].toString()
                              : 'No written feedback.',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF4B5563),
                            fontSize: 12,
                          ),
                        ),
                      ],
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
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'Inventory used',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF111827),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            '${usedEntries.length}',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF6B7280),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      if (usedEntries.isEmpty)
                        Text(
                          'No inventory recorded for this job.',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280),
                          ),
                        )
                      else
                        ...usedEntries.map((e) {
                          final item = inventoryById[e.key];
                          final name = item?.name ?? 'Item #${e.key}';
                          final unit = item?.unit;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF9FAFB),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: const Color(0xFFE5E7EB),
                                ),
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      name,
                                      style: GoogleFonts.poppins(
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                  Text(
                                    '${e.value.toStringAsFixed(e.value % 1 == 0 ? 0 : 2)}${unit != null ? ' $unit' : ''}',
                                    style: GoogleFonts.poppins(
                                      color: const Color(0xFF111827),
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
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
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Assigned employees',
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF111827),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 10),
                      if (assigned.isEmpty)
                        Text(
                          'No employees assigned.',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280),
                          ),
                        )
                      else
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: assigned
                              .map(
                                (name) => Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 8,
                                  ),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFF9FAFB),
                                    borderRadius: BorderRadius.circular(999),
                                    border: Border.all(
                                      color: const Color(0xFFE5E7EB),
                                    ),
                                  ),
                                  child: Text(
                                    name,
                                    style: GoogleFonts.poppins(fontSize: 12),
                                  ),
                                ),
                              )
                              .toList(),
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
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'Job card',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF111827),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            card == null ? 'Not submitted' : 'Submitted',
                            style: GoogleFonts.poppins(
                              color: card == null
                                  ? const Color(0xFF6B7280)
                                  : const Color(0xFF059669),
                              fontWeight: FontWeight.w600,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      if (card == null)
                        Text(
                          'No job card details yet.',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280),
                          ),
                        )
                      else ...[
                        _InfoRow(
                          label: 'Actual time',
                          value:
                              (card.actualStart != null ||
                                  card.actualEnd != null)
                              ? '${card.actualStart != null ? _dt.format(card.actualStart!) : '—'}  →  ${card.actualEnd != null ? _dt.format(card.actualEnd!) : '—'}'
                              : '—',
                          icon: Icons.timer_outlined,
                        ),
                        const SizedBox(height: 8),
                        if ((card.workPerformed ?? '').trim().isNotEmpty) ...[
                          Text(
                            'Work performed',
                            style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            card.workPerformed!,
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF4B5563),
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(height: 10),
                        ],
                        if ((card.materialsUsed ?? '').trim().isNotEmpty) ...[
                          Text(
                            'Materials used',
                            style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            card.materialsUsed!,
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF4B5563),
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(height: 10),
                        ],
                        if ((card.notes ?? '').trim().isNotEmpty) ...[
                          Text(
                            'Notes',
                            style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            card.notes!,
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF4B5563),
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(height: 10),
                        ],
                        if (card.photoUrls.isNotEmpty) ...[
                          Text(
                            'Photos',
                            style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 8),
                          SizedBox(
                            height: 86,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: card.photoUrls.length,
                              separatorBuilder: (_, _) =>
                                  const SizedBox(width: 10),
                              itemBuilder: (context, idx) {
                                final url = card.photoUrls[idx];
                                return InkWell(
                                  onTap: () => _showImage(url),
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(14),
                                    child: AspectRatio(
                                      aspectRatio: 1,
                                      child: Image.network(
                                        url,
                                        fit: BoxFit.cover,
                                        errorBuilder: (_, _, _) => Container(
                                          color: const Color(0xFFF3F4F6),
                                          alignment: Alignment.center,
                                          child: const Icon(
                                            Icons.broken_image_outlined,
                                            color: Color(0xFF9CA3AF),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
                          const SizedBox(height: 12),
                        ],
                        if (card.customerSignatureUrl != null &&
                            card.customerSignatureUrl!.trim().isNotEmpty) ...[
                          Text(
                            'Customer signature',
                            style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 8),
                          InkWell(
                            onTap: () => _showImage(card.customerSignatureUrl!),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(14),
                              child: Container(
                                height: 160,
                                color: const Color(0xFFF9FAFB),
                                child: Image.network(
                                  card.customerSignatureUrl!,
                                  fit: BoxFit.contain,
                                  errorBuilder: (_, _, _) => const Center(
                                    child: Text('Failed to load signature'),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ],
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
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'Incidents',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF111827),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            '${incidents.length}',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF6B7280),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      if (incidents.isEmpty)
                        Text(
                          'No incidents reported for this job.',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF6B7280),
                          ),
                        )
                      else
                        ...incidents.map((inc) {
                          final reporter =
                              employeeById[inc.employeeId]?.fullName ??
                              'Employee ${inc.employeeId}';
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF9FAFB),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: const Color(0xFFE5E7EB),
                                ),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          reporter,
                                          style: GoogleFonts.poppins(
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                      Text(
                                        inc.severity ?? '—',
                                        style: GoogleFonts.poppins(
                                          color: const Color(0xFF6B7280),
                                          fontWeight: FontWeight.w600,
                                          fontSize: 11,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    DateFormat(
                                      'MMM d, y · h:mm a',
                                    ).format(inc.createdAt),
                                    style: GoogleFonts.poppins(
                                      color: const Color(0xFF9CA3AF),
                                      fontSize: 11,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  Text(
                                    inc.description,
                                    style: GoogleFonts.poppins(
                                      color: const Color(0xFF374151),
                                      fontSize: 12,
                                    ),
                                  ),
                                  if (inc.photoUrls.isNotEmpty) ...[
                                    const SizedBox(height: 10),
                                    SizedBox(
                                      height: 74,
                                      child: ListView.separated(
                                        scrollDirection: Axis.horizontal,
                                        itemCount: inc.photoUrls.length,
                                        separatorBuilder: (_, _) =>
                                            const SizedBox(width: 8),
                                        itemBuilder: (context, idx) {
                                          final url = inc.photoUrls[idx];
                                          return InkWell(
                                            onTap: () => _showImage(url),
                                            child: ClipRRect(
                                              borderRadius:
                                                  BorderRadius.circular(12),
                                              child: AspectRatio(
                                                aspectRatio: 1,
                                                child: Image.network(
                                                  url,
                                                  fit: BoxFit.cover,
                                                  errorBuilder: (_, _, _) =>
                                                      Container(
                                                        color: const Color(
                                                          0xFFF3F4F6,
                                                        ),
                                                        alignment:
                                                            Alignment.center,
                                                        child: const Icon(
                                                          Icons
                                                              .broken_image_outlined,
                                                          color: Color(
                                                            0xFF9CA3AF,
                                                          ),
                                                        ),
                                                      ),
                                                ),
                                              ),
                                            ),
                                          );
                                        },
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          );
                        }),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 20),
            ],
          );
        },
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;

  const _InfoRow({
    required this.label,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: AppTheme.gold.withValues(alpha: 0.12 * 255),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, size: 18, color: AppTheme.gold),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: GoogleFonts.poppins(
                  color: const Color(0xFF6B7280),
                  fontSize: 11,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: GoogleFonts.poppins(
                  color: const Color(0xFF111827),
                  fontWeight: FontWeight.w600,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// "References" card — at-a-glance chain of every entity this job
/// touches: deal, client, site, unit, assignee, contractor, reporter.
/// Renders nothing for missing references so non-property-management
/// jobs stay visually quiet.
class _ReferencesCard extends StatelessWidget {
  final Job job;
  final Client? client;
  final Site? site;
  final Map<String, dynamic>? deal;
  final Contractor? contractorEntity;
  final List<Employee> employees;

  const _ReferencesCard({
    required this.job,
    required this.client,
    required this.site,
    required this.deal,
    required this.contractorEntity,
    required this.employees,
  });

  @override
  Widget build(BuildContext context) {
    Employee? findById(String? id) {
      if (id == null) return null;
      for (final e in employees) {
        if (e.id == id) return e;
      }
      return null;
    }

    final assignee = findById(job.assigneeEmployeeId);
    final contractor = findById(job.contractorEmployeeId);

    final rows = <_RefRow>[
      if (deal != null)
        _RefRow(
          icon: Icons.handshake_outlined,
          label: WorkspaceTerms.project,
          value:
              '${deal!['title'] ?? WorkspaceTerms.untitledProject}'
              '${(deal!['offer_amount'] as num?) != null ? ' · R ${(deal!['offer_amount'] as num).toStringAsFixed(2)}' : ''}',
        ),
      if (client != null)
        _RefRow(
          icon: Icons.business_outlined,
          label: 'Client',
          value: client!.name,
        ),
      if (site != null)
        _RefRow(
          icon: Icons.place_outlined,
          label: 'Site',
          value:
              site!.name +
              (site!.address != null && site!.address!.isNotEmpty
                  ? ' · ${site!.address}'
                  : ''),
        ),
      if (job.unitId != null)
        _RefRow(
          icon: Icons.apartment_outlined,
          label: 'Unit',
          value: 'Unit #${job.unitId}',
        ),
      if (assignee != null)
        _RefRow(
          icon: Icons.person_outline,
          label: 'Assignee',
          value: assignee.fullName,
        ),
      if (contractor != null)
        _RefRow(
          icon: Icons.engineering_outlined,
          label: 'Contractor member',
          value: contractor.fullName,
        ),
      if (contractorEntity != null)
        _RefRow(
          icon: contractorEntity!.contractorType == 'company'
              ? Icons.apartment_outlined
              : Icons.badge_outlined,
          label: 'Contractor entity',
          value: contractorEntity!.displayName,
        ),
      if (job.reporterResidentId != null)
        _RefRow(
          icon: Icons.record_voice_over_outlined,
          label: 'Reporter',
          value: 'Resident #${job.reporterResidentId}',
        ),
      if (job.externalRef != null && job.externalRef!.isNotEmpty)
        _RefRow(
          icon: Icons.link_outlined,
          label: 'External ref',
          value: job.externalRef!,
        ),
      if ((job.externalRef ?? '').startsWith('pm_sched:'))
        _RefRow(
          icon: Icons.event_repeat_outlined,
          label: 'PM source',
          value: 'Auto-generated from inspection schedule',
        ),
    ];

    if (rows.isEmpty) return const SizedBox.shrink();

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
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'References',
              style: GoogleFonts.poppins(
                color: const Color(0xFF111827),
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            ...rows.map(
              (r) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(r.icon, size: 16, color: const Color(0xFF6B7280)),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 96,
                      child: Text(
                        r.label,
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF6B7280),
                          fontSize: 11,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        r.value,
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF111827),
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
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
    );
  }
}

class _RefRow {
  final IconData icon;
  final String label;
  final String value;

  const _RefRow({required this.icon, required this.label, required this.value});
}

String _formatCostPair(double? estimated, double? actual) {
  String fmt(double? v) => v == null ? '—' : 'R ${v.toStringAsFixed(2)}';
  if (estimated == null && actual == null) return '—';
  if (estimated != null && actual != null) {
    final variance = actual - estimated;
    final sign = variance >= 0 ? '+' : '';
    return '${fmt(estimated)} / ${fmt(actual)} ($sign${variance.toStringAsFixed(2)})';
  }
  return '${fmt(estimated)} / ${fmt(actual)}';
}

class _PriorityChip extends StatelessWidget {
  final JobPriority priority;

  const _PriorityChip({required this.priority});

  @override
  Widget build(BuildContext context) {
    final color = switch (priority) {
      JobPriority.critical => const Color(0xFFDC2626),
      JobPriority.high => const Color(0xFFF59E0B),
      JobPriority.medium => const Color(0xFF2563EB),
      JobPriority.low => const Color(0xFF6B7280),
      JobPriority.none => const Color(0xFF9CA3AF),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10 * 255),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.25 * 255)),
      ),
      child: Text(
        priority.label,
        style: GoogleFonts.poppins(
          color: color,
          fontWeight: FontWeight.w600,
          fontSize: 11,
        ),
      ),
    );
  }
}

class _MiniMetric extends StatelessWidget {
  final String label;
  final String value;

  const _MiniMetric({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: GoogleFonts.poppins(
              color: const Color(0xFF6B7280),
              fontSize: 10,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: GoogleFonts.poppins(
              color: const Color(0xFF111827),
              fontWeight: FontWeight.w700,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }
}

class _JobDetailsBundle {
  final Client? client;
  final Site? site;
  final JobCard? card;
  final List<IncidentReport> incidents;
  final List<InventoryUsage> inventoryUsage;
  final List<InventoryItem> inventoryItems;
  final Map<String, dynamic>? deal;
  final Map<String, dynamic>? feedback;
  final Contractor? contractorEntity;

  const _JobDetailsBundle({
    required this.client,
    required this.site,
    required this.card,
    required this.incidents,
    required this.inventoryUsage,
    required this.inventoryItems,
    this.deal,
    this.feedback,
    this.contractorEntity,
  });
}
