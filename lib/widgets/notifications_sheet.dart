import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/supabase_timesheet_storage.dart';

class NotificationsSheet extends StatefulWidget {
  final String companyId;
  final String? employeeId;
  final bool forHr;

  const NotificationsSheet({
    super.key,
    required this.companyId,
    this.employeeId,
    this.forHr = false,
  });

  @override
  State<NotificationsSheet> createState() => _NotificationsSheetState();
}

class _NotificationsSheetState extends State<NotificationsSheet> {
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
    );
  }

  Future<void> _markAll() async {
    await SupabaseTimesheetStorage.markAllMyNotificationsRead(
      companyId: widget.companyId,
      employeeId: widget.employeeId,
      forHr: widget.forHr,
    );
    if (!mounted) return;
    setState(() => _future = _load());
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('Notifications', style: GoogleFonts.poppins(fontWeight: FontWeight.w700, fontSize: 16)),
                const Spacer(),
                TextButton(onPressed: _markAll, child: const Text('Mark all read')),
              ],
            ),
            const SizedBox(height: 8),
            Expanded(
              child: FutureBuilder<List<Map<String, dynamic>>>(
                future: _future,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final items = snap.data ?? const <Map<String, dynamic>>[];
                  if (items.isEmpty) {
                    return Center(
                      child: Text(
                        'No notifications yet.',
                        style: GoogleFonts.poppins(color: const Color(0xFF6B7280)),
                      ),
                    );
                  }
                  return ListView.separated(
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final n = items[i];
                      final isRead = n['is_read'] == true;
                      final createdAt = DateTime.tryParse(n['created_at']?.toString() ?? '');
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
                          '${n['body']?.toString() ?? ''}${createdAt != null ? ' • ${createdAt.toLocal()}' : ''}',
                          style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF6B7280)),
                        ),
                        onTap: () async {
                          final id = n['id']?.toString();
                          if (id != null) {
                            await SupabaseTimesheetStorage.markNotificationRead(id);
                            if (!mounted) return;
                            setState(() => _future = _load());
                          }
                        },
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
