import 'package:flutter/foundation.dart';

/// An end-user living in a [Unit]. Distinct from a Client (the paying body
/// corporate). Residents are the people who report maintenance issues and
/// receive feedback requests.
@immutable
class Resident {
  final String id;
  final String unitId;
  final String fullName;
  final String? phone;
  final String? email;
  final DateTime? moveInDate;
  final DateTime? moveOutDate;
  final bool isPrimary;
  final String? notes;

  const Resident({
    required this.id,
    required this.unitId,
    required this.fullName,
    this.phone,
    this.email,
    this.moveInDate,
    this.moveOutDate,
    this.isPrimary = true,
    this.notes,
  });

  Resident copyWith({
    String? id,
    String? unitId,
    String? fullName,
    String? phone,
    String? email,
    DateTime? moveInDate,
    DateTime? moveOutDate,
    bool? isPrimary,
    String? notes,
  }) {
    return Resident(
      id: id ?? this.id,
      unitId: unitId ?? this.unitId,
      fullName: fullName ?? this.fullName,
      phone: phone ?? this.phone,
      email: email ?? this.email,
      moveInDate: moveInDate ?? this.moveInDate,
      moveOutDate: moveOutDate ?? this.moveOutDate,
      isPrimary: isPrimary ?? this.isPrimary,
      notes: notes ?? this.notes,
    );
  }
}
