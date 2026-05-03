import 'package:flutter/foundation.dart';

/// What kind of customer this client is. Determines what cascades into
/// jobs (e.g. unit numbers for property-type clients).
enum ClientType {
  /// Single person — no organisational structure underneath.
  individual,

  /// Business or organisation — may have multiple sites.
  company,

  /// One specific building / estate / complex. Has units underneath.
  property,
}

extension ClientTypeX on ClientType {
  String get wireValue {
    switch (this) {
      case ClientType.individual:
        return 'individual';
      case ClientType.company:
        return 'company';
      case ClientType.property:
        return 'property';
    }
  }

  String get label {
    switch (this) {
      case ClientType.individual:
        return 'Individual';
      case ClientType.company:
        return 'Company';
      case ClientType.property:
        return 'Property / Estate';
    }
  }
}

ClientType clientTypeFromString(String? raw) {
  switch ((raw ?? '').toLowerCase()) {
    case 'individual':
      return ClientType.individual;
    case 'property':
      return ClientType.property;
    default:
      return ClientType.company;
  }
}

@immutable
class Client {
  final String id;
  final String name;
  final String? companyId;
  final String? address;
  final String? contactPerson;
  final String? phone;
  final String? email;
  final String? notes;
  final ClientType clientType;
  final String? linkedCompanyId;
  final String? sourceContractorId;

  const Client({
    required this.id,
    required this.name,
    this.companyId,
    this.address,
    this.contactPerson,
    this.phone,
    this.email,
    this.notes,
    this.clientType = ClientType.company,
    this.linkedCompanyId,
    this.sourceContractorId,
  });

  Client copyWith({
    String? id,
    String? name,
    String? companyId,
    String? address,
    String? contactPerson,
    String? phone,
    String? email,
    String? notes,
    ClientType? clientType,
    String? linkedCompanyId,
    String? sourceContractorId,
  }) {
    return Client(
      id: id ?? this.id,
      name: name ?? this.name,
      companyId: companyId ?? this.companyId,
      address: address ?? this.address,
      contactPerson: contactPerson ?? this.contactPerson,
      phone: phone ?? this.phone,
      email: email ?? this.email,
      notes: notes ?? this.notes,
      clientType: clientType ?? this.clientType,
      linkedCompanyId: linkedCompanyId ?? this.linkedCompanyId,
      sourceContractorId: sourceContractorId ?? this.sourceContractorId,
    );
  }
}
