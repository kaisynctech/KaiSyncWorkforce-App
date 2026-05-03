import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';

import '../models/pa_task.dart';
import '../theme/app_theme.dart';

enum _DayItemKind { meeting, due, reminder }

class MyPaMeetingCalendarTab extends StatefulWidget {
  final List<PaTask> tasks;
  final void Function(PaTask task) onOpenTask;
  final void Function(DateTime day) onPlanDay;

  const MyPaMeetingCalendarTab({
    super.key,
    required this.tasks,
    required this.onOpenTask,
    required this.onPlanDay,
  });

  @override
  State<MyPaMeetingCalendarTab> createState() => _MyPaMeetingCalendarTabState();
}

class _MyPaMeetingCalendarTabState extends State<MyPaMeetingCalendarTab> {
  late DateTime _month;
  DateTime? _selectedDay;

  @override
  void initState() {
    super.initState();
    final n = DateTime.now();
    _month = DateTime(n.year, n.month);
    _selectedDay = DateTime(n.year, n.month, n.day);
  }

  DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

  bool _sameCalendarDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  Set<DateTime> _daysWithItems() {
    final s = <DateTime>{};
    for (final t in widget.tasks) {
      if (t.meetingAt != null) s.add(_dateOnly(t.meetingAt!));
      if (t.dueAt != null) s.add(_dateOnly(t.dueAt!));
      if (t.remindAt != null && !t.isDone) s.add(_dateOnly(t.remindAt!));
    }
    return s;
  }

  Iterable<_DayItemKind> _kindsForTaskOnDay(PaTask t, DateTime day0) sync* {
    if (t.meetingAt != null && _sameCalendarDay(t.meetingAt!, day0)) {
      yield _DayItemKind.meeting;
    }
    if (t.dueAt != null && _sameCalendarDay(t.dueAt!, day0)) {
      yield _DayItemKind.due;
    }
    if (t.remindAt != null &&
        !t.isDone &&
        _sameCalendarDay(t.remindAt!, day0)) {
      yield _DayItemKind.reminder;
    }
  }

  List<PaTask> _itemsOnDay(DateTime day) {
    final day0 = _dateOnly(day);
    final list = widget.tasks.where((t) => _kindsForTaskOnDay(t, day0).isNotEmpty).toList();
    list.sort((a, b) {
      DateTime key(PaTask x) =>
          x.meetingAt ?? x.dueAt ?? x.remindAt ?? x.createdAt;
      return key(a).compareTo(key(b));
    });
    return list;
  }

  List<PaTask> _upcomingReminders() {
    final now = DateTime.now();
    final horizon = now.add(const Duration(days: 3));
    final list = widget.tasks.where((t) {
      if (t.isDone || t.remindAt == null) return false;
      final r = t.remindAt!;
      return !r.isBefore(now) && !r.isAfter(horizon);
    }).toList();
    list.sort((a, b) => a.remindAt!.compareTo(b.remindAt!));
    return list;
  }

  void _prevMonth() {
    setState(() {
      _month = DateTime(_month.year, _month.month - 1);
    });
  }

  void _nextMonth() {
    setState(() {
      _month = DateTime(_month.year, _month.month + 1);
    });
  }

  Widget _kindChip(_DayItemKind k) {
    final (label, color, bg) = switch (k) {
      _DayItemKind.meeting => (
          'Meeting',
          const Color(0xFF9A3412),
          const Color(0xFFFFF7ED),
        ),
      _DayItemKind.due => (
          'Due',
          const Color(0xFF1E3A8A),
          const Color(0xFFEFF4FF),
        ),
      _DayItemKind.reminder => (
          'Reminder',
          const Color(0xFF166534),
          const Color(0xFFEAFBF3),
        ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: GoogleFonts.poppins(
          fontSize: 9,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }

  String _subtitleLine(PaTask t, DateTime day0) {
    final parts = <String>[];
    if (t.meetingAt != null && _sameCalendarDay(t.meetingAt!, day0)) {
      parts.add(DateFormat('HH:mm').format(t.meetingAt!));
    }
    if (t.dueAt != null && _sameCalendarDay(t.dueAt!, day0)) {
      parts.add('Due ${DateFormat('HH:mm').format(t.dueAt!)}');
    }
    if (t.remindAt != null &&
        !t.isDone &&
        _sameCalendarDay(t.remindAt!, day0)) {
      parts.add('Reminder ${DateFormat('HH:mm').format(t.remindAt!)}');
    }
    return parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final marked = _daysWithItems();
    final daysInMonth = DateUtils.getDaysInMonth(_month.year, _month.month);
    final first = DateTime(_month.year, _month.month, 1);
    final leading = first.weekday - 1;
    final cells = <Widget>[];

    for (var i = 0; i < leading; i++) {
      cells.add(const SizedBox.shrink());
    }
    for (var d = 1; d <= daysInMonth; d++) {
      final day = DateTime(_month.year, _month.month, d);
      final has = marked.contains(_dateOnly(day));
      final sel = _selectedDay != null &&
          day.year == _selectedDay!.year &&
          day.month == _selectedDay!.month &&
          day.day == _selectedDay!.day;
      cells.add(
        InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: () => setState(() => _selectedDay = day),
          child: Container(
            alignment: Alignment.center,
            margin: const EdgeInsets.all(2),
            decoration: BoxDecoration(
              color:
                  sel ? AppTheme.gold.withValues(alpha: 0.18) : Colors.transparent,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: has ? AppTheme.gold : const Color(0xFFE5E7EB),
                width: has ? 1.5 : 1,
              ),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  '$d',
                  style: GoogleFonts.poppins(
                    fontSize: 13,
                    fontWeight: sel ? FontWeight.w700 : FontWeight.w500,
                    color: const Color(0xFF111827),
                  ),
                ),
                if (has)
                  Container(
                    margin: const EdgeInsets.only(top: 2),
                    width: 5,
                    height: 5,
                    decoration: const BoxDecoration(
                      color: AppTheme.gold,
                      shape: BoxShape.circle,
                    ),
                  ),
              ],
            ),
          ),
        ),
      );
    }

