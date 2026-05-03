import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/incident_report.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/export_service.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import 'incident_report_screen.dart';

class MyIncidentsScreen extends StatelessWidget {
  const MyIncidentsScreen({super.key});

  Future<void> _exportIncidents(
    BuildContext context,
    List<IncidentReport> incidents,
    ExportFormat format,
  ) async {
    final headers = ['Date', 'Severity', 'Description', 'Photos'];
    final rows = incidents.map((inc) {
      return [
        DateFormat('yyyy-MM-dd HH:mm').format(inc.createdAt),
        inc.severity ?? '—',
        inc.description,
        inc.photoUrls.length.toString(),
      ];
    }).toList();
    try {
      await ExportService.exportTable(
        fileBaseName: 'my_incidents_${DateFormat('yyyy_MM_dd').format(DateTime.now())}',
        headers: headers,
        rows: rows,
        format: format,
      );
      if (!context.mounted) return;
      showSuccessSnack(context, 'Export completed.');
    } catch (e) {
      AppTelemetry.logError(screen: 'my_incidents_screen', action: 'export_incidents', error: e);
      if (!context.mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Export failed.'));
    }
  }

  void _showImage(BuildContext context, String url) {
    final u = url.toLowerCase();
    final isImage = u.endsWith('.jpg') ||
        u.endsWith('.jpeg') ||
        u.endsWith('.png') ||
        u.endsWith('.gif') ||
        u.endsWith('.webp');

    if (!isImage) {
      showDialog<void>(
        context: context,
        builder: (_) => Dialog(
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
                const Text('This attachment is not an image.'),
              ],
            ),
          ),
        ),
      );
      return;
    }

    showDialog<void>(
      context: context,
      builder: (_) => Dialog(
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
      ),
    );
  }

  void _showIncidentDetails(BuildContext context, IncidentReport inc) {
    showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text('Incident', style: GoogleFonts.poppins(fontWeight: FontWeight.w700)),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                DateFormat('MMM d, y · h:mm a').format(inc.createdAt),
                style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
              ),
              const SizedBox(height: 8),
              Text(
                'Severity: ${inc.severity ?? '—'}',
                style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 10),
              Text(inc.description, style: GoogleFonts.poppins(color: const Color(0xFF374151), fontSize: 12)),
              if (inc.photoUrls.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text('Photos', style: GoogleFonts.poppins(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                SizedBox(
                  height: 74,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: inc.photoUrls.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 8),
                    itemBuilder: (context, idx) {
                      final url = inc.photoUrls[idx];
                      return InkWell(
                        onTap: () => _showImage(context, url),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(12),
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
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text('Close', style: GoogleFonts.poppins(color: AppTheme.gold, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final horizontalPadding = Responsive.horizontalPadding(context);
    final isTinyPhone = Responsive.isTinyPhone(context);
    final empId = context.watch<TimesheetProvider>().currentEmployee?.id;
    if (empId == null) {
      return Center(
        child: Text('No employee selected.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280))),
      );
    }

    return FutureBuilder<List<IncidentReport>>(
      future: SupabaseTimesheetStorage.getIncidentsForEmployee(
        empId,
        companyId: context.read<TimesheetProvider>().currentCompanyId,
      ),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load incidents.'),
            onRetry: () => (context as Element).markNeedsBuild(),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
        }
        final incidents = snapshot.data!;
        incidents.sort((a, b) => b.createdAt.compareTo(a.createdAt));
        return ListView(
          padding: EdgeInsets.all(horizontalPadding),
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 4, right: 4, bottom: 12),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    'Incidents',
                    style: GoogleFonts.poppins(
                      color: const Color(0xFF111827),
                      fontSize: isTinyPhone ? 18 : 20,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const IncidentReportScreen()),
                    ),
                    icon: const Icon(Icons.add, size: 16, color: AppTheme.gold),
                    label: Text(
                      'Add incident',
                      style: GoogleFonts.poppins(
                        color: AppTheme.gold,
                        fontSize: isTinyPhone ? 10 : 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppTheme.gold),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
                      padding: EdgeInsets.symmetric(horizontal: isTinyPhone ? 10 : 12, vertical: isTinyPhone ? 7 : 8),
                    ),
                  ),
                  PopupMenuButton<ExportFormat>(
                    onSelected: (f) => _exportIncidents(context, incidents, f),
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
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: isTinyPhone ? 10 : 12, vertical: isTinyPhone ? 7 : 8),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: const Color(0xFFE5E7EB)),
                    ),
                    child: Text(
                      '${incidents.length} total',
                      style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: isTinyPhone ? 10 : 11),
                    ),
                  ),
                ],
              ),
            ),
            if (incidents.isEmpty)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Center(
                  child: Text(
                    'No incidents reported yet.',
                    style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                  ),
                ),
              )
            else
              Card(
                color: Colors.white,
                elevation: 4,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(20),
                  side: const BorderSide(color: Color(0xFFE5E7EB)),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: SingleChildScrollView(
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
                        DataColumn(label: Text('Date')),
                        DataColumn(label: Text('Severity')),
                        DataColumn(label: Text('Description')),
                        DataColumn(label: Text('Photos')),
                        DataColumn(label: Text('')),
                      ],
                      rows: incidents.map((inc) {
                        final dateStr = DateFormat('MMM d, y').format(inc.createdAt);
                        final preview = inc.description.length > 35 ? '${inc.description.substring(0, 35)}…' : inc.description;
                        return DataRow(
                          cells: [
                            DataCell(Text(dateStr)),
                            DataCell(Text(inc.severity ?? '—')),
                            DataCell(Text(preview)),
                            DataCell(Text('${inc.photoUrls.length}')),
                            DataCell(
                              IconButton(
                                tooltip: 'Open',
                                icon: const Icon(Icons.chevron_right, color: AppTheme.gold),
                                onPressed: () => _showIncidentDetails(context, inc),
                              ),
                            ),
                          ],
                        );
                      }).toList(),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

