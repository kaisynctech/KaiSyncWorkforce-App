class PaTask {
  final String id;
  final String companyId;
  final String title;
  final String? notes;
  final DateTime? dueAt;
  final String status; // todo | in_progress | done | snoozed
  final String priority; // low | medium | high
  final DateTime? remindAt;
  final DateTime? snoozedUntil;
  final String linkedType; // none | client | job | deal | payment | meeting
  final String? linkedId;
  final String? linkedLabel;
  final String recurrencePattern; // none | daily | weekly | monthly
  final String? sourceType;
  final String? sourceId;
  final String? meetingWith;
  final DateTime? meetingAt;
  /// Outcomes / notes after the meeting.
  final String? meetingMinutes;
  /// Follow-ups: next meeting, project decision, etc.
  final String? meetingFollowUp;
  final String? ownerEmployeeId;
  final String? ownerHrUserId;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? completedAt;

  const PaTask({
    required this.id,
    required this.companyId,
    required this.title,
    required this.notes,
    required this.dueAt,
    required this.status,
    required this.priority,
    required this.remindAt,
    required this.snoozedUntil,
    required this.linkedType,
    required this.linkedId,
    required this.linkedLabel,
    required this.recurrencePattern,
    required this.sourceType,
    required this.sourceId,
    required this.meetingWith,
    required this.meetingAt,
    required this.meetingMinutes,
    required this.meetingFollowUp,
    required this.ownerEmployeeId,
    required this.ownerHrUserId,
    required this.createdAt,
    required this.updatedAt,
    required this.completedAt,
  });

  bool get isDone => status == 'done';

  factory PaTask.fromMap(Map<String, dynamic> row) {
    DateTime? dt(dynamic v) => v == null ? null : DateTime.tryParse(v.toString())?.toLocal();
    return PaTask(
      id: row['id']?.toString() ?? '',
      companyId: row['company_id']?.toString() ?? '',
      title: row['title']?.toString() ?? '',
      notes: row['notes']?.toString(),
      dueAt: dt(row['due_at']),
      status: row['status']?.toString() ?? 'todo',
      priority: row['priority']?.toString() ?? 'medium',
      remindAt: dt(row['remind_at']),
      snoozedUntil: dt(row['snoozed_until']),
      linkedType: row['linked_type']?.toString() ?? 'none',
      linkedId: row['linked_id']?.toString(),
      linkedLabel: row['linked_label']?.toString(),
      recurrencePattern: row['recurrence_pattern']?.toString() ?? 'none',
      sourceType: row['source_type']?.toString(),
      sourceId: row['source_id']?.toString(),
      meetingWith: row['meeting_with']?.toString(),
      meetingAt: dt(row['meeting_at']),
      meetingMinutes: row['meeting_minutes']?.toString(),
      meetingFollowUp: row['meeting_follow_up']?.toString(),
      ownerEmployeeId: row['owner_employee_id']?.toString(),
      ownerHrUserId: row['owner_hr_user_id']?.toString(),
      createdAt: dt(row['created_at']) ?? DateTime.now(),
      updatedAt: dt(row['updated_at']) ?? DateTime.now(),
      completedAt: dt(row['completed_at']),
    );
  }
}
