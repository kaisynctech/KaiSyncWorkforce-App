class JobCode {
  final String id;
  final String companyId;
  final String code;
  final String title;
  final bool isActive;
  final double? defaultHourlyRate;

  const JobCode({
    required this.id,
    required this.companyId,
    required this.code,
    required this.title,
    required this.isActive,
    required this.defaultHourlyRate,
  });

  factory JobCode.fromMap(Map<String, dynamic> row) {
    return JobCode(
      id: row['id']?.toString() ?? '',
      companyId: row['company_id']?.toString() ?? '',
      code: row['code']?.toString() ?? '',
      title: row['title']?.toString() ?? '',
      isActive: row['is_active'] != false,
      defaultHourlyRate: (row['default_hourly_rate'] as num?)?.toDouble(),
    );
  }
}
