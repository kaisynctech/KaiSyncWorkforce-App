import 'package:flutter/foundation.dart';

@immutable
class Site {
  final String id;
  final String clientId;
  final String name;
  final String? address;
  final double? latitude;
  final double? longitude;
  final String? notes;

  const Site({
    required this.id,
    required this.clientId,
    required this.name,
    this.address,
    this.latitude,
    this.longitude,
    this.notes,
  });
}

