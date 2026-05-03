import 'package:flutter/foundation.dart';

@immutable
class WorkflowFormTemplate {
  final String id;
  final String companyId;
  final String name;
  final String formType;
  final Map<String, dynamic> schemaJson;
  final bool requiresEmployeeSignature;
  final bool requiresSupervisorSignature;
  final bool requiresClientSignature;

  const WorkflowFormTemplate({
    required this.id,
    required this.companyId,
    required this.name,
    required this.formType,
    required this.schemaJson,
    this.requiresEmployeeSignature = false,
    this.requiresSupervisorSignature = false,
    this.requiresClientSignature = false,
  });
}
