import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/app_message.dart';
import '../providers/timesheet_provider.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/app_feedback.dart';

/// Full-screen thread chat (direct or team). Marks read on open and when leaving.
class EmployeeThreadChatScreen extends StatefulWidget {
  final String companyId;
  final String threadId;
  final String title;
  /// Worker (code-login) sessions must pass this so thread reads use the RPC.
  final String? actingEmployeeId;

  const EmployeeThreadChatScreen({
    super.key,
    required this.companyId,
    required this.threadId,
    required this.title,
    this.actingEmployeeId,
  });

  @override
  State<EmployeeThreadChatScreen> createState() =>
      _EmployeeThreadChatScreenState();
}

class _EmployeeThreadChatScreenState extends State<EmployeeThreadChatScreen> {
  final TextEditingController _msgCtrl = TextEditingController();
  bool _sending = false;
  int _reloadToken = 0;

  Future<void> _markRead() async {
    final prov = context.read<TimesheetProvider>();
    final me =
        widget.actingEmployeeId ?? prov.currentEmployee?.id;
    if (me == null) {
      return;
    }
    await SupabaseTimesheetStorage.markMessageThreadRead(
      companyId: widget.companyId,
      threadId: widget.threadId,
      employeeId: me,
    );
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _markRead());
  }

  @override
  void dispose() {
    final meId = widget.actingEmployeeId ??
        context.read<TimesheetProvider>().currentEmployee?.id;
    _msgCtrl.dispose();
    if (meId != null) {
      SupabaseTimesheetStorage.markMessageThreadRead(
        companyId: widget.companyId,
        threadId: widget.threadId,
        employeeId: meId,
      );
    }
    super.dispose();
  }

  Future<void> _send() async {
    final prov = context.read<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final employeeId =
        widget.actingEmployeeId ?? prov.currentEmployee?.id;
    if (companyId == null || employeeId == null) {
      return;
    }
    final body = _msgCtrl.text.trim();
    if (body.isEmpty) {
      return;
    }
    setState(() => _sending = true);
    try {
      await SupabaseTimesheetStorage.sendThreadMessage(
        companyId: companyId,
        threadId: widget.threadId,
        senderEmployeeId: employeeId,
        body: body,
      );
      if (!mounted) {
        return;
      }
      _msgCtrl.clear();
      setState(() {
        _reloadToken++;
        _sending = false;
      });
      await _markRead();
    } catch (e) {
      if (!mounted) {
        return;
      }
      showErrorSnack(context, e.toString());
      setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final me =
        widget.actingEmployeeId ?? prov.currentEmployee?.id;
    final employeesById = {for (final e in prov.employees) e.id: e};
    if (me == null) {
      return const Scaffold(body: SizedBox.shrink());
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.title,
          style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
        foregroundColor: const Color(0xFF111827),
        backgroundColor: Colors.white,
        elevation: 0,
      ),
      body: Column(
        children: [
          Expanded(
            child: FutureBuilder<List<AppMessage>>(
              key: ValueKey(_reloadToken),
              future: SupabaseTimesheetStorage.getThreadMessages(
                companyId: widget.companyId,
                threadId: widget.threadId,
                actingEmployeeId: widget.actingEmployeeId ?? me,
              ),
              builder: (context, snap) {
                final rows = snap.data ?? const <AppMessage>[];
                if (snap.connectionState == ConnectionState.waiting &&
                    !snap.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (rows.isEmpty) {
                  return Center(
                    child: Text(
                      'No messages yet. Say hello below.',
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
                    final mine = m.senderEmployeeId == me;
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
                      tileColor: mine ? const Color(0xFFF3F4FF) : null,
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
                      controller: _msgCtrl,
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
