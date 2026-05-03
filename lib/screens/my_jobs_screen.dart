import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../models/job.dart';
import '../providers/job_provider.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/export_service.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import 'employee_job_request_screen.dart';
import 'job_card_screen.dart';

class MyJobsScreen extends StatefulWidget {
  final bool embedded;

  const MyJobsScreen({super.key, this.embedded = false});

  @override
  State<MyJobsScreen> createState() => _MyJobsScreenState();
}

class _MyJobsScreenState extends State<MyJobsScreen> {
  static final _dt = DateFormat('MMM d, y');

  Future<void> _exportJobs(List<Job> jobs, ExportFormat format) async {
    final headers = ['Job', 'Status', 'Scheduled'];
    final rows = jobs.map((job) {
      final scheduled = (job.scheduledStart != null || job.scheduledEnd != null)
          ? '${job.scheduledStart != null ? _dt.format(job.scheduledStart!) : '—'} → ${job.scheduledEnd != null ? _dt.format(job.scheduledEnd!) : '—'}'
          : '—';
      return [job.title, _statusLabel(job.status), scheduled];
    }).toList();
    try {
      await ExportService.exportTable(
        fileBaseName: 'my_jobs_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
        headers: headers,
        rows: rows,
        format: format,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Export completed.');
    } catch (e) {
      AppTelemetry.logError(screen: 'my_jobs_screen', action: 'export_jobs', error: e);
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Export failed.'));
    }
  }

  String _statusLabel(JobStatus status) {
    switch (status) {
      case JobStatus.inProgress:
        return 'In progress';
      case JobStatus.completed:
        return 'Completed';
      case JobStatus.cancelled:
        return 'Cancelled';
      case JobStatus.scheduled:
        return 'Scheduled';
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final timesheet = context.read<TimesheetProvider>();
      context.read<JobProvider>()
        ..setCompanyId(timesheet.currentCompanyId)
        ..setEmployeeId(timesheet.currentEmployee?.id);
      final employeeId = timesheet.currentEmployee?.id;
      if (employeeId != null) {
        await context.read<JobProvider>().loadMyJobs(employeeId);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = Responsive.horizontalPadding(context);
    final isTinyPhone = Responsive.isTinyPhone(context);
    final employee = context.watch<TimesheetProvider>().currentEmployee;
    final body = employee == null
        ? Center(
            child: Text(
              'No employee selected.',
              style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
            ),
          )
        : Consumer<JobProvider>(
            builder: (context, jobsProv, _) {
              if (jobsProv.isLoading && jobsProv.myJobs.isEmpty) {
                return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
              }

              final jobs = jobsProv.myJobs;
              if (jobs.isEmpty) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'No jobs assigned yet.',
                      style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                      textAlign: TextAlign.center,
                    ),
                  ),
                );
              }

              return RefreshIndicator(
                onRefresh: () {
                  final timesheet = context.read<TimesheetProvider>();
                  jobsProv
                    ..setCompanyId(timesheet.currentCompanyId)
                    ..setEmployeeId(timesheet.currentEmployee?.id);
                  return jobsProv.loadMyJobs(employee.id);
                },
                child: ListView(
                  padding: const EdgeInsets.all(0),
                  children: [
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: DataTable(
                        headingRowColor: WidgetStateProperty.all(const Color(0xFFF9FAFB)),
                        headingTextStyle: GoogleFonts.poppins(
                          color: const Color(0xFF111827),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                        dataTextStyle: GoogleFonts.poppins(color: const Color(0xFF4B5563), fontSize: 12),
                        columnSpacing: 28,
                        dividerThickness: 0.4,
                        columns: const [
                          DataColumn(label: Text('Job')),
                          DataColumn(label: Text('Status')),
                          DataColumn(label: Text('Scheduled')),
                          DataColumn(label: Text('')),
                        ],
                        rows: jobs.map((job) {
                          final scheduled = (job.scheduledStart != null || job.scheduledEnd != null)
                              ? '${job.scheduledStart != null ? _dt.format(job.scheduledStart!) : '—'} → ${job.scheduledEnd != null ? _dt.format(job.scheduledEnd!) : '—'}'
                              : '—';
                          return DataRow(
                            cells: [
                              DataCell(Text(job.title)),
                              DataCell(Text(_statusLabel(job.status))),
                              DataCell(Text(scheduled)),
                              DataCell(
                                IconButton(
                                  tooltip: 'Open',
                                  icon: const Icon(Icons.chevron_right, color: AppTheme.gold),
                                  onPressed: () => Navigator.of(context).push(
                                    MaterialPageRoute(builder: (_) => JobCardScreen(job: job)),
                                  ),
                                ),
                              ),
                            ],
                          );
                        }).toList(),
                      ),
                    ),
                  ],
                ),
              );
            },
          );


    if (widget.embedded) {
      return Padding(
        padding: EdgeInsets.all(horizontalPadding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 4, right: 4, bottom: 12),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    'Jobs',
                    style: GoogleFonts.poppins(
                      color: const Color(0xFF111827),
                      fontSize: isTinyPhone ? 18 : 20,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Consumer<JobProvider>(
                    builder: (context, jobsProv, _) => PopupMenuButton<ExportFormat>(
                      onSelected: (f) => _exportJobs(jobsProv.myJobs, f),
                      itemBuilder: (context) => const [
                        PopupMenuItem(value: ExportFormat.csv, child: Text('Export CSV')),
                        PopupMenuItem(value: ExportFormat.excelCsv, child: Text('Export Excel (CSV)')),
                        PopupMenuItem(value: ExportFormat.pdf, child: Text('Export PDF')),
                      ],
                      child: Container(
                        padding: EdgeInsets.symmetric(horizontal: isTinyPhone ? 10 : 12, vertical: isTinyPhone ? 7 : 8),
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
                                fontSize: isTinyPhone ? 10 : 11,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => const EmployeeJobRequestScreen(),
                      ),
                    ),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppTheme.gold,
                      side: const BorderSide(color: AppTheme.gold),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                      padding: EdgeInsets.symmetric(horizontal: isTinyPhone ? 10 : 12, vertical: isTinyPhone ? 7 : 8),
                    ),
                    icon: const Icon(Icons.add, size: 16),
                    label: Text(
                      'Add new job',
                      style: GoogleFonts.poppins(
                        fontSize: isTinyPhone ? 10 : 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  Consumer<JobProvider>(
                    builder: (context, jobsProv, _) => Container(
                      padding: EdgeInsets.symmetric(horizontal: isTinyPhone ? 10 : 12, vertical: isTinyPhone ? 7 : 8),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: const Color(0xFFE5E7EB)),
                      ),
                      child: Text(
                        '${jobsProv.myJobs.length} total',
                        style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: isTinyPhone ? 10 : 11),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Card(
                color: Colors.white,
                elevation: 4,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                  side: const BorderSide(color: Color(0xFFE5E7EB)),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: body,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text('Jobs', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppTheme.gold),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Padding(
        padding: EdgeInsets.all(horizontalPadding),
        child: Card(
          color: Colors.white,
          elevation: 4,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: const BorderSide(color: Color(0xFFE5E7EB)),
          ),
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: body,
          ),
        ),
      ),
    );
  }
}
