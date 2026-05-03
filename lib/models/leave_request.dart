class LeaveRequest {
  final String id;
  final String companyId;
  final String employeeId;
  final String leaveType;
  final DateTime startDate;
  final DateTime endDate;
  final bool halfDayStart;
  final bool halfDayEnd;
  final int totalDays;
  final String status; // pending | approved | declined | cancelled
  final String? reason;
  final String? decisionNote;
  final String? approverHrUserId;
  final DateTime? decidedAt;
  final DateTime? payrollSyncedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  const LeaveRequest({
    required this.id,
    required this.companyId,
    required this.employeeId,
    required this.leaveType,
    required this.startDate,
    required this.endDate,
    required this.halfDayStart,
    required this.halfDayEnd,
    required this.totalDays,
    required this.status,
    required this.reason,
    required this.decisionNote,
    required this.approverHrUserId,
    required this.decidedAt,
    required this.payrollSyncedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isPending => status == 'pending';

  factory LeaveRequest.fromMap(Map<String, dynamic> row) {
    DateTime dt(dynamic v) => DateTime.tryParse(v?.toString() ?? '')?.toLocal() ?? DateTime.now();
    DateTime? maybeDt(dynamic v) => DateTime.tryParse(v?.toString() ?? '')?.toLocal();
    return LeaveRequest(
      id: row['id']?.toString() ?? '',
      companyId: row['company_id']?.toString() ?? '',
      employeeId: row['employee_id']?.toString() ?? '',
      leaveType: row['leave_type']?.toString() ?? 'annual',
      startDate: dt(row['start_date']),
      endDate: dt(row['end_date']),
      halfDayStart: row['half_day_start'] == true,
      halfDayEnd: row['half_day_end'] == true,
      totalDays: (row['total_days'] as num?)?.toInt() ?? 1,
      status: row['status']?.toString() ?? 'pending',
      reason: row['reason']?.toString(),
      decisionNote: row['decision_note']?.toString(),
      approverHrUserId: row['approver_hr_user_id']?.toString(),
      decidedAt: maybeDt(row['decided_at']),
      payrollSyncedAt: maybeDt(row['payroll_synced_at']),
      createdAt: dt(row['created_at']),
      updatedAt: dt(row['updated_at']),
    );
  }
}
