import 'package:flutter/foundation.dart';

@immutable
class CompanyRelationship {
  final String id;
  final String requesterCompanyId;
  final String recipientCompanyId;
  final String relationshipType; // client_contractor
  final String status; // pending | active | rejected | cancelled
  final String? sourceContractorId;

  const CompanyRelationship({
    required this.id,
    required this.requesterCompanyId,
    required this.recipientCompanyId,
    required this.relationshipType,
    required this.status,
    this.sourceContractorId,
  });
}
