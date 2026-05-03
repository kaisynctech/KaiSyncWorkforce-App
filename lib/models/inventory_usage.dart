import 'package:flutter/foundation.dart';

@immutable
class InventoryUsage {
  final String id;
  final String jobId;
  final String inventoryItemId;
  final double quantity;
  final String? employeeId;
  final DateTime? createdAt;

  const InventoryUsage({
    required this.id,
    required this.jobId,
    required this.inventoryItemId,
    required this.quantity,
    this.employeeId,
    this.createdAt,
  });
}

