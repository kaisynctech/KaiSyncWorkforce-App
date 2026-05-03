import 'package:flutter/foundation.dart';

/// A physical thing that needs maintenance — geyser, lift, electrical
/// board, fire equipment, HVAC unit, etc. Always belongs to a site;
/// optionally belongs to a specific unit within that site.
@immutable
class Asset {
  final String id;
  final String siteId;
  final String? unitId;
  final String assetType;
  final String label;
  final String? manufacturer;
  final String? modelNumber;
  final String? serialNumber;
  final DateTime? installDate;
  final DateTime? warrantyExpires;

  /// One of: active, retired, out_of_service.
  final String status;
  final String? notes;

  const Asset({
    required this.id,
    required this.siteId,
    this.unitId,
    required this.assetType,
    required this.label,
    this.manufacturer,
    this.modelNumber,
    this.serialNumber,
    this.installDate,
    this.warrantyExpires,
    this.status = 'active',
    this.notes,
  });

  Asset copyWith({
    String? id,
    String? siteId,
    String? unitId,
    String? assetType,
    String? label,
    String? manufacturer,
    String? modelNumber,
    String? serialNumber,
    DateTime? installDate,
    DateTime? warrantyExpires,
    String? status,
    String? notes,
  }) {
    return Asset(
      id: id ?? this.id,
      siteId: siteId ?? this.siteId,
      unitId: unitId ?? this.unitId,
      assetType: assetType ?? this.assetType,
      label: label ?? this.label,
      manufacturer: manufacturer ?? this.manufacturer,
      modelNumber: modelNumber ?? this.modelNumber,
      serialNumber: serialNumber ?? this.serialNumber,
      installDate: installDate ?? this.installDate,
      warrantyExpires: warrantyExpires ?? this.warrantyExpires,
      status: status ?? this.status,
      notes: notes ?? this.notes,
    );
  }
}

/// Compliance calendar entry — one row per asset, joining its current
/// inspection schedule and most recent certificate. Powers the
/// compliance dashboard. Source: v_compliance_calendar.
@immutable
class ComplianceEntry {
  final String assetId;
  final String assetLabel;
  final String assetType;
  final String? siteName;
  final String? unitNumber;
  final String? inspectionType;
  final int? frequencyMonths;
  final DateTime? lastCompletedAt;
  final DateTime? nextDueDate;

  /// One of: no_schedule, overdue, due_soon, on_track.
  final String inspectionStatus;
  final int? daysUntilDue;
  final String? certificateType;
  final DateTime? certIssuedAt;
  final DateTime? certExpiresAt;

  /// One of: no_certificate, expired, expiring_soon, valid.
  final String certificateStatus;

  const ComplianceEntry({
    required this.assetId,
    required this.assetLabel,
    required this.assetType,
    required this.inspectionStatus,
    required this.certificateStatus,
    this.siteName,
    this.unitNumber,
    this.inspectionType,
    this.frequencyMonths,
    this.lastCompletedAt,
    this.nextDueDate,
    this.daysUntilDue,
    this.certificateType,
    this.certIssuedAt,
    this.certExpiresAt,
  });
}
