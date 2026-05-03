import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/supabase_timesheet_storage.dart';
import '../screens/hr_job_details_screen.dart';
import '../screens/hr_incident_details_screen.dart';
import '../screens/job_card_screen.dart';
import '../screens/hr_payments_section.dart';

class NotificationsCenterPanel extends StatefulWidget {
  final String companyId;
  final String? employeeId;
  final bool forHr;

  const NotificationsCenterPanel({
    super.key,
    required this.companyId,
    this.employeeId,
    this.forHr = false,
  });

  @override
  State<NotificationsCenterPanel> createState() => _NotificationsCenterPanelState();
}

class _NotificationsCenterPanelState extends State<NotificationsCenterPanel> {
  String _filter = 'all';
  bool _onlyUnread = false;
  late Future<List<Map<String, dynamic>>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Map<String, dynamic>>> _load() {
    return SupabaseTimesheetStorage.getMyNotifications(
      companyId: widget.companyId,
      employeeId: widget.employeeId,
      forHr: widget.forHr,
      limit: 200,
    );
  }

  String _category(Map<String, dynamic> n) {
    final type = (n['type']?.toString() ?? '').toLowerCase();
    if (type.contains('incident')) return 'incidents';
    if (type.contains('payment')) return 'payments';
    if (type.contains('job') || type.contains('feedback')) return 'jobs';
    if (type.contains('reminder')) return 'reminders';
    return 'other';
  }

  Future<void> _openReference(Map<String, dynamic> n) async {
    final refType = (n['ref_type']?.toString() ?? '').toLowerCase();
    final refId = n['ref_id']?.toString();
    final notifType = (n['type']?.toString() ?? '').toLowerCase();
    final data = (n['data'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    final hasRefId = refId != null && refId.isNotEmpty;

    if (refType == 'job' && hasRefId) {
      final job = await SupabaseTimesheetStorage.getJobById(refId, companyId: widget.companyId);
      if (!mounted || job == null) return;
      if (widget.forHr) {
        final employees = await SupabaseTimesheetStorage.getEmployees(companyId: widget.companyId);
        if (!mounted) return;
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => HrJobDetailsScreen(job: job, employees: employees),
          ),
        );
      } else {
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => JobCardScreen(job: job)),
        );
      }
      return;
    }

    if (refType == 'incident' && widget.forHr && hasRefId) {
      final incidents = await SupabaseTimesheetStorage.getIncidents(companyId: widget.companyId);
      dynamic incident;
      for (final i in incidents) {
        if (i.id == refId) {
          incident = i;
          break;
        }
      }
      if (!mounted || incident == null) return;
      final employees = await SupabaseTimesheetStorage.getEmployees(companyId: widget.companyId);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => HrIncidentDetailsScreen(incident: incident, employees: employees),
        ),
      );
      return;
    }

    if (widget.forHr &&
        (refType == 'payment_approval' ||
            refType == 'reminder' ||
            notifType.contains('payment') ||
            notifType.contains('reminder'))) {
      final payloadJobId = data['job_id']?.toString();
      if (payloadJobId != null && payloadJobId.isNotEmpty) {
        final job = await SupabaseTimesheetStorage.getJobById(payloadJobId, companyId: widget.companyId);
        if (job != null && mounted) {
          final employees = await SupabaseTimesheetStorage.getEmployees(companyId: widget.companyId);
          if (!mounted) return;
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => HrJobDetailsScreen(job: job, employees: employees),
            ),
          );
          return;
        }
      }
      if (!mounted) return;
      String? focusedEmployeeId;
      DateTime? focusedMonth;
      if (refType == 'payment_approval' && hasRefId) {
        final parts = refId.split(':');
        if (parts.isNotEmpty) {
          focusedEmployeeId = parts.first;
        }
        if (parts.length > 1) {
          focusedMonth = DateTime.tryParse(parts[1]);
        }
      }
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => Scaffold(
            appBar: AppBar(title: const Text('Payments')),
            body: HrPaymentsSection(
              focusedEmployeeId: focusedEmployeeId,
              initialPeriodStart: focusedMonth,
            ),
          ),
        ),
      );
      return;
    }

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Reference: ${n['ref_type'] ?? '-'} ${n['ref_id'] ?? '-'}')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        final all = snap.data ?? const <Map<String, dynamic>>[];
        var filtered = all.where((n) {
          if (_onlyUnread && n['is_read'] == true) return false;
          if (_filter == 'all') return true;
          return _category(n) == _filter;
        }).toList();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final f in const ['all', 'jobs', 'incidents', 'payments', 'reminders'])
                  ChoiceChip(
                    label: Text(f[0].toUpperCase() + f.substring(1)),
                    selected: _filter == f,
                    onSelected: (_) => setState(() => _filter = f),
                  ),
                FilterChip(
                  label: const Text('Unread'),
                  selected: _onlyUnread,
                  onSelected: (v) => setState(() => _onlyUnread = v),
                ),
                OutlinedButton(
                  onPressed: () async {
                    await SupabaseTimesheetStorage.markAllMyNotificationsRead(
                      companyId: widget.companyId,
                      employeeId: widget.employeeId,
                      forHr: widget.forHr,
                    );
                    if (!mounted) return;
                    setState(() => _future = _load());
                  },
                  child: const Text('Mark all read'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Expanded(
              child: filtered.isEmpty
                  ? Center(
                      child: Text(
                        'No notifications for this filter.',
                        style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                      ),
                    )
                  : ListView.separated(
                      itemCount: filtered.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final n = filtered[index];
                        final isRead = n['is_read'] == true;
                        final createdAt = DateTime.tryParse(n['created_at']?.toString() ?? '')?.toLocal();
                        return ListTile(
                          tileColor: isRead ? null : const Color(0xFFFFFBEB),
                          title: Text(
                            n['title']?.toString() ?? 'Notification',
                            style: GoogleFonts.poppins(
                              fontSize: 13,
                              fontWeight: isRead ? FontWeight.w500 : FontWeight.w700,
                            ),
                          ),
                          subtitle: Text(
                            '${n['body']?.toString() ?? ''}${createdAt != null ? ' • ${createdAt.toString().split(".").first}' : ''}',
                            style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF6B7280)),
                          ),
                          trailing: TextButton(
                            onPressed: () async {
                              final id = n['id']?.toString();
                              if (id != null) {
                                await SupabaseTimesheetStorage.markNotificationRead(id);
                                if (!mounted) return;
                                setState(() => _future = _load());
                              }
                              await _openReference(n);
                            },
                            child: const Text('Open'),
                          ),
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }
}
