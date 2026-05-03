import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../models/job.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/load_error_panel.dart';

class JobsReportSection extends StatelessWidget {
  const JobsReportSection({super.key});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Job>>(
      future: SupabaseTimesheetStorage.getJobs(
        companyId: context.read<TimesheetProvider>().currentCompanyId,
      ),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load jobs overview.'),
            onRetry: () => (context as Element).markNeedsBuild(),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
        }
        final jobs = snapshot.data!;
        final scheduled = jobs.where((j) => j.status == JobStatus.scheduled).length;
        final inProgress = jobs.where((j) => j.status == JobStatus.inProgress).length;
        final completed = jobs.where((j) => j.status == JobStatus.completed).length;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Jobs overview',
              style: GoogleFonts.poppins(
                color: const Color(0xFF111827),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  _MetricCard(label: 'Scheduled', value: '$scheduled'),
                  const SizedBox(width: 12),
                  _MetricCard(label: 'In progress', value: '$inProgress'),
                  const SizedBox(width: 12),
                  _MetricCard(label: 'Completed', value: '$completed'),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;

  const _MetricCard({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 180,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE5E7EB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: GoogleFonts.poppins(
              color: AppTheme.gold,
              fontSize: 22,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

