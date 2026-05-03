import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/employee.dart';
import '../models/time_punch.dart';
import '../services/location_service.dart';
import '../services/supabase_timesheet_storage.dart';

/// HR summary for one employee over a period
class EmployeeHoursSummary {
  final Employee employee;
  final double regularHours;
  final double overtimeHours;
  final double totalHours;
  final double paymentDue;

  const EmployeeHoursSummary({
    required this.employee,
    required this.regularHours,
    required this.overtimeHours,
    required this.totalHours,
    required this.paymentDue,
  });
}

class TimesheetProvider with ChangeNotifier {
  static const _modulesPrefsPrefix = 'enabled_modules_local_';
  static const _defaultModuleKeys = <String>[
    'ticketing',
    'clients',
    'inventory',
    'attendance',
    'reports',
    'scheduling',
    'payroll',
    'paperless',
    'employees',
    'contractors',
    'property_management',
    'asset_compliance',
    'my_pa',
    'leave',
    'messaging',
    'settings',
  ];
  List<Employee> _employees = [];
  List<TimePunch> _allPunches = [];
  List<TimePunch> _currentEmployeePunches = [];
  Employee? _currentEmployee;
  String? _currentCompanyId;
  TimePunch? _lastPunch;
  bool _isLoading = false;
  String? _error;
  List<ResolvedEmployee> _employeeCompanies = [];
  Map<String, bool> _enabledModules = const {};

  List<Employee> get employees => List.unmodifiable(_employees);
  List<TimePunch> get allPunches => List.unmodifiable(_allPunches);
  List<TimePunch> get currentEmployeePunches =>
      List.unmodifiable(_currentEmployeePunches);
  Employee? get currentEmployee => _currentEmployee;
  String? get currentCompanyId => _currentCompanyId;
  TimePunch? get lastPunch => _lastPunch;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isClockedIn => _lastPunch != null && _lastPunch!.isSignIn;
  List<ResolvedEmployee> get employeeCompanies =>
      List.unmodifiable(_employeeCompanies);
  Map<String, bool> get enabledModules => Map.unmodifiable(_enabledModules);

  /// Returns whether a named module is enabled for the current company.
  /// Defaults to [defaultIfMissing] when the flag has not been loaded yet
  /// or is missing on the company row.
  bool isModuleEnabled(String key, {bool defaultIfMissing = true}) {
    return _enabledModules[key] ?? defaultIfMissing;
  }

  /// HR: load the enabled-modules flags for the active company so the UI
  /// can gate sections (e.g., property management). Idempotent.
  Future<void> loadEnabledModules() async {
    final companyId = _currentCompanyId;
    if (companyId == null) return;
    // First hydrate from local persisted state for immediate continuity.
    final local = await _loadLocalEnabledModules(companyId);
    if (local.isNotEmpty) {
      _enabledModules = local;
      notifyListeners();
    }
    try {
      final settings = await SupabaseTimesheetStorage.getCompanySettings(
        companyId: companyId,
      );
      if (settings != null) {
        // Prefer local when present so UI remains stable even when remote
        // writes are blocked/stale. Otherwise fall back to remote.
        final remote = Map<String, bool>.from(settings.enabledModules);
        final resolved = local.isNotEmpty ? local : remote;
        if (resolved.isEmpty) {
          _enabledModules = {for (final k in _defaultModuleKeys) k: true};
        } else {
          _enabledModules = Map<String, bool>.from(resolved);
          for (final k in _defaultModuleKeys) {
            _enabledModules.putIfAbsent(k, () => true);
          }
        }
        await _saveLocalEnabledModules(companyId, _enabledModules);
        notifyListeners();
      }
    } catch (_) {
      if (_enabledModules.isEmpty) {
        _enabledModules = {for (final k in _defaultModuleKeys) k: true};
        await _saveLocalEnabledModules(companyId, _enabledModules);
        notifyListeners();
      }
    }
  }

