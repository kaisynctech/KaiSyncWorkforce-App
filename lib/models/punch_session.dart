import '../models/employee.dart';
import '../models/time_punch.dart';

/// One row for HR tables: pairs Time In / Time Out with employee info.
class PunchSession {
  final DateTime date;
  final String fullName;
  final String employeeId;
  final DateTime? timeIn;
  final DateTime? timeOut;
  final String? signInLocation;
  final String? signOutLocation;
  final double? signInLatitude;
  final double? signInLongitude;
  final double? signOutLatitude;
  final double? signOutLongitude;
  // Backwards-compatible aggregate fields used by some existing widgets.
  final String? location;
  final double? latitude;
  final double? longitude;
  final String? notes;
  final double regularHours;
  final double overtimeHours;
  final double totalHours;
  final double monthlySalary;
  final double hourlyRate;

  PunchSession({
    required this.date,
    required this.fullName,
    required this.employeeId,
    this.timeIn,
    this.timeOut,
    this.signInLocation,
    this.signOutLocation,
    this.signInLatitude,
    this.signInLongitude,
    this.signOutLatitude,
    this.signOutLongitude,
    this.location,
    this.latitude,
    this.longitude,
    this.notes,
    this.regularHours = 0,
    this.overtimeHours = 0,
    this.totalHours = 0,
    this.monthlySalary = 0,
    this.hourlyRate = 0,
  });

  /// Normal pay for this session: regular hours × hourly rate.
  double get payment => regularHours * hourlyRate;

  /// Overtime pay for this session: overtime hours × hourly rate × 1.5.
  double get overtimePayment => overtimeHours * hourlyRate * 1.5;

  /// Total pay due for this session: payment + overtimePayment.
  double get paymentDue => payment + overtimePayment;

  static void _computeHours(DateTime? timeIn, DateTime? timeOut, List<double> out) {
    if (timeIn == null || timeOut == null || !timeOut.isAfter(timeIn)) {
      out.addAll([0.0, 0.0, 0.0]);
      return;
    }
    final total = timeOut.difference(timeIn).inMinutes / 60.0;
    const standard = 8.0; // Employee.standardHoursPerDay
    double regular, overtime;
    if (total <= standard) {
      regular = total;
      overtime = 0;
    } else {
      regular = standard;
      overtime = total - standard;
    }
    out.addAll([regular, overtime, total]);
  }

  /// Build sessions from sorted punches (asc by dateTime) and employee lookup.
  static List<PunchSession> fromPunches(
    List<TimePunch> punches,
    Map<String, Employee> employeeById,
  ) {
    if (punches.isEmpty) return [];
    final sorted = List<TimePunch>.from(punches)
      ..sort((a, b) => a.dateTime.compareTo(b.dateTime));
    final sessions = <PunchSession>[];
    int i = 0;
    while (i < sorted.length) {
      final p = sorted[i];
      final emp = employeeById[p.employeeId];
      final fullName = emp?.fullName ?? 'ID ${p.employeeId}';
      final id = (emp?.employeeCode.isNotEmpty == true) ? emp!.employeeCode : (emp?.id ?? p.employeeId);
      if (p.isSignIn) {
        TimePunch? outPunch;
        if (i + 1 < sorted.length && sorted[i + 1].isSignOut && sorted[i + 1].employeeId == p.employeeId) {
          outPunch = sorted[i + 1];
          i += 2;
        } else {
          i += 1;
        }
        final outDt = outPunch?.dateTime;
        final hours = <double>[];
        _computeHours(p.dateTime, outDt, hours);
        sessions.add(PunchSession(
          date: p.dateTime,
          fullName: fullName,
          employeeId: id,
          timeIn: p.dateTime,
          timeOut: outDt,
          signInLocation: p.address,
          signOutLocation: outPunch?.address,
          signInLatitude: p.latitude,
          signInLongitude: p.longitude,
          signOutLatitude: outPunch?.latitude,
          signOutLongitude: outPunch?.longitude,
          location: outPunch?.address ?? p.address,
          latitude: p.latitude,
          longitude: p.longitude,
          notes: outPunch?.notes,
          regularHours: hours.isNotEmpty ? hours[0] : 0,
          overtimeHours: hours.length > 1 ? hours[1] : 0,
          totalHours: hours.length > 2 ? hours[2] : 0,
          monthlySalary: emp?.monthlySalary ?? 0,
          hourlyRate: emp?.hourlyRate ?? 0,
        ));
      } else {
        final hours = <double>[];
        _computeHours(null, p.dateTime, hours);
        sessions.add(PunchSession(
          date: p.dateTime,
          fullName: fullName,
          employeeId: id,
          timeIn: null,
          timeOut: p.dateTime,
          signInLocation: null,
          signOutLocation: p.address,
          signInLatitude: null,
          signInLongitude: null,
          signOutLatitude: p.latitude,
          signOutLongitude: p.longitude,
          location: p.address,
          latitude: p.latitude,
          longitude: p.longitude,
          notes: p.notes,
          regularHours: hours.isNotEmpty ? hours[0] : 0,
          overtimeHours: hours.length > 1 ? hours[1] : 0,
          totalHours: hours.length > 2 ? hours[2] : 0,
          monthlySalary: emp?.monthlySalary ?? 0,
          hourlyRate: emp?.hourlyRate ?? 0,
        ));
        i += 1;
      }
    }
    sessions.sort((a, b) => b.date.compareTo(a.date));
    return sessions;
  }
}
