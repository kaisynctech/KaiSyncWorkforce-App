class PaTaskTemplate {
  final String id;
  final String companyId;
  final String title;
  final String? notes;
  final String priority;
  final String recurrencePattern;
  final String linkedType;
  final int sortOrder;
  final bool isSystem;

  const PaTaskTemplate({
    required this.id,
    required this.companyId,
    required this.title,
    required this.notes,
    required this.priority,
    required this.recurrencePattern,
    required this.linkedType,
    required this.sortOrder,
    required this.isSystem,
  });

  factory PaTaskTemplate.fromMap(Map<String, dynamic> row) {
    return PaTaskTemplate(
      id: row['id']?.toString() ?? '',
      companyId: row['company_id']?.toString() ?? '',
      title: row['title']?.toString() ?? '',
      notes: row['notes']?.toString(),
      priority: row['priority']?.toString() ?? 'medium',
      recurrencePattern: row['recurrence_pattern']?.toString() ?? 'none',
      linkedType: row['linked_type']?.toString() ?? 'none',
      sortOrder: (row['sort_order'] as num?)?.toInt() ?? 100,
      isSystem: row['is_system'] == true,
    );
  }
}