  /// HR: toggle a module on or off and refresh local state.
  Future<void> setModuleEnabled(String key, bool enabled) async {
    final companyId = _currentCompanyId;
    if (companyId == null) return;
    // Optimistic local update so the UI responds immediately even if
    // remote policy/state causes a delayed or failed write.
    final updated = Map<String, bool>.from(_enabledModules);
    updated[key] = enabled;
    _enabledModules = updated;
    notifyListeners();
    await _saveLocalEnabledModules(companyId, updated);
    try {
      await SupabaseTimesheetStorage.setModuleEnabled(
        companyId: companyId,
        moduleKey: key,
        enabled: enabled,
      );
    } catch (_) {
      // Keep local state; this avoids a blocked-feeling toggle UX.
    }
  }

  Future<void> setAllModulesEnabled({
    required List<String> keys,
    required bool enabled,
  }) async {
    for (final key in keys) {
      await setModuleEnabled(key, enabled);
    }
  }

  Future<Map<String, bool>> _loadLocalEnabledModules(String companyId) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('$_modulesPrefsPrefix$companyId');
    if (raw == null || raw.trim().isEmpty) return const {};
    final out = <String, bool>{};
    for (final pair in raw.split(';')) {
      if (pair.trim().isEmpty) continue;
      final idx = pair.indexOf('=');
      if (idx <= 0) continue;
      final key = pair.substring(0, idx).trim();
      final val = pair.substring(idx + 1).trim().toLowerCase();
      if (key.isEmpty) continue;
      out[key] = val == 'true';
    }
    return out;
  }

  Future<void> _saveLocalEnabledModules(
    String companyId,
    Map<String, bool> map,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    final encoded = map.entries.map((e) => '${e.key}=${e.value}').join(';');
    await prefs.setString('$_modulesPrefsPrefix$companyId', encoded);
  }

  String? get currentCompanyName {
    if (_employeeCompanies.isEmpty) return null;
    try {
      return _employeeCompanies
          .firstWhere((c) => c.companyId == _currentCompanyId)
          .companyName;
    } catch (_) {
      return null;
    }
  }

  void setEmployeeCompanies(List<ResolvedEmployee> companies) {
    _employeeCompanies = companies;
    notifyListeners();
  }

  void setCurrentCompanyId(String? companyId) {
    _currentCompanyId = companyId;
    notifyListeners();
  }

  /// Loads company employees. For worker (code/anon) sessions, pass
  /// [actingEmployeeId] so the peer directory RPC can authorize.
  ///
  /// When [silent] is true, skips the global loading spinner (for background
  /// directory refresh on the employee shell).
  Future<void> loadEmployees({
    String? actingEmployeeId,
    bool silent = false,
  }) async {
    if (!silent) _setLoading(true);
    try {
      _employees = await SupabaseTimesheetStorage.getEmployees(
        companyId: _currentCompanyId,
        actingEmployeeId: actingEmployeeId,
      );
      _error = null;
    } catch (e) {
      _error = e.toString();
    } finally {
      if (!silent) {
        _setLoading(false);
      } else {
        notifyListeners();
      }
    }
  }

  Future<void> loadAllPunches({DateTime? from, DateTime? to}) async {
    _setLoading(true);
    try {
      _allPunches = await SupabaseTimesheetStorage.getAllPunches(
        from: from,
        to: to,
        companyId: _currentCompanyId,
      );
      _error = null;
    } catch (e) {
      _error = e.toString();
    } finally {
      _setLoading(false);
    }
  }

  Future<void> setCurrentEmployee(Employee? e, {String? companyId}) async {
    _currentCompanyId = companyId ?? _currentCompanyId;
    _currentEmployee = e;
    if (e != null) {
      try {
        // Fetch last punch and recent history in parallel.
        final lastPunchFuture = SupabaseTimesheetStorage.getLastPunch(
          e.id,
          companyId: _currentCompanyId,
        );
        final punchesFuture = SupabaseTimesheetStorage.getPunchesForEmployee(
          e.id,
          companyId: _currentCompanyId,
        );
        final (lastPunch, punches) = await (
          lastPunchFuture,
          punchesFuture,
        ).wait;
        _lastPunch = lastPunch;
        _currentEmployeePunches = punches;
        _error = null;
      } catch (e) {
        _error = e.toString();
        _lastPunch = null;
        _currentEmployeePunches = [];
      }
    } else {
      _lastPunch = null;
      _currentEmployeePunches = [];
      _currentCompanyId = null;
    }
    notifyListeners();
  }

  Future<void> signOutEmployee() async {
    _currentEmployee = null;
    _currentCompanyId = null;
    _currentEmployeePunches = [];
    _lastPunch = null;
    _employeeCompanies = [];
    notifyListeners();
    await SupabaseTimesheetStorage.signOutEmployee();
  }

  Future<void> refreshCurrentEmployeePunch() async {
    if (_currentEmployee == null) return;
    try {
      _lastPunch = await SupabaseTimesheetStorage.getLastPunch(
        _currentEmployee!.id,
        companyId: _currentCompanyId,
      );
    } catch (e) {
      _error = e.toString();
    }
    notifyListeners();
  }

  /// [jobId] is only used for sign-in: links the open session to a job after clock-in.
  Future<bool> punch(
    PunchType type, {
    String? note,
    String? jobId,
  }) async {
    if (_currentEmployee == null) return false;
    final position = await LocationService.getCurrentPosition();
    String? address;
    if (position != null) {
      address = await LocationService.getAddressFromPosition(
        position.latitude,
        position.longitude,
      );
    }
    final String? linkJobId;
    if (type == PunchType.signIn) {
      final t = jobId?.trim();
      linkJobId = (t == null || t.isEmpty) ? null : t;
    } else {
      linkJobId = null;
    }
    var newPunch = TimePunch(
      employeeId: _currentEmployee!.id,
      type: type,
      dateTime: DateTime.now(),
      latitude: position?.latitude,
      longitude: position?.longitude,
      address: address,
      notes: note?.trim().isEmpty == true ? null : note?.trim(),
      jobId: linkJobId,
    );
    try {
      if (_currentCompanyId != null) {
        final check = await SupabaseTimesheetStorage.validatePunchAgainstShift(
          companyId: _currentCompanyId!,
          employeeId: _currentEmployee!.id,
          punchAt: newPunch.dateTime,
          latitude: newPunch.latitude,
          longitude: newPunch.longitude,
        );
        if (check != null && check['allowed'] == false) {
          _error =
              check['reason']?.toString() ??
              'Punch blocked by shift validation.';
          notifyListeners();
          return false;
        }
      }
      await SupabaseTimesheetStorage.insertPunch(
        newPunch,
        companyId: _currentCompanyId,
      );
      _error = null;
      if (linkJobId != null && _currentCompanyId != null) {
        try {
          await SupabaseTimesheetStorage.setOpenPunchJobAfterSignIn(
            companyId: _currentCompanyId!,
            employeeId: _currentEmployee!.id,
            jobId: linkJobId,
            workDate: DateTime(
              newPunch.dateTime.year,
              newPunch.dateTime.month,
              newPunch.dateTime.day,
            ),
          );
        } catch (e) {
          _error =
              'Clock-in saved, but linking this shift to the job failed: $e';
          newPunch = newPunch.copyWith(jobId: null);
        }
      }
      _lastPunch = newPunch;
      _allPunches = [newPunch, ..._allPunches];
      if (newPunch.employeeId == _currentEmployee?.id) {
        _currentEmployeePunches = [newPunch, ..._currentEmployeePunches];
      }
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }

  /// Update notes on an existing punch and refresh local state without a full reload.
  Future<void> updatePunchNotes(TimePunch punch, String? notes) async {
    final trimmed = notes?.trim().isEmpty == true ? null : notes?.trim();
    await SupabaseTimesheetStorage.updatePunchNotes(
      punch,
      trimmed,
      companyId: _currentCompanyId,
    );
    // Update the note locally rather than reloading all history.
    final updated = punch.copyWith(notes: trimmed);
    bool isSamePunch(TimePunch p) =>
        p.employeeId == punch.employeeId &&
        p.dateTime == punch.dateTime &&
        p.type == punch.type;
    _allPunches = _allPunches.map((p) => isSamePunch(p) ? updated : p).toList();
    _currentEmployeePunches = _currentEmployeePunches
        .map((p) => isSamePunch(p) ? updated : p)
        .toList();
    notifyListeners();
  }

  /// HR only: create new employee and save to app storage.
  /// Throws on failure so the UI can show an error and avoid closing the form.
  Future<void> createEmployee(Employee e) async {
    if (_currentCompanyId != null) {
      final settings = await SupabaseTimesheetStorage.getCompanySettings(
        companyId: _currentCompanyId!,
      );
      if (settings != null && !settings.canAddUser) {
        throw StateError(
          'Plan limit reached (${settings.currentUsers}/${settings.maxUsers}). Please upgrade your plan.',
        );
      }
    }
    await SupabaseTimesheetStorage.insertEmployee(
      e,
      companyId: _currentCompanyId,
    );
    _employees = await SupabaseTimesheetStorage.getEmployees(
      companyId: _currentCompanyId,
    );
    notifyListeners();
  }

  /// HR only: update existing employee.
  Future<void> updateEmployee(Employee e) async {
    await SupabaseTimesheetStorage.updateEmployee(
      e,
      companyId: _currentCompanyId,
    );
    _employees = await SupabaseTimesheetStorage.getEmployees(
      companyId: _currentCompanyId,
    );
    if (_currentEmployee?.id == e.id) _currentEmployee = e;
    notifyListeners();
  }

  /// HR only: delete employee (punches are kept for history).
  Future<void> deleteEmployee(Employee e) async {
    await SupabaseTimesheetStorage.deleteEmployee(
      e.id,
      companyId: _currentCompanyId,
    );
    _employees = await SupabaseTimesheetStorage.getEmployees(
      companyId: _currentCompanyId,
    );
    if (_currentEmployee?.id == e.id) _currentEmployee = null;
    notifyListeners();
  }

  /// Overtime: hours beyond standard per day. Payment: regular * rate + overtime * (rate * 1.5).
  /// All employee punch fetches run in parallel for performance.
  Future<List<EmployeeHoursSummary>> getHoursSummaries(
    DateTime start,
    DateTime end,
  ) async {
    final emps = await SupabaseTimesheetStorage.getEmployees(
      companyId: _currentCompanyId,
    );
    // Fetch all employees' punches in parallel instead of one by one.
    // Isolate failures so one bad row/network glitch cannot stall Payroll forever.
    final punchLists = await Future.wait(
      emps.map(
        (emp) async {
          try {
            return await SupabaseTimesheetStorage.getPunchesForEmployee(
              emp.id,
              from: start,
              to: end,
              companyId: _currentCompanyId,
            );
          } catch (_) {
            return <TimePunch>[];
          }
        },
      ),
    );
    final summaries = <EmployeeHoursSummary>[];
    for (int i = 0; i < emps.length; i++) {
      final emp = emps[i];
      final punches = punchLists[i];
      double regular = 0, overtime = 0;
      final byDay = <String, List<TimePunch>>{};
      for (final p in punches) {
        final key = '${p.dateTime.year}-${p.dateTime.month}-${p.dateTime.day}';
        byDay.putIfAbsent(key, () => []).add(p);
      }
      for (final dayPunches in byDay.values) {
        dayPunches.sort((a, b) => a.dateTime.compareTo(b.dateTime));
        double dayHours = 0;
        for (int j = 0; j < dayPunches.length - 1; j++) {
          if (dayPunches[j].isSignIn && dayPunches[j + 1].isSignOut) {
            dayHours +=
                dayPunches[j + 1].dateTime
                    .difference(dayPunches[j].dateTime)
                    .inMinutes /
                60;
          }
        }
        final standard = emp.dailyHours > 0
            ? emp.dailyHours
            : Employee.standardHoursPerDay.toDouble();
        if (dayHours <= standard) {
          regular += dayHours;
        } else {
          regular += standard;
          overtime += dayHours - standard;
        }
      }
      final total = regular + overtime;
      final paymentDue =
          regular * emp.hourlyRate + overtime * emp.hourlyRate * 1.5;
      summaries.add(
        EmployeeHoursSummary(
          employee: emp,
          regularHours: regular,
          overtimeHours: overtime,
          totalHours: total,
          paymentDue: paymentDue,
        ),
      );
    }
    return summaries;
  }

  void _setLoading(bool v) {
    _isLoading = v;
    notifyListeners();
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }
}
