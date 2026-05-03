import 'package:flutter/foundation.dart';

/// Inventory issued by HR to a specific worker, optionally for a specific
/// job. The worker reports actual usage from their job card; the
/// difference between [quantityAllocated] and the recorded usage is the
/// leftover (or, with [extraUsed], over-consumption).
@immutable
class InventoryAllocation {
  final String id;
  final String inventoryItemId;
  final String? itemName;
  final String? unit;
  final String workerEmployeeId;
  final String? workerName;
  final String? workerType;
  final String? jobId;
  final String? jobTitle;
  final double quantityAllocated;

  /// One of: active, closed, cancelled.
  final String status;
  final DateTime? allocatedAt;
  final DateTime? closedAt;
  final String? notes;

  // Derived/aggregate fields populated when fetched from
  // v_inventory_allocations:
  final double quantityUsed;
  final double quantityExtra;
  final double quantityReturned;
  final double quantityRemaining;

  const InventoryAllocation({
    required this.id,
    required this.inventoryItemId,
    required this.workerEmployeeId,
    required this.quantityAllocated,
    this.itemName,
    this.unit,
    this.workerName,
    this.workerType,
    this.jobId,
    this.jobTitle,
    this.status = 'active',
    this.allocatedAt,
    this.closedAt,
    this.notes,
    this.quantityUsed = 0,
    this.quantityExtra = 0,
    this.quantityReturned = 0,
    this.quantityRemaining = 0,
  });

  bool get isActive => status == 'active';

  bool get isOverConsumed => quantityExtra > 0;
}
