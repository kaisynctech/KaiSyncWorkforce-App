import 'package:flutter/foundation.dart';

@immutable
class PaymentApproval {
  final String? id;
  final String employeeId;
  final String? companyId;
  final DateTime periodStart; // first day of month
  final double? editedAmount;
  final bool approved;
  final DateTime? approvedAt;
  final String status; // pending, approved, declined, partial
  final String? decisionNote;

  const PaymentApproval({
    this.id,
    required this.employeeId,
    this.companyId,
    required this.periodStart,
    this.editedAmount,
    required this.approved,
    this.approvedAt,
    this.status = 'pending',
    this.decisionNote,
  });
}
