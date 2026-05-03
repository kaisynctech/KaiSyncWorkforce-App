import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/client.dart';
import '../models/employee.dart';
import '../models/incident_report.dart';
import '../models/job.dart';
import '../models/site.dart';
import '../providers/timesheet_provider.dart';
import '../services/export_service.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';

class HrIncidentDetailsScreen extends StatefulWidget {
  final IncidentReport incident;
  final List<Employee> employees;

  const HrIncidentDetailsScreen({
    super.key,
    required this.incident,
    required this.employees,
  });

  @override
  State<HrIncidentDetailsScreen> createState() => _HrIncidentDetailsScreenState();
}

class _HrIncidentDetailsScreenState extends State<HrIncidentDetailsScreen> {
  Future<void> _exportIncidentPdf({
    required IncidentReport incident,
    required Job? job,
    required Client? client,
    required Site? site,
  }) async {
    final rows = <List<String>>[
      ['Incident ID', incident.id],
      ['Employee ID', incident.employeeId],
      ['Severity', incident.severity ?? '—'],
      ['Created At', DateFormat('yyyy-MM-dd HH:mm').format(incident.createdAt)],
      ['Description', incident.description],
      ['Job', job?.title ?? (incident.jobId ?? '—')],
      ['Client', client?.name ?? '—'],
      ['Site', site?.name ?? site?.address ?? '—'],
      ['Photos', incident.photoUrls.isEmpty ? 'None' : incident.photoUrls.join(' | ')],
    ];
    try {
      await ExportService.exportTable(
        fileBaseName: 'incident_${incident.id}',
        headers: const ['Field', 'Value'],
        rows: rows,
        format: ExportFormat.pdf,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Incident PDF exported.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not export incident PDF.'));
    }
  }

  Future<_IncidentDetailsBundle> _load() async {
    final inc = widget.incident;
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    final job = inc.jobId != null
        ? await SupabaseTimesheetStorage.getJobById(inc.jobId!, companyId: companyId)
        : null;
    final client = job != null
        ? await SupabaseTimesheetStorage.getClientById(job.clientId, companyId: companyId)
        : null;
    final site = inc.siteId != null
        ? await SupabaseTimesheetStorage.getSiteById(inc.siteId!, companyId: companyId)
        : (job?.siteId != null
            ? await SupabaseTimesheetStorage.getSiteById(job!.siteId!, companyId: companyId)
            : null);
    return _IncidentDetailsBundle(job: job, client: client, site: site);
  }

  void _showImage(String url) {
    final u = url.toLowerCase();
    final isImage = u.endsWith('.jpg') ||
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
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.videocam_outlined, size: 40, color: AppTheme.gold),
                  const SizedBox(height: 12),
                  const Text('This attachment is not an image.', textAlign: TextAlign.center),
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
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: InteractiveViewer(
              child: AspectRatio(
                aspectRatio: 1,
                child: Image.network(
                  url,
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => const Center(child: Text('Failed to load image')),
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
    final inc = widget.incident;
    final employeeById = {for (final e in widget.employees) e.id: e};
    final employeeName = employeeById[inc.employeeId]?.fullName ?? 'Employee ${inc.employeeId}';

    final severityColor = switch ((inc.severity ?? '').toLowerCase()) {
      'high' => const Color(0xFFDC2626),
      'medium' => const Color(0xFFB45309),
      'low' => const Color(0xFF2563EB),
      _ => const Color(0xFF6B7280),
    };

    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
        title: Text('Incident details', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
      ),
      body: FutureBuilder<_IncidentDetailsBundle>(
        future: _load(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return LoadErrorPanel(
              message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load incident details.'),
              onRetry: () => setState(() {}),
            );
          }
          if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
            return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
          }
          final bundle = snapshot.data!;
          final job = bundle.job;
          final client = bundle.client;
          final site = bundle.site;
          final assignedNames = (job?.assignedEmployeeIds ?? const <String>[])
              .map((id) => employeeById[id]?.fullName ?? 'Employee $id')
              .toList()
            ..sort();

          final jobStatusColor = switch (job?.status) {
            JobStatus.completed => const Color(0xFF059669),
            JobStatus.inProgress => const Color(0xFF2563EB),
            JobStatus.cancelled => const Color(0xFFDC2626),
            _ => const Color(0xFF6B7280),
          };

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  onPressed: () => _exportIncidentPdf(
                    incident: inc,
                    job: job,
                    client: client,
                    site: site,
                  ),
                  icon: const Icon(Icons.picture_as_pdf_outlined, size: 16),
                  label: const Text('Export PDF'),
                ),
              ),
              const SizedBox(height: 8),
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
                              employeeName,
                              style: GoogleFonts.poppins(
                                color: const Color(0xFF111827),
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: severityColor.withValues(alpha: 0.10 * 255),
                              borderRadius: BorderRadius.circular(999),
                              border: Border.all(color: severityColor.withValues(alpha: 0.25 * 255)),
                            ),
                            child: Text(
                              inc.severity ?? '—',
                              style: GoogleFonts.poppins(
                                color: severityColor,
                                fontWeight: FontWeight.w600,
                                fontSize: 11,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        DateFormat('MMM d, y · h:mm a').format(inc.createdAt),
                        style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                      ),
                      const SizedBox(height: 12),
                      Text('Description', style: GoogleFonts.poppins(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 6),
                      Text(
                        inc.description,
                        style: GoogleFonts.poppins(color: const Color(0xFF374151), fontSize: 12),
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
                            'Linked job',
                            style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF111827),
                            ),
                          ),
                          const Spacer(),
                          if (job != null)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                              decoration: BoxDecoration(
                                color: jobStatusColor.withValues(alpha: 0.10 * 255),
                                borderRadius: BorderRadius.circular(999),
                                border: Border.all(color: jobStatusColor.withValues(alpha: 0.25 * 255)),
                              ),
                              child: Text(
                                job.status.name,
                                style: GoogleFonts.poppins(
                                  color: jobStatusColor,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 11,
                                ),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      _InfoRow(
                        icon: Icons.work_outline,
                        label: 'Job',
                        value: job?.title ?? (inc.jobId != null ? 'Job #${inc.jobId}' : '—'),
                      ),
                      const SizedBox(height: 8),
                      _InfoRow(
                        icon: Icons.people_outline,
                        label: 'Assigned',
                        value: job == null
                            ? '—'
                            : (assignedNames.isEmpty ? 'None' : '${assignedNames.length} employee(s)'),
                      ),
                      if (assignedNames.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: assignedNames
                              .map(
                                (name) => Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFF9FAFB),
                                    borderRadius: BorderRadius.circular(999),
                                    border: Border.all(color: const Color(0xFFE5E7EB)),
                                  ),
                                  child: Text(name, style: GoogleFonts.poppins(fontSize: 12)),
                                ),
                              )
                              .toList(),
                        ),
                      ],
                      const SizedBox(height: 8),
                      _InfoRow(
                        icon: Icons.business_outlined,
                        label: 'Client',
                        value: client?.name ?? (job != null ? 'Client #${job.clientId}' : '—'),
                      ),
                      const SizedBox(height: 8),
                      _InfoRow(
                        icon: Icons.place_outlined,
                        label: 'Site',
                        value: site?.address ?? (job?.siteId != null ? 'Site #${job!.siteId}' : '—'),
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
                          Text('Photos', style: GoogleFonts.poppins(fontWeight: FontWeight.w700, color: const Color(0xFF111827))),
                          const Spacer(),
                          Text('${inc.photoUrls.length}', style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontWeight: FontWeight.w600)),
                        ],
                      ),
                      const SizedBox(height: 10),
                      if (inc.photoUrls.isEmpty)
                        Text('No photos attached.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280)))
                      else
                        SizedBox(
                          height: 92,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: inc.photoUrls.length,
                            separatorBuilder: (_, _) => const SizedBox(width: 10),
                            itemBuilder: (context, idx) {
                              final url = inc.photoUrls[idx];
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
                                        child: const Icon(Icons.broken_image_outlined, color: Color(0xFF9CA3AF)),
                                      ),
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
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
              Text(label, style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11)),
              const SizedBox(height: 2),
              Text(value, style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600, fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }
}

class _IncidentDetailsBundle {
  final Job? job;
  final Client? client;
  final Site? site;

  const _IncidentDetailsBundle({
    required this.job,
    required this.client,
    required this.site,
  });
}

