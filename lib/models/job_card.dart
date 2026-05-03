import 'package:flutter/foundation.dart';

@immutable
class JobCard {
  final String id;
  final String jobId;
  final DateTime? actualStart;
  final DateTime? actualEnd;
  final String? workPerformed;
  final String? materialsUsed;
  final String? notes;
  final List<String> photoUrls;
  final String? customerSignatureUrl;

  const JobCard({
    required this.id,
    required this.jobId,
    this.actualStart,
    this.actualEnd,
    this.workPerformed,
    this.materialsUsed,
    this.notes,
    this.photoUrls = const [],
    this.customerSignatureUrl,
  });
}

