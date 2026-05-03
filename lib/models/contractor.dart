import 'package:flutter/foundation.dart';

@immutable
class Contractor {
  final String id;
  final String companyId;
  final String contractorType; // company | individual
  final String displayName;
  final bool allowMembersViewAllJobs;
  final String? linkedCompanyId;
  final String? linkedCompanyStatus; // unlinked | pending | linked | rejected
  final String? contactPerson;
  final String? email;
  final String? phone;
  final String status; // active | inactive
  final String? notes;

  const Contractor({
    required this.id,
    required this.companyId,
    required this.contractorType,
    required this.displayName,
    this.allowMembersViewAllJobs = true,
    this.linkedCompanyId,
    this.linkedCompanyStatus,
    this.contactPerson,
    this.email,
    this.phone,
    this.status = 'active',
    this.notes,
  });
}
