import 'package:flutter/foundation.dart';

@immutable
class InventoryItem {
  final String id;
  final String name;
  final double stockCount;
  final String? unit;
  final double? unitCost;
  /// Optional sell price per unit (same currency as cost).
  final double? sellingPrice;
  final String? companyId;

  const InventoryItem({
    required this.id,
    required this.name,
    required this.stockCount,
    this.unit,
    this.unitCost,
    this.sellingPrice,
    this.companyId,
  });
}
