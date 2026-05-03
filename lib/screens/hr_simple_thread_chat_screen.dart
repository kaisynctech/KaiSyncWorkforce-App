import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/app_message.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/app_feedback.dart';

/// HR-only full-screen thread chat (auth user posts as management).
class HrSimpleThreadChatScreen extends StatefulWidget {
  final String companyId;
  final String threadId;
  final String title;
  final String? subtitle;

  const HrSimpleThreadChatScreen({
    super.key,
    required this.companyId,
    required this.threadId,
    required this.title,
    this.subtitle,
  });

  @override
  State<HrSimpleThreadChatScreen> createState() =>
      _HrSimpleThreadChatScreenState();
}

class _HrSimpleThreadChatScreenState extends State<HrSimpleThreadChatScreen> {
  final TextEditingController _ctrl = TextEditingController();
  bool _sending = false;
  int _reloadKey = 0;

  Future<void> _send() async {
    final body = _ctrl.text.trim();
    if (body.isEmpty) return;
    setState(() => _sending = true);
    try {
      await SupabaseTimesheetStorage.sendThreadMessage(
        companyId: widget.companyId,
        threadId: widget.threadId,
        body: body,
      );
      if (!mounted) return;
      _ctrl.clear();
      setState(() {
        _reloadKey++;
        _sending = false;
      });
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, e.toString());
      setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final employeesById = {
      for (final e in context.watch<TimesheetProvider>().employees) e.id: e,
    };
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.title,
              style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 16),
              overflow: TextOverflow.ellipsis,
            ),
            if ((widget.subtitle ?? '').isNotEmpty)
              Text(
                widget.subtitle!,
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  color: const Color(0xFF6B7280),
                ),
              ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: FutureBuilder<List<AppMessage>>(
              key: ValueKey(_reloadKey),
              future: SupabaseTimesheetStorage.getThreadMessages(
                companyId: widget.companyId,
                threadId: widget.threadId,
              ),
              builder: (context, snap) {
                final rows = snap.data ?? const <AppMessage>[];
                if (snap.connectionState == ConnectionState.waiting &&
                    !snap.hasData) {
                  return const Center(
                    child: CircularProgressIndicator(color: AppTheme.gold),
                  );
                }
                if (rows.isEmpty) {
                  return Center(
                    child: Text(
                      'No messages yet. Crew members assigned to this job will see this channel under Messages → Teams.',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF6B7280),
                        fontSize: 13,
                      ),
                    ),
                  );
                }
                return ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
                  itemCount: rows.length,
                  itemBuilder: (_, i) {
                    final m = rows[i];
                    final sender = m.senderEmployeeId != null
                        ? (employeesById[m.senderEmployeeId]?.fullName ??
                              'Employee ${m.senderEmployeeId}')
                        : 'HR';
                    return ListTile(
                      dense: true,
                      title: Text(sender),
                      subtitle: Text(m.body),
                      trailing: Text(
                        DateFormat('dd MMM HH:mm').format(m.createdAt),
                        style: GoogleFonts.poppins(
                          fontSize: 11,
                          color: const Color(0xFF6B7280),
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _ctrl,
                      minLines: 1,
                      maxLines: 4,
                      decoration: const InputDecoration(
                        labelText: 'Message',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    onPressed: _sending ? null : _send,
                    icon: const Icon(Icons.send_outlined, size: 16),
                    label: const Text('Send'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.gold,
                      foregroundColor: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
