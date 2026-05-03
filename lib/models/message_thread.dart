class MessageThread {
  final String id;
  final String companyId;
  final String title;
  final String threadType;
  final DateTime createdAt;
  /// When set, this group thread is tied to a job (crew channel).
  final String? jobId;

  const MessageThread({
    required this.id,
    required this.companyId,
    required this.title,
    required this.threadType,
    required this.createdAt,
    this.jobId,
  });

  bool get isDirect => threadType == 'direct';
  bool get isGroup => threadType == 'group';

  factory MessageThread.fromMap(Map<String, dynamic> row) {
    return MessageThread(
      id: row['id']?.toString() ?? '',
      companyId: row['company_id']?.toString() ?? '',
      title: row['title']?.toString() ?? '',
      threadType: row['thread_type']?.toString() ?? 'group',
      createdAt:
          DateTime.tryParse(row['created_at']?.toString() ?? '')?.toLocal() ??
          DateTime.now(),
      jobId: row['job_id']?.toString(),
    );
  }
}
