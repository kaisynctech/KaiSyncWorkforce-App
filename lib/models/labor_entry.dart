class LaborEntry {
  final String id;
  final String companyId;
  final String employeeId;
  final String jobId;
  final String? jobCodeId;
  final DateTime workDate;
  final double hours;
  final double? hourlyRate;
  final String sourceType;
  final String? notes;
  final DateTime createdAt;

  const LaborEntry({
    required this.id,
    required this.companyId,
    required this.employeeId,
    required this.jobId,
    required this.jobCodeId,
    required this.workDate,
    required this.hours,
    required this.hourlyRate,
    required this.sourceType,
    required this.notes,
    required this.createdAt,
  });

  factory LaborEntry.fromMap(Map<String, dynamic> row) {
    DateTime dt(dynamic v) =>
        DateTime.tryParse(v?.toString() ?? '')?.toLocal() ?? DateTime.now();
    return LaborEntry(
      id: row['id']?.toString() ?? '',
      companyId: row['company_id']?.toString() ?? '',
      employeeId: row['employee_id']?.toString() ?? '',
      jobId: row['job_id']?.toString() ?? '',
      jobCodeId: row['job_code_id']?.toString(),
      workDate: dt(row['work_date']),
      hours: (row['hours'] as num?)?.toDouble() ?? 0,
      hourlyRate: (row['hourly_rate'] as num?)?.toDouble(),
      sourceType: row['source_type']?.toString() ?? 'manual',
      notes: row['notes']?.toString(),
      createdAt: dt(row['created_at']),
    );
  }
}
