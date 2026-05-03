import 'package:flutter/foundation.dart';

/// A sub-property within a [Site] — e.g. apartment 12A inside complex
/// "Sunrise Heights". Units are the level at which residents live and at
/// which maintenance tickets are most usefully reported.
@immutable
class Unit {
  final String id;
  final String siteId;
  final String unitNumber;
  final String? label;

  /// One of: occupied, vacant, reserved, off_market.
  final String occupancyStatus;
  final String? floor;
  final String? notes;

  const Unit({
    required this.id,
    required this.siteId,
    required this.unitNumber,
    this.label,
    this.occupancyStatus = 'occupied',
    this.floor,
    this.notes,
  });

  Unit copyWith({
    String? id,
    String? siteId,
    String? unitNumber,
    String? label,
    String? occupancyStatus,
    String? floor,
    String? notes,
  }) {
    return Unit(
      id: id ?? this.id,
      siteId: siteId ?? this.siteId,
      unitNumber: unitNumber ?? this.unitNumber,
      label: label ?? this.label,
      occupancyStatus: occupancyStatus ?? this.occupancyStatus,
      floor: floor ?? this.floor,
      notes: notes ?? this.notes,
    );
  }
}
