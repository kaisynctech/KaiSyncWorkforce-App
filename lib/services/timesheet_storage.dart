import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/employee.dart';
import '../models/time_punch.dart';

/// Stores all data in app storage (shared_preferences so it works on web, mobile, desktop).
/// Key: timesheet_data.
class TimesheetStorage {
  static const String _storageKey = 'timesheet_data';

  static Future<Map<String, dynamic>> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final json = prefs.getString(_storageKey);
    if (json != null && json.trim().isNotEmpty) {
      try {
        final data = jsonDecode(json) as Map<String, dynamic>?;
        if (data != null) return data;
      } catch (_) {
        // Corrupt or invalid – return empty
      }
    }
    return {'employees': <Map<String, dynamic>>[], 'punches': <Map<String, dynamic>>[]};
  }

  static Future<void> _save(Map<String, dynamic> data) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey, const JsonEncoder.withIndent('  ').convert(data));
  }

  // --- Employees ---

  static Future<List<Employee>> getEmployees() async {
    final data = await _load();
    final list = (data['employees'] as List<dynamic>?)
        ?.map((e) => Employee.fromMap(Map<String, dynamic>.from(e as Map)))
        .toList() ?? <Employee>[];
    list.sort((a, b) => a.fullName.compareTo(b.fullName));
    return list;
  }

  static Future<Employee?> getEmployeeById(String id) async {
    final list = await getEmployees();
    try {
      return list.firstWhere((e) => e.id == id);
    } catch (_) {
      return null;
    }
  }

  static Future<void> insertEmployee(Employee e) async {
    final data = await _load();
    final employees = List<Map<String, dynamic>>.from(
      (data['employees'] as List<dynamic>?)?.map((e) => Map<String, dynamic>.from(e as Map)) ?? [],
    );
    employees.add(e.toMap());
    data['employees'] = employees;
    await _save(data);
  }

  static Future<void> updateEmployee(Employee e) async {
    final data = await _load();
    final employees = List<Map<String, dynamic>>.from(
      (data['employees'] as List<dynamic>?)?.map((e) => Map<String, dynamic>.from(e as Map)) ?? [],
    );
    final idx = employees.indexWhere((m) => m['id'] == e.id);
    if (idx >= 0) {
      employees[idx] = e.toMap();
      data['employees'] = employees;
      await _save(data);
    }
  }

  static Future<void> deleteEmployee(String employeeId) async {
    final data = await _load();
    final employees = List<Map<String, dynamic>>.from(
      (data['employees'] as List<dynamic>?)?.map((e) => Map<String, dynamic>.from(e as Map)) ?? [],
    );
    employees.removeWhere((m) => m['id'] == employeeId);
    data['employees'] = employees;
    await _save(data);
  }

  // --- Punches ---

  static Future<void> insertPunch(TimePunch p) async {
    final data = await _load();
    final punches = List<Map<String, dynamic>>.from(
      (data['punches'] as List<dynamic>?)?.map((e) => Map<String, dynamic>.from(e as Map)) ?? [],
    );
    punches.add(p.toMap());
    data['punches'] = punches;
    await _save(data);
  }

  static Future<List<TimePunch>> getPunchesForEmployee(String employeeId, {DateTime? from, DateTime? to}) async {
    final all = await getAllPunches(from: from, to: to);
    return all.where((p) => p.employeeId == employeeId).toList();
  }

  static Future<List<TimePunch>> getAllPunches({DateTime? from, DateTime? to}) async {
    final data = await _load();
    final raw = (data['punches'] as List<dynamic>?) ?? [];
    final list = raw
        .map((e) => TimePunch.fromMap(Map<String, dynamic>.from(e as Map)))
        .where((p) {
          if (from != null && p.dateTime.isBefore(from)) return false;
          if (to != null && p.dateTime.isAfter(to)) return false;
          return true;
        })
        .toList();
    list.sort((a, b) => b.dateTime.compareTo(a.dateTime));
    return list;
  }

  static Future<TimePunch?> getLastPunch(String employeeId) async {
    final list = await getPunchesForEmployee(employeeId);
    return list.isEmpty ? null : list.first;
  }

  /// Update the notes of an existing punch (matched by employeeId + dateTime + type).
  static Future<void> updatePunchNotes(TimePunch punch, String? notes) async {
    final data = await _load();
    final punches = List<Map<String, dynamic>>.from(
      (data['punches'] as List<dynamic>?)?.map((e) => Map<String, dynamic>.from(e as Map)) ?? [],
    );
    final key = punch.dateTime.toIso8601String();
    for (int i = 0; i < punches.length; i++) {
      final p = punches[i];
      if (p['employee_id'] == punch.employeeId &&
          p['date_time'] == key &&
          (p['type'] as String?) == (punch.isSignIn ? 'in' : 'out')) {
        punches[i] = Map<String, dynamic>.from(p)..['notes'] = notes;
        break;
      }
    }
    data['punches'] = punches;
    await _save(data);
  }

  /// Description for display in the app (no file path when using shared_preferences).
  static Future<String> get filePath async => 'App storage ($_storageKey)';
}
