import 'package:flutter/foundation.dart';

@immutable
class ContractorMemberLink {
  final String contractorId;
  final String employeeId;
  final String? roleLabel;
  final bool isPrimary;

  const ContractorMemberLink({
    required this.contractorId,
    required this.employeeId,
    this.roleLabel,
    this.isPrimary = false,
  });
}
