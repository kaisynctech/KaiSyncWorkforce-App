/// Type of punch: sign in (clock in) or sign out (clock out)
enum PunchType { signIn, signOut }

class TimePunch {
  final int? rowIndex;
  final String employeeId;
  final PunchType type;
  final DateTime dateTime;
  final double? latitude;
  final double? longitude;
  final String? address;
  final String? notes;

  /// Optional job linked to this clock-in session (same `punches` row in DB).
  final String? jobId;

  const TimePunch({
    this.rowIndex,
    required this.employeeId,
    required this.type,
    required this.dateTime,
    this.latitude,
    this.longitude,
    this.address,
    this.notes,
    this.jobId,
  });

  bool get isSignIn => type == PunchType.signIn;
  bool get isSignOut => type == PunchType.signOut;

  Map<String, dynamic> toMap() {
    return {
      'employee_id': employeeId,
      'type': type == PunchType.signIn ? 'in' : 'out',
      'date_time': dateTime.toIso8601String(),
      'latitude': latitude,
      'longitude': longitude,
      'address': address,
      'notes': notes,
      if (jobId != null) 'job_id': jobId,
    };
  }

  factory TimePunch.fromMap(Map<String, dynamic> map) {
    return TimePunch(
      rowIndex: map['row_index'] as int?,
      employeeId: map['employee_id']?.toString() ?? '',
      type: (map['type'] as String?) == 'in' ? PunchType.signIn : PunchType.signOut,
      dateTime: map['date_time'] != null
          ? DateTime.tryParse(map['date_time'] as String) ?? DateTime.now()
          : DateTime.now(),
      latitude: (map['latitude'] as num?)?.toDouble(),
      longitude: (map['longitude'] as num?)?.toDouble(),
      address: map['address'] as String?,
      notes: map['notes'] as String?,
      jobId: map['job_id']?.toString(),
    );
  }

  TimePunch copyWith({String? notes, String? jobId}) {
    return TimePunch(
      rowIndex: rowIndex,
      employeeId: employeeId,
      type: type,
      dateTime: dateTime,
      latitude: latitude,
      longitude: longitude,
      address: address,
      notes: notes ?? this.notes,
      jobId: jobId ?? this.jobId,
    );
  }
}
