import 'package:flutter/foundation.dart';

@immutable
class WorkflowFormSubmission {
  final String id;
  final String templateId;
  final String companyId;
  final String status;
  final String? employeeId;
  final String? jobId;
  final Map<String, dynamic> payloadJson;
  final String? employeeSignatureUrl;
  final String? supervisorSignatureUrl;
  final String? clientSignatureUrl;
  final DateTime createdAt;

  const WorkflowFormSubmission({
    required this.id,
    required this.templateId,
    required this.companyId,
    required this.status,
    this.employeeId,
    this.jobId,
    required this.payloadJson,
    this.employeeSignatureUrl,
    this.supervisorSignatureUrl,
    this.clientSignatureUrl,
    required this.createdAt,
  });
}
