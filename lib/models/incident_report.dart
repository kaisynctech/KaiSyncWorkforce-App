import 'package:flutter/foundation.dart';

@immutable
class IncidentReport {
  final String id;
  final String employeeId;
  final String? companyId;
  final String? jobId;
  final String? siteId;
  final String description;
  final String? severity;
  final DateTime createdAt;
  final List<String> photoUrls;

  const IncidentReport({
    required this.id,
    required this.employeeId,
    this.companyId,
    this.jobId,
    this.siteId,
    required this.description,
    this.severity,
    required this.createdAt,
    this.photoUrls = const [],
  });
}
