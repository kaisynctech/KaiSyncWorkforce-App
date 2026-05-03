/// Row from `app_messages` (company feed or thread).
class AppMessage {
  final String id;
  final String companyId;
  final String? threadId;
  final String? senderEmployeeId;
  final String body;
  final DateTime createdAt;

  const AppMessage({
    required this.id,
    required this.companyId,
    this.threadId,
    this.senderEmployeeId,
    required this.body,
    required this.createdAt,
  });

  factory AppMessage.fromMap(Map<String, dynamic> row) {
    return AppMessage(
      id: row['id']?.toString() ?? '',
      companyId: row['company_id']?.toString() ?? '',
      threadId: row['thread_id']?.toString(),
      senderEmployeeId: row['sender_employee_id']?.toString(),
      body: row['body'] as String? ?? '',
      createdAt: DateTime.tryParse(row['created_at']?.toString() ?? '') ??
          DateTime.now(),
    );
  }
}