    final selDay = _selectedDay;
    final selectedDayNorm = selDay == null ? null : _dateOnly(selDay);
    final dayItems =
        selDay == null ? const <PaTask>[] : _itemsOnDay(selDay);
    final reminders = _upcomingReminders();

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        if (reminders.isNotEmpty) ...[
          Card(
            elevation: 0,
            color: const Color(0xFFEFF4FF),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: const BorderSide(color: Color(0xFFC7D2FE)),
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.alarm_on_outlined,
                          size: 18, color: Color(0xFF1E3A8A)),
                      const SizedBox(width: 8),
                      Text(
                        'Reminders coming up',
                        style: GoogleFonts.poppins(
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                          color: const Color(0xFF1E3A8A),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  ...reminders.take(5).map(
                        (t) => Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: InkWell(
                            onTap: () => widget.onOpenTask(t),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    t.title,
                                    style: GoogleFonts.poppins(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                Text(
                                  DateFormat('EEE d MMM • HH:mm')
                                      .format(t.remindAt!),
                                  style: GoogleFonts.poppins(
                                    fontSize: 11,
                                    color: const Color(0xFF64748B),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
        ],
        Row(
          children: [
            Expanded(
              child: Text(
                selectedDayNorm == null
                    ? 'Pick a day'
                    : DateFormat('EEE d MMM yyyy').format(selectedDayNorm),
                style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 14),
              ),
            ),
            if (selectedDayNorm != null)
              TextButton.icon(
                onPressed: () => widget.onPlanDay(selectedDayNorm),
                icon: const Icon(Icons.add_task_outlined, size: 18),
                label: const Text('Add for this day'),
              ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            IconButton(onPressed: _prevMonth, icon: const Icon(Icons.chevron_left)),
            Expanded(
              child: Text(
                DateFormat('MMMM yyyy').format(_month),
                textAlign: TextAlign.center,
                style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600),
              ),
            ),
            IconButton(onPressed: _nextMonth, icon: const Icon(Icons.chevron_right)),
          ],
        ),
        Row(
          children: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
              .map(
                (w) => Expanded(
                  child: Text(
                    w,
                    textAlign: TextAlign.center,
                    style: GoogleFonts.poppins(fontSize: 10, color: const Color(0xFF6B7280)),
                  ),
                ),
              )
              .toList(),
        ),
        const SizedBox(height: 6),
        GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: 7,
          childAspectRatio: 1.05,
          children: cells,
        ),
        const SizedBox(height: 12),
        Text(
          'Dates show meetings, due dates, and reminders.',
          style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFF6B7280)),
        ),
        const SizedBox(height: 12),
        if (dayItems.isEmpty)
          Text(
            widget.tasks.isEmpty
                ? 'No tasks yet. Use Tasks or Add for this day to capture deadlines and meetings.'
                : 'Nothing scheduled on this day.',
            style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF6B7280)),
          )
        else
          ...dayItems.map((t) {
            final dayNorm = selectedDayNorm!;
            final kinds =
                _kindsForTaskOnDay(t, dayNorm).toList(growable: false);
            return Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: Icon(
                  kinds.contains(_DayItemKind.meeting)
                      ? Icons.groups_2_outlined
                      : Icons.task_alt_outlined,
                  color: AppTheme.gold,
                ),
                title: Text(
                  t.title,
                  style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 13),
                ),
                subtitle: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [...kinds.map(_kindChip)],
                    ),
                    if (_subtitleLine(t, dayNorm).isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          _subtitleLine(t, dayNorm),
                          style: GoogleFonts.poppins(
                            fontSize: 11,
                            color: const Color(0xFF6B7280),
                          ),
                        ),
                      ),
                    if ((t.meetingMinutes ?? '').trim().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          'Minutes: ${t.meetingMinutes!.trim()}',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.poppins(
                            fontSize: 11,
                            color: const Color(0xFF374151),
                          ),
                        ),
                      ),
                  ],
                ),
                onTap: () => widget.onOpenTask(t),
              ),
            );
          }),
      ],
    );
  }
}
