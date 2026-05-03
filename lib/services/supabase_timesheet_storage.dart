import 'dart:math';

import 'package:intl/intl.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../models/employee.dart';
import '../models/time_punch.dart';
import '../models/client.dart';
import '../models/site.dart';
import '../models/job.dart';
import '../models/job_card.dart';
import '../models/incident_report.dart';
import '../models/inventory_item.dart';
import '../models/work_team.dart';
import '../models/inventory_usage.dart';
import '../models/payment_approval.dart';
import '../models/workflow_form_template.dart';
import '../models/workflow_form_submission.dart';
import '../models/unit.dart';
import '../models/resident.dart';
import '../models/asset.dart';
import '../models/inventory_allocation.dart';
import '../models/contractor.dart';
import '../models/contractor_member_link.dart';
import '../models/company_relationship.dart';
import '../models/app_message.dart';
import '../models/job_code.dart';
import '../models/labor_entry.dart';
import '../models/leave_request.dart';
import '../models/message_thread.dart';
import '../models/pa_task.dart';
import '../models/pa_task_template.dart';
import '../strings/workspace_terms.dart';
import '../supabase_config.dart';

/// Used for employee login: resolves an employee row + its tenant `company_id`.
class ResolvedEmployee {
  final Employee employee;
  final String companyId;
  final String companyName;
  final String companyCode;

  const ResolvedEmployee({
    required this.employee,
    required this.companyId,
    this.companyName = '',
    this.companyCode = '',
  });
}

class RpcHealthCheckResult {
  final String name;
  final bool ok;
  final String details;

  const RpcHealthCheckResult({
    required this.name,
    required this.ok,
    required this.details,
  });
}

class CompanyRegistrationResult {
  final String companyId;
  final String companyCode;

  const CompanyRegistrationResult({
    required this.companyId,
    required this.companyCode,
  });
}

class HrUserProfile {
  final String companyId;
  final String role;
  final bool isActive;
  final String? displayName;

  const HrUserProfile({
    required this.companyId,
    required this.role,
    required this.isActive,
    this.displayName,
  });
}

class HrRecipientUser {
  final String authUserId;
  final String role;
  final String? displayName;

  const HrRecipientUser({
    required this.authUserId,
    required this.role,
    this.displayName,
  });
}

class CompanySettings {
  final String companyId;
  final String companyCode;
  final String companyName;
  final String planCode;
  final double planPriceZar;
  final int maxUsers;
  final bool subscriptionActive;
  final int currentUsers;
  final DateTime trialStartedAt;

  /// Map of module-flag-name -> enabled. Source: companies.enabled_modules.
  /// Known keys: ticketing, scheduling, payroll, paperless, compliance,
  /// contractors, property_management, asset_compliance, reporting_external, my_pa, leave.
  final Map<String, bool> enabledModules;
  final Map<String, dynamic> dispatchSettings;

  const CompanySettings({
    required this.companyId,
    required this.companyCode,
    required this.companyName,
    required this.planCode,
    required this.planPriceZar,
    required this.maxUsers,
    required this.subscriptionActive,
    required this.currentUsers,
    required this.trialStartedAt,
    this.enabledModules = const {},
    this.dispatchSettings = const {},
  });

  DateTime get trialEndsAt => DateTime(
    trialStartedAt.year,
    trialStartedAt.month + 2,
    trialStartedAt.day,
  );
  bool get isInFreeTrial => DateTime.now().isBefore(trialEndsAt);
  String get effectivePlanCode {
    if (isInFreeTrial) return 'free_trial';
    final normalized = planCode.toLowerCase();
    if (normalized == 'starter') return 'basic';
    return normalized;
  }

  bool get canAddUser {
    if (isInFreeTrial) return currentUsers < 20;
    return subscriptionActive && currentUsers < maxUsers;
  }

  /// Returns true if the named module is enabled. Returns the supplied
  /// [defaultIfMissing] when the company has no value for the flag (e.g.,
  /// rows that pre-date the migration).
  bool isModuleEnabled(String key, {bool defaultIfMissing = false}) {
    return enabledModules[key] ?? defaultIfMissing;
  }

  double dispatchNumber(String key, {double defaultValue = 0}) {
    final raw = dispatchSettings[key];
    if (raw is num) return raw.toDouble();
    return double.tryParse(raw?.toString() ?? '') ?? defaultValue;
  }

  bool dispatchFlag(String key, {bool defaultValue = false}) {
    final raw = dispatchSettings[key];
    if (raw is bool) return raw;
    final text = raw?.toString().toLowerCase();
    if (text == 'true') return true;
    if (text == 'false') return false;
    return defaultValue;
  }
}

class HrAccessUser {
  final String authUserId;
  final String role;
  final String? displayName;
  final bool isActive;

  const HrAccessUser({
    required this.authUserId,
    required this.role,
    required this.displayName,
    required this.isActive,
  });
}

class AppReleaseConfig {
  final String key;
  final bool isEnabled;
  final String latestVersion;
  final String? minimumSupportedVersion;
  final bool forceUpdate;
  final String? updateUrlAndroid;
  final String? updateUrlIos;
  final String? updateUrlWeb;

  const AppReleaseConfig({
    required this.key,
    required this.isEnabled,
    required this.latestVersion,
    required this.minimumSupportedVersion,
    required this.forceUpdate,
    required this.updateUrlAndroid,
    required this.updateUrlIos,
    required this.updateUrlWeb,
  });
}

class PaLinkOption {
  final String id;
  final String label;

  const PaLinkOption({required this.id, required this.label});
}

/// Storage backed by Supabase (`employees` and `punches` tables).
///
/// NOTE: The `punches` table is modelled as one row per session with:
/// - employees_id (bigint)
/// - Date (date)
/// - sign_in (time with time zone)
/// - sign_out (time with time zone)
/// - longitude, latitude (numeric)
/// - location (text)
/// - Notes (text)
///
/// This class converts those session rows into the event-based `TimePunch`
/// model used by the rest of the app: separate Sign In and Sign Out events.
class SupabaseTimesheetStorage {
  static final _client = Supabase.instance.client;
  static const _uuid = Uuid();
  static final _dateFmt = DateFormat('yyyy-MM-dd');
  static const bool _externalNotificationChannelsEnabled = true;
  static bool _shouldUseEmployeeRpc({String? companyId}) =>
      companyId != null && _client.auth.currentUser == null;

  /// Anonymous company-code sessions must pass a concrete employee id for RPC.
  /// Never treat a signed-out HR tab as a worker session without an acting id
  /// (avoids empty peer-RPC results wiping the HR employee list).
  static bool _shouldUseEmployeePeerRpc({
    String? companyId,
    int? employeeIntId,
  }) =>
      companyId != null &&
      _client.auth.currentUser == null &&
      employeeIntId != null;

  static EmploymentType _parseEmploymentType(String? raw) {
    final v = (raw ?? '').trim().toLowerCase();
    if (v.contains('contract')) return EmploymentType.contract;
    if (v.contains('permanent')) return EmploymentType.permanent;
    if (v.contains('student')) return EmploymentType.student;
    return EmploymentType.partTime;
  }

  static String _defaultEmploymentTypeLabel(EmploymentType type) {
    return switch (type) {
      EmploymentType.contract => 'Contract',
      EmploymentType.permanent => 'Permanent',
      EmploymentType.student => 'Student',
      _ => 'Part-time',
    };
  }

  // ---- HR auth / company mapping -------------------------------------------

  static Future<void> signInHr({
    required String email,
    required String password,
  }) async {
    await _client.auth.signInWithPassword(email: email, password: password);
  }

  static Future<void> signOutHr() async {
    await _client.auth.signOut();
  }

  /// Sends an email **OTP** for HR self-registration (no confirmation links).
  /// Matches employee email OTP flow (`signInWithOtp` + `verifyOTP`).
  static Future<void> sendHrRegistrationEmailOtp({required String email}) async {
    await _client.auth.signInWithOtp(
      email: email.trim().toLowerCase(),
      shouldCreateUser: true,
    );
  }

  /// Keeps ASCII digits only so pasted codes (e.g. `1234 5678`) verify reliably.
  /// Supabase may send 6–8 digit OTPs depending on project settings.
  static String normalizeEmailOtpToken(String raw) {
    final buf = StringBuffer();
    for (final unit in raw.trim().codeUnits) {
      if (unit >= 0x30 && unit <= 0x39) buf.writeCharCode(unit);
    }
    return buf.toString();
  }

  static Future<void> verifyHrRegistrationEmailOtp({
    required String email,
    required String otp,
  }) async {
    final token = normalizeEmailOtpToken(otp);
    if (token.isEmpty) {
      throw AuthException('Enter the verification code from your email.');
    }
    await _client.auth.verifyOTP(
      type: OtpType.email,
      email: email.trim().toLowerCase(),
      token: token,
    );
  }

  /// Call after email OTP succeeds so HR can sign in with password later.
  static Future<void> setHrPasswordAfterRegistration({
    required String password,
  }) async {
    await _client.auth.updateUser(UserAttributes(password: password));
  }

  static Future<String?> getHrMappedCompanyIdForCurrentUser() async {
    final user = _client.auth.currentUser;
    if (user == null) return null;
    final res = await _client
        .from('hr_users')
        .select('company_id')
        .eq('auth_user_id', user.id)
        .maybeSingle();
    return res?['company_id']?.toString();
  }

  static Future<HrUserProfile?> getCurrentHrProfile() async {
    final user = _client.auth.currentUser;
    if (user == null) return null;
    Map<String, dynamic>? res;
    try {
      res = await _client
          .from('hr_users')
          .select('company_id, role, is_active, display_name')
          .eq('auth_user_id', user.id)
          .maybeSingle();
    } catch (_) {
      // Backward compatibility: older schemas may not have display_name yet.
      res = await _client
          .from('hr_users')
          .select('company_id, role, is_active')
          .eq('auth_user_id', user.id)
          .maybeSingle();
    }
    if (res == null) return null;
    return HrUserProfile(
      companyId: res['company_id'].toString(),
      role: (res['role'] as String? ?? 'viewer'),
      isActive: (res['is_active'] as bool?) ?? false,
      displayName: res['display_name'] as String?,
    );
  }

  static Future<AppReleaseConfig?> getAppReleaseConfig({
    String key = 'global',
  }) async {
    try {
      final row = await _client
          .from('app_release_config')
          .select(
            'config_key, is_enabled, latest_version, minimum_supported_version, '
            'force_update, update_url_android, update_url_ios, update_url_web',
          )
          .eq('config_key', key)
          .maybeSingle();
      if (row == null) return null;
      return AppReleaseConfig(
        key: row['config_key']?.toString() ?? key,
        isEnabled: row['is_enabled'] == true,
        latestVersion: row['latest_version']?.toString() ?? '',
        minimumSupportedVersion: row['minimum_supported_version']?.toString(),
        forceUpdate: row['force_update'] == true,
        updateUrlAndroid: row['update_url_android']?.toString(),
        updateUrlIos: row['update_url_ios']?.toString(),
        updateUrlWeb: row['update_url_web']?.toString(),
      );
    } catch (_) {
      // Table may not exist yet in local/dev databases.
      return null;
    }
  }

  static Future<void> upsertAppReleaseConfig({
    String key = 'global',
    required bool isEnabled,
    required String latestVersion,
    String? minimumSupportedVersion,
    required bool forceUpdate,
    String? updateUrlAndroid,
    String? updateUrlIos,
    String? updateUrlWeb,
  }) async {
    final payload = <String, dynamic>{
      'config_key': key,
      'is_enabled': isEnabled,
      'latest_version': latestVersion.trim(),
      'minimum_supported_version':
          (minimumSupportedVersion ?? '').trim().isEmpty
          ? null
          : minimumSupportedVersion!.trim(),
      'force_update': forceUpdate,
      'update_url_android': (updateUrlAndroid ?? '').trim().isEmpty
          ? null
          : updateUrlAndroid!.trim(),
      'update_url_ios': (updateUrlIos ?? '').trim().isEmpty
          ? null
          : updateUrlIos!.trim(),
      'update_url_web': (updateUrlWeb ?? '').trim().isEmpty
          ? null
          : updateUrlWeb!.trim(),
    };
    await _client.from('app_release_config').upsert(payload);
  }

  // ---- Employees -----------------------------------------------------------

  /// Maps a Supabase `employees` row to an [Employee] model.
  /// Single source of truth — used by both list and single-record fetches.
  static Employee _employeeFromRow(Map<String, dynamic> row) {
    return Employee(
      // Supabase returns bigint as int; store as string in app.
      id: row['id'].toString(),
      employeeCode: row['employee_code'] as String? ?? '',
      name: row['name'] as String? ?? '',
      surname: row['surname'] as String? ?? '',
      employmentDate: row['employment_date'] != null
          ? DateTime.tryParse(row['employment_date'] as String) ??
                DateTime.now()
          : DateTime.now(),
      employmentType: _parseEmploymentType(row['employment_type'] as String?),
      employmentTypeLabel:
          (row['employment_type_label'] as String?)?.trim().isNotEmpty == true
          ? row['employment_type_label'] as String
          : (row['employment_type'] as String?),
      position: row['position'] as String? ?? '',
      monthlySalary: (row['monthly_salary'] as num?)?.toDouble() ?? 0.0,
      hourlyRate: (row['hourly_rate'] as num?)?.toDouble() ?? 0.0,
      weeklyRate: (row['weekly_rate'] as num?)?.toDouble() ?? 0.0,
      dailyRate: (row['daily_rate'] as num?)?.toDouble() ?? 0.0,
      overtimeRate: (row['Overtime_rate'] as num?)?.toDouble() ?? 0.0,
      doubleTimeRate: (row['double_time_rate'] as num?)?.toDouble() ?? 0.0,
      workDaysWeekly: (row['work_days_weekly'] as num?)?.toDouble() ?? 5,
      dailyHours: (row['daily_hours'] as num?)?.toDouble() ?? 8,
      branch: row['branch'] as String? ?? '',
      managerUserId: row['manager_user_id']?.toString(),
      accessLevel: switch ((row['access_level'] as String? ?? 'employee')
          .toLowerCase()) {
        'manager' => EmployeeAccessLevel.manager,
        'hr_admin' => EmployeeAccessLevel.hrAdmin,
        _ => EmployeeAccessLevel.employee,
      },
      email: row['email'] as String?,
      phone: row['phone'] as String?,
      profileId: row['profile_id']?.toString(),
      workerType: workerTypeFromString(row['worker_type'] as String?),
    );
  }

  static Future<List<Employee>> getEmployees({
    String? companyId,
    String? actingEmployeeId,
  }) async {
    final intCid = companyId != null ? int.tryParse(companyId) : null;
    final actId =
        actingEmployeeId != null ? int.tryParse(actingEmployeeId) : null;
    if (_shouldUseEmployeePeerRpc(
      companyId: companyId,
      employeeIntId: actId,
    )) {
      if (intCid == null) return const [];
      final raw = await _client.rpc(
        'employee_list_company_peers',
        params: {'p_company_id': intCid, 'p_employee_id': actId!},
      );
      final rows =
          (raw as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      final list = rows.map(_employeeFromRow).toList();
      list.sort((a, b) => a.fullName.compareTo(b.fullName));
      return list;
    }
    final query = _client.from('employees').select();
    if (companyId != null) {
      query.eq('company_id', intCid ?? companyId);
    }
    final data = await query.order('name');
    final res = (data as List).cast<Map<String, dynamic>>();
    final list = res.map(_employeeFromRow).toList();
    list.sort((a, b) => a.fullName.compareTo(b.fullName));
    return list;
  }

  static Future<Employee?> getEmployeeById(
    String id, {
    String? companyId,
  }) async {
    final intId = int.tryParse(id);
    if (intId == null) return null;
    final query = _client.from('employees').select().eq('id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final res = await query.maybeSingle();
    if (res == null) return null;
    return _employeeFromRow(res);
  }

  static Future<String?> getCompanyIdByCode(String companyCode) async {
    final code = companyCode.trim();
    if (code.isEmpty) return null;
    final res = await _client
        .from('companies')
        .select('id')
        .eq('company_code', code)
        .maybeSingle();
    if (res == null) return null;
    return res['id']?.toString();
  }

  static Future<String?> getCompanyCodeById(String companyId) async {
    final intId = int.tryParse(companyId);
    if (intId == null) return null;
    final res = await _client
        .from('companies')
        .select('company_code')
        .eq('id', intId)
        .maybeSingle();
    return res?['company_code']?.toString();
  }

  static Future<String?> getCompanyNameById(String companyId) async {
    final intId = int.tryParse(companyId);
    if (intId == null) return null;
    final res = await _client
        .from('companies')
        .select('name')
        .eq('id', intId)
        .maybeSingle();
    return res?['name']?.toString();
  }

  static Future<CompanySettings?> getCompanySettings({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return null;
    PostgrestMap? company;
    try {
      company = await _client
          .from('companies')
          .select(
            'id, company_code, name, plan_code, plan_price_zar, max_users, '
            'subscription_active, created_at, trial_started_at, enabled_modules, dispatch_settings',
          )
          .eq('id', intCompanyId)
          .maybeSingle();
    } catch (_) {
      // Back-compat for older DBs where dispatch_settings has not been added yet.
      company = await _client
          .from('companies')
          .select(
            'id, company_code, name, plan_code, plan_price_zar, max_users, '
            'subscription_active, created_at, trial_started_at, enabled_modules',
          )
          .eq('id', intCompanyId)
          .maybeSingle();
    }
    final (employeeCount, hrCount) = await (
      _client
          .from('employees')
          .select('id')
          .eq('company_id', intCompanyId)
          .count(CountOption.exact),
      _client
          .from('hr_users')
          .select('auth_user_id')
          .eq('company_id', intCompanyId)
          .eq('is_active', true)
          .count(CountOption.exact),
    ).wait;
    if (company == null) return null;
    final trialStarted =
        DateTime.tryParse(company['trial_started_at']?.toString() ?? '') ??
        DateTime.tryParse(company['created_at']?.toString() ?? '') ??
        DateTime.now();
    return CompanySettings(
      companyId: company['id'].toString(),
      companyCode: company['company_code']?.toString() ?? '',
      companyName: company['name']?.toString() ?? '',
      planCode: company['plan_code']?.toString() ?? 'free_trial',
      planPriceZar: (company['plan_price_zar'] as num?)?.toDouble() ?? 700.0,
      maxUsers: (company['max_users'] as num?)?.toInt() ?? 20,
      subscriptionActive: (company['subscription_active'] as bool?) ?? true,
      currentUsers: employeeCount.count + hrCount.count,
      trialStartedAt: trialStarted,
      enabledModules: _parseEnabledModules(company['enabled_modules']),
      dispatchSettings: _parseDispatchSettings(company['dispatch_settings']),
    );
  }

  /// Parses the JSONB enabled_modules column into a typed Map.
  static Map<String, bool> _parseEnabledModules(dynamic raw) {
    if (raw is! Map) return const {};
    final out = <String, bool>{};
    raw.forEach((k, v) {
      if (k is String) {
        out[k] = v is bool ? v : v?.toString().toLowerCase() == 'true';
      }
    });
    return out;
  }

  static const Map<String, dynamic> _defaultDispatchSettings = {
    'workload_penalty_per_active_job': 10.0,
    'conflict_penalty': 25.0,
    'employee_preference_bonus': 8.0,
    'technician_preference_bonus': 4.0,
    'contractor_penalty': 6.0,
    'max_active_jobs': 8.0,
    'exclude_conflicts': false,
  };

  static Map<String, dynamic> _parseDispatchSettings(dynamic raw) {
    final parsed = Map<String, dynamic>.from(_defaultDispatchSettings);
    if (raw is Map) {
      raw.forEach((k, v) {
        if (k is String) parsed[k] = v;
      });
    }
    return parsed;
  }

  static Future<Map<String, dynamic>> getDispatchSettings({
    required String companyId,
  }) async {
    final settings = await getCompanySettings(companyId: companyId);
    return Map<String, dynamic>.from(
      settings?.dispatchSettings ?? _defaultDispatchSettings,
    );
  }

  static Future<void> updateDispatchSettings({
    required String companyId,
    required Map<String, dynamic> settings,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return;
    final merged = Map<String, dynamic>.from(_defaultDispatchSettings)
      ..addAll(settings);
    await _client
        .from('companies')
        .update({'dispatch_settings': merged})
        .eq('id', intCompanyId);
  }

  /// HR-only: turn a single module on or off for the company.
  static Future<void> setModuleEnabled({
    required String companyId,
    required String moduleKey,
    required bool enabled,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return;
    final settings = await getCompanySettings(companyId: companyId);
    final updated = Map<String, bool>.from(
      settings?.enabledModules ?? const {},
    );
    updated[moduleKey] = enabled;
    await _client
        .from('companies')
        .update({'enabled_modules': updated})
        .eq('id', intCompanyId);
  }

  static Future<void> updateCompanyName({
    required String companyId,
    required String name,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final cleaned = name.trim();
    if (intCompanyId == null || cleaned.isEmpty) return;
    await _client
        .from('companies')
        .update({'name': cleaned})
        .eq('id', intCompanyId);
  }

  static Future<void> updateSubscriptionPlaceholders({
    required String companyId,
    required String planCode,
    required double planPriceZar,
    required int maxUsers,
    required bool subscriptionActive,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return;
    await _client
        .from('companies')
        .update({
          'plan_code': planCode.trim().isEmpty
              ? 'basic'
              : planCode.trim().toLowerCase(),
          'plan_price_zar': planPriceZar,
          'max_users': maxUsers < 1 ? 1 : maxUsers,
          'subscription_active': subscriptionActive,
        })
        .eq('id', intCompanyId);
  }

  static Future<List<HrAccessUser>> getHrAccessUsers({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('hr_users')
        .select('auth_user_id, role, display_name, is_active')
        .eq('company_id', intCompanyId)
        .order('role')
        .order('display_name');
    return (data as List)
        .cast<Map<String, dynamic>>()
        .map(
          (r) => HrAccessUser(
            authUserId: r['auth_user_id']?.toString() ?? '',
            role: r['role']?.toString() ?? 'viewer',
            displayName: r['display_name']?.toString(),
            isActive: (r['is_active'] as bool?) ?? false,
          ),
        )
        .toList();
  }

  static Future<List<String>> getCompanyEmployeeTypes({
    required String companyId,
  }) async {
    const defaults = ['Part-time', 'Contract', 'Permanent'];
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return defaults;
    final data = await _client
        .from('company_employee_types')
        .select('name')
        .eq('company_id', intCompanyId)
        .eq('is_active', true)
        .order('name');
    final rows = (data as List).cast<Map<String, dynamic>>();
    final names = rows
        .map((r) => r['name']?.toString().trim() ?? '')
        .where((n) => n.isNotEmpty)
        .toList();
    if (names.isEmpty) return defaults;
    final merged = <String>{...defaults, ...names}.toList()
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return merged;
  }

  static Future<void> upsertCompanyEmployeeType({
    required String companyId,
    required String name,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final cleaned = name.trim();
    if (intCompanyId == null || cleaned.isEmpty) return;
    final existing = await _client
        .from('company_employee_types')
        .select('id')
        .eq('company_id', intCompanyId)
        .ilike('name', cleaned)
        .maybeSingle();
    if (existing != null) {
      await _client
          .from('company_employee_types')
          .update({'name': cleaned, 'is_active': true})
          .eq('id', existing['id']);
      return;
    }
    await _client.from('company_employee_types').insert({
      'company_id': intCompanyId,
      'name': cleaned,
      'is_active': true,
    });
  }

  static Future<void> deleteCompanyEmployeeType({
    required String companyId,
    required String name,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final cleaned = name.trim();
    if (intCompanyId == null || cleaned.isEmpty) return;
    await _client
        .from('company_employee_types')
        .update({'is_active': false})
        .eq('company_id', intCompanyId)
        .ilike('name', cleaned);
  }

  static Future<void> renameCompanyEmployeeType({
    required String companyId,
    required String oldName,
    required String newName,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final oldClean = oldName.trim();
    final newClean = newName.trim();
    if (intCompanyId == null || oldClean.isEmpty || newClean.isEmpty) return;
    if (oldClean.toLowerCase() == newClean.toLowerCase()) return;

    await upsertCompanyEmployeeType(companyId: companyId, name: newClean);

    await _client
        .from('employees')
        .update({
          'employment_type': newClean,
          'employment_type_label': newClean,
        })
        .eq('company_id', intCompanyId)
        .ilike('employment_type_label', oldClean);

    await deleteCompanyEmployeeType(companyId: companyId, name: oldClean);
  }

  static Future<List<String>> getCompanyBranches({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('company_branches')
        .select('name')
        .eq('company_id', intCompanyId)
        .eq('is_active', true)
        .order('name');
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows
        .map((r) => r['name']?.toString().trim() ?? '')
        .where((n) => n.isNotEmpty)
        .toList();
  }

  static Future<void> upsertCompanyBranch({
    required String companyId,
    required String name,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final cleaned = name.trim();
    if (intCompanyId == null || cleaned.isEmpty) return;
    final existing = await _client
        .from('company_branches')
        .select('id')
        .eq('company_id', intCompanyId)
        .ilike('name', cleaned)
        .maybeSingle();
    if (existing != null) {
      await _client
          .from('company_branches')
          .update({'name': cleaned, 'is_active': true})
          .eq('id', existing['id']);
      return;
    }
    await _client.from('company_branches').insert({
      'company_id': intCompanyId,
      'name': cleaned,
      'is_active': true,
    });
  }

  static Future<void> deleteCompanyBranch({
    required String companyId,
    required String name,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final cleaned = name.trim();
    if (intCompanyId == null || cleaned.isEmpty) return;
    await _client
        .from('company_branches')
        .update({'is_active': false})
        .eq('company_id', intCompanyId)
        .ilike('name', cleaned);
  }

  static Future<void> renameCompanyBranch({
    required String companyId,
    required String oldName,
    required String newName,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final oldClean = oldName.trim();
    final newClean = newName.trim();
    if (intCompanyId == null || oldClean.isEmpty || newClean.isEmpty) return;
    if (oldClean.toLowerCase() == newClean.toLowerCase()) return;

    // Ensure destination branch exists and is active first.
    await upsertCompanyBranch(companyId: companyId, name: newClean);

    // Propagate rename to existing records that store branch as plain text.
    await _client
        .from('employees')
        .update({'branch': newClean})
        .eq('company_id', intCompanyId)
        .ilike('branch', oldClean);
    await _client
        .from('shifts')
        .update({'branch': newClean})
        .eq('company_id', intCompanyId)
        .ilike('branch', oldClean);

    // Keep old value out of active branch catalog.
    await deleteCompanyBranch(companyId: companyId, name: oldClean);
  }

  static Future<Employee?> getEmployeeByCompanyAndCode({
    required String companyId,
    required String employeeCode,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return null;
    final code = employeeCode.trim();
    if (code.isEmpty) return null;
    Map<String, dynamic>? res;
    try {
      res = await _client
          .from('employees')
          .select()
          .eq('company_id', intCompanyId)
          .eq('employee_code', code)
          .maybeSingle();
    } catch (_) {
      // Backward compatibility: if `employee_code` does not exist yet,
      // fallback to numeric `id` lookup inside company.
      final intEmpId = int.tryParse(code);
      if (intEmpId == null) return null;
      res = await _client
          .from('employees')
          .select()
          .eq('company_id', intCompanyId)
          .eq('id', intEmpId)
          .maybeSingle();
    }
    if (res == null) return null;
    return Employee(
      id: res['id'].toString(),
      employeeCode: res['employee_code'] as String? ?? '',
      name: res['name'] as String? ?? '',
      surname: res['surname'] as String? ?? '',
      employmentDate: res['employment_date'] != null
          ? DateTime.parse(res['employment_date'] as String)
          : DateTime.now(),
      employmentType: _parseEmploymentType(res['employment_type'] as String?),
      employmentTypeLabel:
          (res['employment_type_label'] as String?)?.trim().isNotEmpty == true
          ? res['employment_type_label'] as String
          : (res['employment_type'] as String?),
      position: res['position'] as String? ?? '',
      monthlySalary: (res['monthly_salary'] as num?)?.toDouble() ?? 0.0,
      hourlyRate: (res['hourly_rate'] as num?)?.toDouble() ?? 0.0,
      workDaysWeekly: (res['work_days_weekly'] as num?)?.toDouble() ?? 5,
      dailyHours: (res['daily_hours'] as num?)?.toDouble() ?? 8,
      branch: res['branch'] as String? ?? '',
      managerUserId: res['manager_user_id']?.toString(),
    );
  }

  /// Employee login helper: resolves employee + company using tenant `company_code`.
  ///
  /// Requires DB RPC `employee_resolve_by_code(text, text)` (security definer).
  static Future<ResolvedEmployee?> getEmployeeByCompanyCodeAndCode({
    required String companyCode,
    required String employeeCode,
  }) async {
    final codeCompany = companyCode.trim();
    final codeEmployee = employeeCode.trim();
    if (codeCompany.isEmpty || codeEmployee.isEmpty) return null;

    final res = await _client.rpc(
      'employee_resolve_by_code',
      params: {'p_company_code': codeCompany, 'p_employee_code': codeEmployee},
    );

    // For table-returning SQL functions, supabase-dart typically returns a list of rows.
    final rows =
        (res as List?)?.cast<Map<String, dynamic>>() ??
        <Map<String, dynamic>>[];
    if (rows.isEmpty) return null;

    final row = rows.first;

    final employmentType = _parseEmploymentType(
      row['employment_type'] as String?,
    );

    final employmentDateRaw = row['employment_date'];
    final employmentDate = employmentDateRaw != null
        ? DateTime.tryParse(employmentDateRaw.toString()) ?? DateTime.now()
        : DateTime.now();

    return ResolvedEmployee(
      companyId: row['company_id'].toString(),
      employee: Employee(
        id: row['employee_id'].toString(),
        employeeCode: row['employee_code'] as String? ?? '',
        name: row['name'] as String? ?? '',
        surname: row['surname'] as String? ?? '',
        employmentDate: employmentDate,
        employmentType: employmentType,
        employmentTypeLabel:
            (row['employment_type_label'] as String?)?.trim().isNotEmpty == true
            ? row['employment_type_label'] as String
            : (row['employment_type'] as String?),
        position: row['position'] as String? ?? '',
        monthlySalary: (row['monthly_salary'] as num?)?.toDouble() ?? 0.0,
        hourlyRate: (row['hourly_rate'] as num?)?.toDouble() ?? 0.0,
        workDaysWeekly: (row['work_days_weekly'] as num?)?.toDouble() ?? 5,
        dailyHours: (row['daily_hours'] as num?)?.toDouble() ?? 8,
        branch: row['branch'] as String? ?? '',
        managerUserId: row['manager_user_id']?.toString(),
        accessLevel: switch ((row['access_level'] as String? ?? 'employee')
            .toLowerCase()) {
          'manager' => EmployeeAccessLevel.manager,
          'hr_admin' => EmployeeAccessLevel.hrAdmin,
          _ => EmployeeAccessLevel.employee,
        },
      ),
    );
  }

  static Future<({String code, DateTime expiresAt})?>
  generateEmployeeTempLoginCode({
    required String companyId,
    required String employeeId,
    Duration validFor = const Duration(hours: 24),
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmployeeId = int.tryParse(employeeId);
    if (intCompanyId == null || intEmployeeId == null) return null;
    final random = Random.secure();
    final code = List.generate(6, (_) => random.nextInt(10)).join();
    final expiresAt = DateTime.now().add(validFor);
    await _client
        .from('employees')
        .update({
          'temp_login_code': code,
          'temp_login_code_generated_at': DateTime.now().toIso8601String(),
          'temp_login_code_expires_at': expiresAt.toIso8601String(),
        })
        .eq('company_id', intCompanyId)
        .eq('id', intEmployeeId);
    return (code: code, expiresAt: expiresAt);
  }

  static Future<Map<String, ({DateTime? generatedAt, DateTime? expiresAt})>>
  getEmployeeTempLoginStatusByEmployee({required String companyId}) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const {};
    final data = await _client
        .from('employees')
        .select('id, temp_login_code_generated_at, temp_login_code_expires_at')
        .eq('company_id', intCompanyId);
    final rows = (data as List).cast<Map<String, dynamic>>();
    final map = <String, ({DateTime? generatedAt, DateTime? expiresAt})>{};
    for (final r in rows) {
      final id = r['id']?.toString();
      if (id == null || id.isEmpty) continue;
      final generatedAtRaw = r['temp_login_code_generated_at']?.toString();
      final expiresAtRaw = r['temp_login_code_expires_at']?.toString();
      map[id] = (
        generatedAt: generatedAtRaw == null
            ? null
            : DateTime.tryParse(generatedAtRaw),
        expiresAt: expiresAtRaw == null
            ? null
            : DateTime.tryParse(expiresAtRaw),
      );
    }
    return map;
  }

  static Future<void> insertEmployee(Employee e, {String? companyId}) async {
    final intId = int.tryParse(e.id);
    // Derive hourly rate from monthly salary, work days per week and daily hours.
    final workDays = e.workDaysWeekly > 0 ? e.workDaysWeekly : 5;
    final dailyHours = e.dailyHours > 0
        ? e.dailyHours
        : Employee.standardHoursPerDay.toDouble();
    final weeklyRate = e.monthlySalary / 4.33;
    final dailyRate = workDays > 0 ? weeklyRate / workDays : 0.0;
    final hourlyRate = dailyHours > 0 ? dailyRate / dailyHours : 0.0;

    final payload = {
      'name': e.name,
      'surname': e.surname,
      if (companyId != null) 'company_id': int.tryParse(companyId) ?? companyId,
      'employee_code': e.employeeCode.trim().isEmpty
          ? null
          : e.employeeCode.trim(),
      'position': e.position,
      'employment_date': _dateFmt.format(e.employmentDate),
      'employment_type': (e.employmentTypeLabel?.trim().isNotEmpty == true)
          ? e.employmentTypeLabel!.trim()
          : _defaultEmploymentTypeLabel(e.employmentType),
      'employment_type_label':
          (e.employmentTypeLabel?.trim().isNotEmpty == true)
          ? e.employmentTypeLabel!.trim()
          : _defaultEmploymentTypeLabel(e.employmentType),
      'monthly_salary': e.monthlySalary,
      'hourly_rate': hourlyRate,
      'weekly_rate': weeklyRate,
      'daily_rate': dailyRate,
      'work_days_weekly': workDays,
      'daily_hours': dailyHours,
      'branch': e.branch,
      'manager_user_id': e.managerUserId,
      'access_level': switch (e.accessLevel) {
        EmployeeAccessLevel.manager => 'manager',
        EmployeeAccessLevel.hrAdmin => 'hr_admin',
        _ => 'employee',
      },
      'worker_type': e.workerType.wireValue,
      if (e.email != null && e.email!.isNotEmpty)
        'email': e.email!.trim().toLowerCase(),
      if (e.phone != null && e.phone!.isNotEmpty) 'phone': e.phone!.trim(),
    };

    if (intId == null) {
      await _client.from('employees').insert(payload);
    } else {
      await _client.from('employees').insert({'id': intId, ...payload});
    }
    if (companyId != null && e.branch.trim().isNotEmpty) {
      await upsertCompanyBranch(companyId: companyId, name: e.branch.trim());
    }
    if (companyId != null &&
        (e.employmentTypeLabel?.trim().isNotEmpty == true)) {
      await upsertCompanyEmployeeType(
        companyId: companyId,
        name: e.employmentTypeLabel!.trim(),
      );
    }
  }

  static Future<String?> insertEmployeeReturningId(
    Employee e, {
    String? companyId,
  }) async {
    final workDays = e.workDaysWeekly > 0 ? e.workDaysWeekly : 5;
    final dailyHours = e.dailyHours > 0
        ? e.dailyHours
        : Employee.standardHoursPerDay.toDouble();
    final weeklyRate = e.monthlySalary / 4.33;
    final dailyRate = workDays > 0 ? weeklyRate / workDays : 0.0;
    final hourlyRate = dailyHours > 0 ? dailyRate / dailyHours : 0.0;
    final payload = {
      'name': e.name,
      'surname': e.surname,
      if (companyId != null) 'company_id': int.tryParse(companyId) ?? companyId,
      'employee_code': e.employeeCode.trim().isEmpty
          ? null
          : e.employeeCode.trim(),
      'position': e.position,
      'employment_date': _dateFmt.format(e.employmentDate),
      'employment_type': (e.employmentTypeLabel?.trim().isNotEmpty == true)
          ? e.employmentTypeLabel!.trim()
          : _defaultEmploymentTypeLabel(e.employmentType),
      'employment_type_label':
          (e.employmentTypeLabel?.trim().isNotEmpty == true)
          ? e.employmentTypeLabel!.trim()
          : _defaultEmploymentTypeLabel(e.employmentType),
      'monthly_salary': e.monthlySalary,
      'hourly_rate': hourlyRate,
      'weekly_rate': weeklyRate,
      'daily_rate': dailyRate,
      'work_days_weekly': workDays,
      'daily_hours': dailyHours,
      'branch': e.branch,
      'manager_user_id': e.managerUserId,
      'access_level': switch (e.accessLevel) {
        EmployeeAccessLevel.manager => 'manager',
        EmployeeAccessLevel.hrAdmin => 'hr_admin',
        _ => 'employee',
      },
      'worker_type': e.workerType.wireValue,
      if (e.email != null && e.email!.isNotEmpty)
        'email': e.email!.trim().toLowerCase(),
      if (e.phone != null && e.phone!.isNotEmpty) 'phone': e.phone!.trim(),
    };
    final row = await _client
        .from('employees')
        .insert(payload)
        .select('id')
        .maybeSingle();
    final id = row?['id']?.toString();
    if (companyId != null && e.branch.trim().isNotEmpty) {
      await upsertCompanyBranch(companyId: companyId, name: e.branch.trim());
    }
    if (companyId != null &&
        (e.employmentTypeLabel?.trim().isNotEmpty == true)) {
      await upsertCompanyEmployeeType(
        companyId: companyId,
        name: e.employmentTypeLabel!.trim(),
      );
    }
    return id;
  }

  static Future<void> updateEmployee(Employee e, {String? companyId}) async {
    final intId = int.tryParse(e.id);
    if (intId == null) {
      throw ArgumentError('Employee ID must be numeric to store in Supabase.');
    }
    final workDays = e.workDaysWeekly > 0 ? e.workDaysWeekly : 5;
    final dailyHours = e.dailyHours > 0
        ? e.dailyHours
        : Employee.standardHoursPerDay.toDouble();
    final weeklyRate = e.monthlySalary / 4.33;
    final dailyRate = workDays > 0 ? weeklyRate / workDays : 0.0;
    final hourlyRate = dailyHours > 0 ? dailyRate / dailyHours : 0.0;

    final query = _client
        .from('employees')
        .update({
          'name': e.name,
          'surname': e.surname,
          if (companyId != null)
            'company_id': int.tryParse(companyId) ?? companyId,
          'employee_code': e.employeeCode.trim().isEmpty
              ? null
              : e.employeeCode.trim(),
          'position': e.position,
          'employment_date': _dateFmt.format(e.employmentDate),
          'employment_type': (e.employmentTypeLabel?.trim().isNotEmpty == true)
              ? e.employmentTypeLabel!.trim()
              : _defaultEmploymentTypeLabel(e.employmentType),
          'employment_type_label':
              (e.employmentTypeLabel?.trim().isNotEmpty == true)
              ? e.employmentTypeLabel!.trim()
              : _defaultEmploymentTypeLabel(e.employmentType),
          'monthly_salary': e.monthlySalary,
          'hourly_rate': hourlyRate,
          'weekly_rate': weeklyRate,
          'daily_rate': dailyRate,
          'work_days_weekly': workDays,
          'daily_hours': dailyHours,
          'branch': e.branch,
          'manager_user_id': e.managerUserId,
          'access_level': switch (e.accessLevel) {
            EmployeeAccessLevel.manager => 'manager',
            EmployeeAccessLevel.hrAdmin => 'hr_admin',
            _ => 'employee',
          },
          'phone': e.phone?.trim().isEmpty == true ? null : e.phone?.trim(),
        })
        .eq('id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    await query;
    if (companyId != null && e.branch.trim().isNotEmpty) {
      await upsertCompanyBranch(companyId: companyId, name: e.branch.trim());
    }
    if (companyId != null &&
        (e.employmentTypeLabel?.trim().isNotEmpty == true)) {
      await upsertCompanyEmployeeType(
        companyId: companyId,
        name: e.employmentTypeLabel!.trim(),
      );
    }
  }

  static Future<void> deleteEmployee(
    String employeeId, {
    String? companyId,
  }) async {
    final intId = int.tryParse(employeeId);
    if (intId == null) return;
    final query = _client.from('employees').delete().eq('id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    await query;
  }

  // ---- Punches / sessions --------------------------------------------------

  /// Insert or update a punch, depending on its type.
  ///
  /// For Sign In: insert a new session row.
  /// For Sign Out: update the most recent open session (sign_out is null).
  static Future<void> insertPunch(TimePunch p, {String? companyId}) async {
    final intEmpId = int.tryParse(p.employeeId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    if (intEmpId == null || intCompanyId == null) {
      throw ArgumentError(
        'Employee + company must be numeric for tenant-scoped punch RPC.',
      );
    }

    await _client.rpc(
      'employee_submit_punch',
      params: {
        'p_company_id': intCompanyId,
        'p_employee_id': intEmpId,
        'p_is_sign_in': p.isSignIn,
        'p_ts': p.dateTime.toIso8601String(),
        'p_lat': p.latitude,
        'p_lon': p.longitude,
        'p_location': p.address,
        'p_notes': p.notes,
      },
    );
  }

  /// After sign-in, attach [jobId] to the open punch row for this work date.
  static Future<void> setOpenPunchJobAfterSignIn({
    required String companyId,
    required String employeeId,
    required String jobId,
    required DateTime workDate,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmpId = int.tryParse(employeeId);
    final intJobId = int.tryParse(jobId);
    if (intCompanyId == null || intEmpId == null || intJobId == null) {
      throw ArgumentError(
        'companyId, employeeId, and jobId must be numeric for setOpenPunchJob.',
      );
    }
    await _client.rpc(
      'employee_set_open_punch_job',
      params: {
        'p_company_id': intCompanyId,
        'p_employee_id': intEmpId,
        'p_job_id': intJobId,
        'p_work_date': _dateFmt.format(workDate),
      },
    );
  }

  static Future<List<TimePunch>> getAllPunches({
    DateTime? from,
    DateTime? to,
    String? companyId,
  }) async {
    final query = _client.from('punches').select();
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    if (from != null) {
      query.gte('Date', _dateFmt.format(from));
    }
    if (to != null) {
      query.lte('Date', _dateFmt.format(to));
    }
    final data = await query.order('Date', ascending: false);
    final rows = (data as List).cast<Map<String, dynamic>>();
    return _sessionsToEvents(rows);
  }

  static Future<List<TimePunch>> getPunchesForEmployee(
    String employeeId, {
    DateTime? from,
    DateTime? to,
    String? companyId,
  }) async {
    final intEmpId = int.tryParse(employeeId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    if (intEmpId == null || intCompanyId == null) return [];

    // Signed-in HR (or email-auth employees) must not use the anon worker RPC for
    // *other* employees' rows — it fails and breaks Payroll/Payments summaries.
    if (!_shouldUseEmployeeRpc(companyId: companyId)) {
      final query = _client.from('punches').select();
      query.eq('company_id', intCompanyId);
      query.eq('employees_id', intEmpId);
      if (from != null) {
        query.gte('Date', _dateFmt.format(from));
      }
      if (to != null) {
        query.lte('Date', _dateFmt.format(to));
      }
      final data = await query.order('Date', ascending: false);
      final rows = (data as List).cast<Map<String, dynamic>>();
      return _sessionsToEvents(rows);
    }

    final params = <String, dynamic>{
      'p_company_id': intCompanyId,
      'p_employee_id': intEmpId,
      if (from != null) 'p_from': _dateFmt.format(from),
      if (to != null) 'p_to': _dateFmt.format(to),
    };

    final data = await _client.rpc('employee_get_punches', params: params);
    final rows =
        (data as List?)?.cast<Map<String, dynamic>>() ??
        <Map<String, dynamic>>[];
    return _sessionsToEvents(rows);
  }

  static Future<TimePunch?> getLastPunch(
    String employeeId, {
    String? companyId,
  }) async {
    // Limit to recent 90 days to avoid loading the employee's entire history.
    final to = DateTime.now().add(const Duration(days: 1));
    final from = to.subtract(const Duration(days: 90));
    final punches = await getPunchesForEmployee(
      employeeId,
      from: from,
      to: to,
      companyId: companyId,
    );
    if (punches.isEmpty) return null;
    punches.sort((a, b) => b.dateTime.compareTo(a.dateTime));
    return punches.first;
  }

  static Future<void> updatePunchNotes(
    TimePunch punch,
    String? notes, {
    String? companyId,
  }) async {
    final intEmpId = int.tryParse(punch.employeeId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    if (intEmpId == null || intCompanyId == null) return;

    final workDate = DateTime(
      punch.dateTime.year,
      punch.dateTime.month,
      punch.dateTime.day,
    );
    await _client.rpc(
      'employee_update_punch_notes',
      params: {
        'p_company_id': intCompanyId,
        'p_employee_id': intEmpId,
        'p_date': _dateFmt.format(workDate),
        'p_notes': notes,
      },
    );
  }

  static Future<void> updatePunchLocation(
    TimePunch punch,
    String address,
  ) async {
    final intEmpId = int.tryParse(punch.employeeId);
    if (intEmpId == null) return;
    final workDate = DateTime(
      punch.dateTime.year,
      punch.dateTime.month,
      punch.dateTime.day,
    );
    final dateStr = _dateFmt.format(workDate);

    final data = await _client
        .from('punches')
        .select()
        .eq('employees_id', intEmpId)
        .eq('Date', dateStr)
        .order('id', ascending: false)
        .limit(1);
    final rows = (data as List).cast<Map<String, dynamic>>();
    if (rows.isEmpty) return;

    final sessionId = rows.first['id'];
    await _client
        .from('punches')
        .update({'location': address})
        .eq('id', sessionId);
  }

  static List<TimePunch> _sessionsToEvents(List<Map<String, dynamic>> rows) {
    final result = <TimePunch>[];
    for (final row in rows) {
      final empId = (row['employees_id'] ?? '').toString();
      final dateStr = row['Date'] as String?;
      if (dateStr == null || dateStr.isEmpty) continue;
      final location = row['location'] as String?;
      final notes = row['Notes'] as String?;
      final lat = (row['latitude'] as num?)?.toDouble();
      final lon = (row['longitude'] as num?)?.toDouble();
      final jobIdStr = row['job_id']?.toString();

      final signIn = row['sign_in'] as String?;
      if (signIn != null) {
        final dt = DateTime.tryParse('${dateStr}T$signIn');
        if (dt != null) {
          result.add(
            TimePunch(
              employeeId: empId,
              type: PunchType.signIn,
              dateTime: dt,
              latitude: lat,
              longitude: lon,
              address: location,
              notes: notes,
              jobId: jobIdStr,
            ),
          );
        }
      }

      final signOut = row['sign_out'] as String?;
      if (signOut != null) {
        final dt = DateTime.tryParse('${dateStr}T$signOut');
        if (dt != null) {
          result.add(
            TimePunch(
              employeeId: empId,
              type: PunchType.signOut,
              dateTime: dt,
              latitude: lat,
              longitude: lon,
              address: location,
              notes: notes,
            ),
          );
        }
      }
    }
    result.sort((a, b) => b.dateTime.compareTo(a.dateTime));
    return result;
  }

  // ---- Clients & Sites ------------------------------------------------------

  static Client _clientFromRow(Map<String, dynamic> row) {
    return Client(
      id: row['id'].toString(),
      name: row['name'] as String? ?? '',
      companyId: row['company_id']?.toString(),
      address: row['address'] as String?,
      contactPerson: row['contact_person'] as String?,
      phone: row['phone'] as String?,
      email: row['email'] as String?,
      notes: row['notes'] as String?,
      clientType: clientTypeFromString(row['client_type'] as String?),
      linkedCompanyId: row['linked_company_id']?.toString(),
      sourceContractorId: row['source_contractor_id']?.toString(),
    );
  }

  static Future<List<Client>> getClients({String? companyId}) async {
    final query = _client.from('clients').select();
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query.order('name');
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows.map(_clientFromRow).toList();
  }

  static Future<void> upsertClient(Client client, {String? companyId}) async {
    final intId = int.tryParse(client.id);
    final payload = {
      if (companyId != null) 'company_id': int.tryParse(companyId) ?? companyId,
      'name': client.name,
      'address': client.address,
      'contact_person': client.contactPerson,
      'phone': client.phone,
      'email': client.email,
      'notes': client.notes,
      'client_type': client.clientType.wireValue,
      'linked_company_id': int.tryParse(client.linkedCompanyId ?? ''),
      'source_contractor_id': int.tryParse(client.sourceContractorId ?? ''),
    };
    if (intId == null) {
      await _client.from('clients').insert(payload);
    } else {
      await _client.from('clients').upsert({'id': intId, ...payload});
    }
  }

  static Future<Client?> findClientByName(
    String name, {
    String? companyId,
  }) async {
    final n = name.trim();
    if (n.isEmpty) return null;
    final query = _client.from('clients').select().ilike('name', n);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final res = await query.maybeSingle();
    if (res == null) return null;
    return _clientFromRow(res);
  }

  static Future<Client> createClientReturning(
    Client client, {
    String? companyId,
  }) async {
    final payload = {
      if (companyId != null) 'company_id': int.tryParse(companyId) ?? companyId,
      'name': client.name,
      'address': client.address,
      'contact_person': client.contactPerson,
      'phone': client.phone,
      'email': client.email,
      'notes': client.notes,
      'client_type': client.clientType.wireValue,
      'linked_company_id': int.tryParse(client.linkedCompanyId ?? ''),
      'source_contractor_id': int.tryParse(client.sourceContractorId ?? ''),
    };
    final res = await _client
        .from('clients')
        .insert(payload)
        .select()
        .maybeSingle();
    if (res == null) {
      throw StateError('Failed to create client.');
    }
    return _clientFromRow(res);
  }

  /// Creates a [ClientType.property] client and its first [Site] so the estate
  /// appears under Clients and Property Management in one step.
  static Future<Site> createPropertyClientAndSiteReturning({
    required String companyId,
    required String propertyName,
    String? address,
    String? contactPerson,
    String? phone,
    String? email,
    String? notes,
  }) async {
    final name = propertyName.trim();
    if (name.isEmpty) {
      throw ArgumentError('Property name is required.');
    }
    String? nz(String? s) {
      final t = s?.trim() ?? '';
      return t.isEmpty ? null : t;
    }

    final client = await createClientReturning(
      Client(
        id: '',
        name: name,
        address: nz(address),
        contactPerson: nz(contactPerson),
        phone: nz(phone),
        email: nz(email),
        notes: nz(notes),
        clientType: ClientType.property,
      ),
      companyId: companyId,
    );

    final site = Site(
      id: '',
      clientId: client.id,
      name: name,
      address: nz(address),
      latitude: null,
      longitude: null,
      notes: nz(notes),
    );
    return createSiteReturning(site, companyId: companyId);
  }

  /// Lists every unit attached to a client (across all of its sites). Used
  /// by the client detail "Units" tab and the cascading unit dropdown on
  /// job creation. Empty list when the client has no sites yet.
  static Future<List<Unit>> getUnitsForClient({
    required String companyId,
    required String clientId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intClientId = int.tryParse(clientId);
    if (intCompanyId == null || intClientId == null) return const [];
    // Find this client's sites first.
    final sitesData = await _client
        .from('sites')
        .select('id')
        .eq('company_id', intCompanyId)
        .eq('client_id', intClientId);
    final siteIds = (sitesData as List)
        .cast<Map<String, dynamic>>()
        .map((r) => r['id'])
        .toList();
    if (siteIds.isEmpty) return const [];
    final unitsData = await _client
        .from('units')
        .select()
        .eq('company_id', intCompanyId)
        .inFilter('site_id', siteIds)
        .order('unit_number');
    return (unitsData as List)
        .cast<Map<String, dynamic>>()
        .map(_unitFromRow)
        .toList();
  }

  /// Inserts a unit attached to a client. Calls the
  /// `ensure_client_primary_site` RPC so units cascade cleanly even when
  /// the user has not manually created a site for the client. Use this
  /// for property-type clients.
  static Future<Unit> insertUnitForClient({
    required String companyId,
    required String clientId,
    required Unit unit,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intClientId = int.tryParse(clientId);
    if (intCompanyId == null || intClientId == null) {
      throw ArgumentError('Invalid company_id or client_id');
    }
    final siteIdRaw = await _client.rpc(
      'ensure_client_primary_site',
      params: {'p_client_id': intClientId},
    );
    final siteId = siteIdRaw?.toString();
    if (siteId == null || siteId.isEmpty) {
      throw StateError('Could not resolve a site for this client.');
    }
    return insertUnitReturning(
      companyId: companyId,
      unit: unit.copyWith(siteId: siteId),
    );
  }

  static Future<void> deleteClient(String id, {String? companyId}) async {
    final intId = int.tryParse(id);
    if (intId == null) return;
    final query = _client.from('clients').delete().eq('id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    await query;
  }

  static Future<Client?> getClientById(String id, {String? companyId}) async {
    final intId = int.tryParse(id);
    if (intId == null) return null;
    final query = _client.from('clients').select().eq('id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final res = await query.maybeSingle();
    if (res == null) return null;
    return _clientFromRow(res);
  }

  static Future<List<Job>> getJobsForClient(
    String clientId, {
    String? companyId,
  }) async {
    final intId = int.tryParse(clientId);
    if (intId == null) return [];
    final query = _client.from('jobs').select().eq('client_id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query.order('scheduled_start', ascending: false);
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows.map((row) {
      final assigned =
          (row['assigned_employee_ids'] as List?)
              ?.map((e) => e.toString())
              .toList() ??
          <String>[];
      return Job(
        id: row['id'].toString(),
        title: row['title'] as String? ?? '',
        description: row['description'] as String?,
        clientId: row['client_id'].toString(),
        siteId: row['site_id']?.toString(),
        scheduledStart: row['scheduled_start'] != null
            ? DateTime.parse(row['scheduled_start'] as String)
            : null,
        scheduledEnd: row['scheduled_end'] != null
            ? DateTime.parse(row['scheduled_end'] as String)
            : null,
        status: _statusFromString(row['status'] as String?),
        assignedEmployeeIds: assigned,
      );
    }).toList();
  }

  static Future<List<Map<String, dynamic>>> getClientDeals({
    required String companyId,
    required String clientId,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    if (cid == null || clid == null) return [];
    final data = await _client
        .from('client_deals')
        .select()
        .eq('company_id', cid)
        .eq('client_id', clid)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<List<Map<String, dynamic>>> getCompanyClientDeals({
    required String companyId,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null) return [];
    final data = await _client
        .from('client_deals')
        .select()
        .eq('company_id', cid)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<String?> upsertClientDealReturningId({
    required String companyId,
    required String clientId,
    String? dealId,
    required String title,
    required String status,
    double? offerAmount,
    String? jobId,
    DateTime? expectedCloseDate,
    String? notes,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    final did = int.tryParse(dealId ?? '');
    final jid = int.tryParse(jobId ?? '');
    if (cid == null || clid == null) return null;
    final payload = {
      'company_id': cid,
      'client_id': clid,
      'title': title,
      'status': status,
      'offer_amount': offerAmount ?? 0,
      'job_id': jid,
      'expected_close_date': expectedCloseDate == null
          ? null
          : DateFormat('yyyy-MM-dd').format(expectedCloseDate),
      'notes': notes,
    };
    final row = did == null
        ? await _client
              .from('client_deals')
              .insert(payload)
              .select('id')
              .maybeSingle()
        : await _client
              .from('client_deals')
              .upsert({'id': did, ...payload})
              .select('id')
              .maybeSingle();
    return row?['id']?.toString();
  }

  static Future<void> upsertClientDeal({
    required String companyId,
    required String clientId,
    String? dealId,
    required String title,
    required String status,
    double? offerAmount,
    String? jobId,
    DateTime? expectedCloseDate,
    String? notes,
  }) async {
    await upsertClientDealReturningId(
      companyId: companyId,
      clientId: clientId,
      dealId: dealId,
      title: title,
      status: status,
      offerAmount: offerAmount,
      jobId: jobId,
      expectedCloseDate: expectedCloseDate,
      notes: notes,
    );
  }

  static Future<void> deleteClientDeal({
    required String companyId,
    required String dealId,
  }) async {
    final cid = int.tryParse(companyId);
    final did = int.tryParse(dealId);
    if (cid == null || did == null) return;
    await _client
        .from('client_deals')
        .delete()
        .eq('company_id', cid)
        .eq('id', did);
  }

  static Future<void> setClientDealJob({
    required String companyId,
    required String dealId,
    required String jobId,
  }) async {
    final cid = int.tryParse(companyId);
    final did = int.tryParse(dealId);
    final jid = int.tryParse(jobId);
    if (cid == null || did == null || jid == null) return;
    await _client
        .from('client_deals')
        .update({'job_id': jid})
        .eq('company_id', cid)
        .eq('id', did);
    // Keep the reverse FK in sync so job detail references can always
    // resolve client_deals (project) <-> jobs even across environments.
    await _client
        .from('jobs')
        .update({'deal_id': did})
        .eq('company_id', cid)
        .eq('id', jid);
  }

  static Future<List<Map<String, dynamic>>> getClientPayments({
    required String companyId,
    required String clientId,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    if (cid == null || clid == null) return [];
    final data = await _client
        .from('client_payments')
        .select()
        .eq('company_id', cid)
        .eq('client_id', clid)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<List<Map<String, dynamic>>> getCompanyClientPayments({
    required String companyId,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null) return [];
    final data = await _client
        .from('client_payments')
        .select()
        .eq('company_id', cid)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> upsertClientPayment({
    required String companyId,
    required String clientId,
    String? paymentId,
    String? dealId,
    required String description,
    required double amountDue,
    DateTime? dueDate,
    DateTime? paidAt,
    required String status,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    final pid = int.tryParse(paymentId ?? '');
    final did = int.tryParse(dealId ?? '');
    if (cid == null || clid == null) return;
    final payload = {
      'company_id': cid,
      'client_id': clid,
      'deal_id': did,
      'description': description,
      'amount_due': amountDue,
      'due_date': dueDate == null
          ? null
          : DateFormat('yyyy-MM-dd').format(dueDate),
      'paid_at': paidAt?.toIso8601String(),
      'status': status,
    };
    if (pid == null) {
      await _client.from('client_payments').insert(payload);
    } else {
      await _client.from('client_payments').upsert({'id': pid, ...payload});
    }
  }

  static Future<void> deleteClientPayment({
    required String companyId,
    required String paymentId,
  }) async {
    final cid = int.tryParse(companyId);
    final pid = int.tryParse(paymentId);
    if (cid == null || pid == null) return;
    await _client
        .from('client_payments')
        .delete()
        .eq('company_id', cid)
        .eq('id', pid);
  }

  static Future<List<Map<String, dynamic>>> getClientNotes({
    required String companyId,
    required String clientId,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    if (cid == null || clid == null) return [];
    final data = await _client
        .from('client_notes')
        .select()
        .eq('company_id', cid)
        .eq('client_id', clid)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> addClientNote({
    required String companyId,
    required String clientId,
    required String note,
    String? dealId,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    final did = int.tryParse(dealId ?? '');
    if (cid == null || clid == null) return;
    await _client.from('client_notes').insert({
      'company_id': cid,
      'client_id': clid,
      'deal_id': did,
      'note': note,
      'created_by': _client.auth.currentUser?.id,
    });
  }

  static Future<void> deleteClientNote({
    required String companyId,
    required String noteId,
  }) async {
    final cid = int.tryParse(companyId);
    final nid = int.tryParse(noteId);
    if (cid == null || nid == null) return;
    await _client
        .from('client_notes')
        .delete()
        .eq('company_id', cid)
        .eq('id', nid);
  }

  static Future<List<Map<String, dynamic>>> getClientFiles({
    required String companyId,
    required String clientId,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    if (cid == null || clid == null) return [];
    final data = await _client
        .from('client_files')
        .select()
        .eq('company_id', cid)
        .eq('client_id', clid)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> addClientFile({
    required String companyId,
    required String clientId,
    String? dealId,
    required String fileName,
    required String fileUrl,
    required String fileType,
    required int sizeBytes,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    final did = int.tryParse(dealId ?? '');
    if (cid == null || clid == null) return;
    await _client.from('client_files').insert({
      'company_id': cid,
      'client_id': clid,
      'deal_id': did,
      'file_name': fileName,
      'file_url': fileUrl,
      'file_type': fileType,
      'size_bytes': sizeBytes,
      'uploaded_by': _client.auth.currentUser?.id,
    });
  }

  static Future<void> deleteClientFile({
    required String companyId,
    required String fileId,
  }) async {
    final cid = int.tryParse(companyId);
    final fid = int.tryParse(fileId);
    if (cid == null || fid == null) return;
    await _client
        .from('client_files')
        .delete()
        .eq('company_id', cid)
        .eq('id', fid);
  }

  static Future<List<Site>> getSitesForClient(
    String clientId, {
    String? companyId,
  }) async {
    final intId = int.tryParse(clientId);
    if (intId == null) return [];
    final query = _client.from('sites').select().eq('client_id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query.order('name');
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows
        .map(
          (row) => Site(
            id: row['id'].toString(),
            clientId: row['client_id'].toString(),
            name: row['name'] as String? ?? '',
            address: row['address'] as String?,
            latitude: (row['latitude'] as num?)?.toDouble(),
            longitude: (row['longitude'] as num?)?.toDouble(),
            notes: row['notes'] as String?,
          ),
        )
        .toList();
  }

  static Future<void> upsertSite(Site site, {String? companyId}) async {
    final intId = int.tryParse(site.id);
    final clientIntId = int.tryParse(site.clientId);
    if (clientIntId == null) return;
    final payload = {
      if (companyId != null) 'company_id': int.tryParse(companyId) ?? companyId,
      'client_id': clientIntId,
      'name': site.name,
      'address': site.address,
      'latitude': site.latitude,
      'longitude': site.longitude,
      'notes': site.notes,
    };
    if (intId == null) {
      await _client.from('sites').insert(payload);
    } else {
      await _client.from('sites').upsert({'id': intId, ...payload});
    }
  }

  static Future<Site> createSiteReturning(
    Site site, {
    String? companyId,
  }) async {
    final clientIntId = int.tryParse(site.clientId);
    if (clientIntId == null) {
      throw ArgumentError('clientId must be numeric.');
    }
    final payload = {
      if (companyId != null) 'company_id': int.tryParse(companyId) ?? companyId,
      'client_id': clientIntId,
      'name': site.name,
      'address': site.address,
      'latitude': site.latitude,
      'longitude': site.longitude,
      'notes': site.notes,
    };
    final res = await _client
        .from('sites')
        .insert(payload)
        .select()
        .maybeSingle();
    if (res == null) {
      throw StateError('Failed to create site.');
    }
    return Site(
      id: res['id'].toString(),
      clientId: res['client_id'].toString(),
      name: res['name'] as String? ?? '',
      address: res['address'] as String?,
      latitude: (res['latitude'] as num?)?.toDouble(),
      longitude: (res['longitude'] as num?)?.toDouble(),
      notes: res['notes'] as String?,
    );
  }

  static Future<void> deleteSite(String id, {String? companyId}) async {
    final intId = int.tryParse(id);
    if (intId == null) return;
    final query = _client.from('sites').delete().eq('id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    await query;
  }

  static Future<Site?> getSiteById(String id, {String? companyId}) async {
    final intId = int.tryParse(id);
    if (intId == null) return null;
    final query = _client.from('sites').select().eq('id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final res = await query.maybeSingle();
    if (res == null) return null;
    return Site(
      id: res['id'].toString(),
      clientId: res['client_id'].toString(),
      name: res['name'] as String? ?? '',
      address: res['address'] as String?,
      latitude: (res['latitude'] as num?)?.toDouble(),
      longitude: (res['longitude'] as num?)?.toDouble(),
      notes: res['notes'] as String?,
    );
  }

  /// Returns every site for the company (across all clients). Used by the
  /// Properties screen as the top-level list of complexes/estates.
  static Future<List<Site>> getCompanySites({required String companyId}) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final data = await _client
        .from('sites')
        .select()
        .eq('company_id', intCompanyId)
        .order('name');
    return (data as List).cast<Map<String, dynamic>>().map((row) {
      return Site(
        id: row['id'].toString(),
        clientId: row['client_id']?.toString() ?? '',
        name: row['name'] as String? ?? '',
        address: row['address'] as String?,
        latitude: (row['latitude'] as num?)?.toDouble(),
        longitude: (row['longitude'] as num?)?.toDouble(),
        notes: row['notes'] as String?,
      );
    }).toList();
  }

  // ---- Units & Residents (Property Management) -----------------------------

  static Unit _unitFromRow(Map<String, dynamic> row) {
    return Unit(
      id: row['id'].toString(),
      siteId: row['site_id']?.toString() ?? '',
      unitNumber: row['unit_number'] as String? ?? '',
      label: row['label'] as String?,
      occupancyStatus: row['occupancy_status'] as String? ?? 'occupied',
      floor: row['floor'] as String?,
      notes: row['notes'] as String?,
    );
  }

  /// Lists every unit for a company, ordered by site then unit number.
  static Future<List<Unit>> getUnitsForCompany({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final data = await _client
        .from('units')
        .select()
        .eq('company_id', intCompanyId)
        .order('site_id')
        .order('unit_number');
    return (data as List)
        .cast<Map<String, dynamic>>()
        .map(_unitFromRow)
        .toList();
  }

  /// Lists units within a single site.
  static Future<List<Unit>> getUnitsForSite({
    required String companyId,
    required String siteId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intSiteId = int.tryParse(siteId);
    if (intCompanyId == null || intSiteId == null) return const [];
    final data = await _client
        .from('units')
        .select()
        .eq('company_id', intCompanyId)
        .eq('site_id', intSiteId)
        .order('unit_number');
    return (data as List)
        .cast<Map<String, dynamic>>()
        .map(_unitFromRow)
        .toList();
  }

  /// Returns a map of siteId -> unit count for the given company. Used by
  /// the Properties list to show "12 units" badges per complex.
  static Future<Map<String, int>> getUnitCountsBySite({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const {};
    // Single round-trip: pull only site_id, count client-side.
    final data = await _client
        .from('units')
        .select('site_id')
        .eq('company_id', intCompanyId);
    final out = <String, int>{};
    for (final row in (data as List).cast<Map<String, dynamic>>()) {
      final id = row['site_id']?.toString();
      if (id == null) continue;
      out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }

  static Future<Unit> insertUnitReturning({
    required String companyId,
    required Unit unit,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intSiteId = int.tryParse(unit.siteId);
    if (intCompanyId == null || intSiteId == null) {
      throw ArgumentError('Invalid company_id or site_id');
    }
    final payload = {
      'company_id': intCompanyId,
      'site_id': intSiteId,
      'unit_number': unit.unitNumber.trim(),
      'label': unit.label?.trim(),
      'occupancy_status': unit.occupancyStatus,
      'floor': unit.floor?.trim(),
      'notes': unit.notes?.trim(),
    };
    final res = await _client.from('units').insert(payload).select().single();
    return _unitFromRow(Map<String, dynamic>.from(res));
  }

  static Future<void> updateUnit({required Unit unit}) async {
    final intId = int.tryParse(unit.id);
    if (intId == null) return;
    await _client
        .from('units')
        .update({
          'unit_number': unit.unitNumber.trim(),
          'label': unit.label?.trim(),
          'occupancy_status': unit.occupancyStatus,
          'floor': unit.floor?.trim(),
          'notes': unit.notes?.trim(),
        })
        .eq('id', intId);
  }

  static Future<void> deleteUnit({required String unitId}) async {
    final intId = int.tryParse(unitId);
    if (intId == null) return;
    await _client.from('units').delete().eq('id', intId);
  }

  static Resident _residentFromRow(Map<String, dynamic> row) {
    DateTime? parseDate(dynamic v) =>
        v == null ? null : DateTime.tryParse(v.toString());
    return Resident(
      id: row['id'].toString(),
      unitId: row['unit_id']?.toString() ?? '',
      fullName: row['full_name'] as String? ?? '',
      phone: row['phone'] as String?,
      email: row['email'] as String?,
      moveInDate: parseDate(row['move_in_date']),
      moveOutDate: parseDate(row['move_out_date']),
      isPrimary: (row['is_primary'] as bool?) ?? true,
      notes: row['notes'] as String?,
    );
  }

  static Future<List<Resident>> getResidentsForCompany({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final data = await _client
        .from('residents')
        .select()
        .eq('company_id', intCompanyId)
        .order('full_name');
    return (data as List)
        .cast<Map<String, dynamic>>()
        .map(_residentFromRow)
        .toList();
  }

  static Future<List<Resident>> getResidentsForUnit({
    required String companyId,
    required String unitId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intUnitId = int.tryParse(unitId);
    if (intCompanyId == null || intUnitId == null) return const [];
    final data = await _client
        .from('residents')
        .select()
        .eq('company_id', intCompanyId)
        .eq('unit_id', intUnitId)
        .order('full_name');
    return (data as List)
        .cast<Map<String, dynamic>>()
        .map(_residentFromRow)
        .toList();
  }

  /// All residents linked to any of [unitIds] (e.g. units under one site).
  static Future<List<Resident>> getResidentsForUnits({
    required String companyId,
    required List<String> unitIds,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null || unitIds.isEmpty) return const [];
    final intUnitIds =
        unitIds.map(int.tryParse).whereType<int>().toList(growable: false);
    if (intUnitIds.isEmpty) return const [];
    final data = await _client
        .from('residents')
        .select()
        .eq('company_id', intCompanyId)
        .inFilter('unit_id', intUnitIds);
    final list = (data as List)
        .cast<Map<String, dynamic>>()
        .map(_residentFromRow)
        .toList();
    list.sort((a, b) {
      final byUnit = a.unitId.compareTo(b.unitId);
      if (byUnit != 0) return byUnit;
      if (a.isPrimary != b.isPrimary) {
        return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0);
      }
      return a.fullName.toLowerCase().compareTo(b.fullName.toLowerCase());
    });
    return list;
  }

  static Future<Resident> insertResidentReturning({
    required String companyId,
    required Resident resident,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intUnitId = int.tryParse(resident.unitId);
    if (intCompanyId == null || intUnitId == null) {
      throw ArgumentError('Invalid company_id or unit_id');
    }
    final payload = {
      'company_id': intCompanyId,
      'unit_id': intUnitId,
      'full_name': resident.fullName.trim(),
      'phone': resident.phone?.trim(),
      'email': resident.email?.trim().toLowerCase(),
      'move_in_date': resident.moveInDate != null
          ? _dateFmt.format(resident.moveInDate!)
          : null,
      'move_out_date': resident.moveOutDate != null
          ? _dateFmt.format(resident.moveOutDate!)
          : null,
      'is_primary': resident.isPrimary,
      'notes': resident.notes?.trim(),
    };
    final res = await _client
        .from('residents')
        .insert(payload)
        .select()
        .single();
    return _residentFromRow(Map<String, dynamic>.from(res));
  }

  static Future<void> updateResident({required Resident resident}) async {
    final intId = int.tryParse(resident.id);
    if (intId == null) return;
    await _client
        .from('residents')
        .update({
          'full_name': resident.fullName.trim(),
          'phone': resident.phone?.trim(),
          'email': resident.email?.trim().toLowerCase(),
          'move_in_date': resident.moveInDate != null
              ? _dateFmt.format(resident.moveInDate!)
              : null,
          'move_out_date': resident.moveOutDate != null
              ? _dateFmt.format(resident.moveOutDate!)
              : null,
          'is_primary': resident.isPrimary,
          'notes': resident.notes?.trim(),
        })
        .eq('id', intId);
  }

  static Future<void> deleteResident({required String residentId}) async {
    final intId = int.tryParse(residentId);
    if (intId == null) return;
    await _client.from('residents').delete().eq('id', intId);
  }

  // ---- Assets & Compliance ------------------------------------------------

  static Asset _assetFromRow(Map<String, dynamic> row) {
    DateTime? parseDate(dynamic v) =>
        v == null ? null : DateTime.tryParse(v.toString());
    return Asset(
      id: row['id'].toString(),
      siteId: row['site_id']?.toString() ?? '',
      unitId: row['unit_id']?.toString(),
      assetType: row['asset_type'] as String? ?? '',
      label: row['label'] as String? ?? '',
      manufacturer: row['manufacturer'] as String?,
      modelNumber: row['model_number'] as String?,
      serialNumber: row['serial_number'] as String?,
      installDate: parseDate(row['install_date']),
      warrantyExpires: parseDate(row['warranty_expires']),
      status: row['status'] as String? ?? 'active',
      notes: row['notes'] as String?,
    );
  }

  static Future<List<Asset>> getAssetsForCompany({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final data = await _client
        .from('assets')
        .select()
        .eq('company_id', intCompanyId)
        .order('site_id')
        .order('label');
    return (data as List)
        .cast<Map<String, dynamic>>()
        .map(_assetFromRow)
        .toList();
  }

  static Future<Asset> insertAssetReturning({
    required String companyId,
    required Asset asset,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intSiteId = int.tryParse(asset.siteId);
    final intUnitId = asset.unitId != null ? int.tryParse(asset.unitId!) : null;
    if (intCompanyId == null || intSiteId == null) {
      throw ArgumentError('Invalid company_id or site_id');
    }
    final payload = {
      'company_id': intCompanyId,
      'site_id': intSiteId,
      'unit_id': intUnitId,
      'asset_type': asset.assetType.trim(),
      'label': asset.label.trim(),
      'manufacturer': asset.manufacturer?.trim(),
      'model_number': asset.modelNumber?.trim(),
      'serial_number': asset.serialNumber?.trim(),
      'install_date': asset.installDate != null
          ? _dateFmt.format(asset.installDate!)
          : null,
      'warranty_expires': asset.warrantyExpires != null
          ? _dateFmt.format(asset.warrantyExpires!)
          : null,
      'status': asset.status,
      'notes': asset.notes?.trim(),
    };
    final res = await _client.from('assets').insert(payload).select().single();
    return _assetFromRow(Map<String, dynamic>.from(res));
  }

  static Future<void> updateAsset({required Asset asset}) async {
    final intId = int.tryParse(asset.id);
    if (intId == null) return;
    final intUnitId = asset.unitId != null ? int.tryParse(asset.unitId!) : null;
    await _client
        .from('assets')
        .update({
          'unit_id': intUnitId,
          'asset_type': asset.assetType.trim(),
          'label': asset.label.trim(),
          'manufacturer': asset.manufacturer?.trim(),
          'model_number': asset.modelNumber?.trim(),
          'serial_number': asset.serialNumber?.trim(),
          'install_date': asset.installDate != null
              ? _dateFmt.format(asset.installDate!)
              : null,
          'warranty_expires': asset.warrantyExpires != null
              ? _dateFmt.format(asset.warrantyExpires!)
              : null,
          'status': asset.status,
          'notes': asset.notes?.trim(),
        })
        .eq('id', intId);
  }

  static Future<void> deleteAsset({required String assetId}) async {
    final intId = int.tryParse(assetId);
    if (intId == null) return;
    await _client.from('assets').delete().eq('id', intId);
  }

  /// Returns the compliance calendar — one row per active asset with
  /// inspection status, days until next due, and certificate status.
  /// Backed by `v_compliance_calendar`.
  static Future<List<ComplianceEntry>> getComplianceCalendar({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final data = await _client
        .from('v_compliance_calendar')
        .select()
        .eq('company_id', intCompanyId)
        .order('inspection_status')
        .order('next_due_date');
    return (data as List).cast<Map<String, dynamic>>().map((row) {
      DateTime? parseTs(dynamic v) =>
          v == null ? null : DateTime.tryParse(v.toString());
      return ComplianceEntry(
        assetId: row['asset_id'].toString(),
        assetLabel: row['asset_label'] as String? ?? '',
        assetType: row['asset_type'] as String? ?? '',
        siteName: row['site_name'] as String?,
        unitNumber: row['unit_number'] as String?,
        inspectionType: row['inspection_type'] as String?,
        frequencyMonths: (row['frequency_months'] as num?)?.toInt(),
        lastCompletedAt: parseTs(row['last_completed_at']),
        nextDueDate: parseTs(row['next_due_date']),
        inspectionStatus: row['inspection_status'] as String? ?? 'no_schedule',
        daysUntilDue: (row['days_until_due'] as num?)?.toInt(),
        certificateType: row['certificate_type'] as String?,
        certIssuedAt: parseTs(row['cert_issued_at']),
        certExpiresAt: parseTs(row['cert_expires_at']),
        certificateStatus:
            row['certificate_status'] as String? ?? 'no_certificate',
      );
    }).toList();
  }

  static Future<Map<String, int>> generatePreventiveJobsFromDueInspections({
    required String companyId,
    int daysAhead = 30,
    bool autoAssignBestWorker = false,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) {
      return const {
        'created': 0,
        'skipped_existing': 0,
        'skipped_missing_site_client': 0,
      };
    }

    final today = DateTime.now();
    final cutoff = DateTime(
      today.year,
      today.month,
      today.day,
    ).add(Duration(days: daysAhead));
    final cutoffDate = _dateFmt.format(cutoff);

    final schedules =
        (await _client
                    .from('inspection_schedules')
                    .select(
                      'id, asset_id, inspection_type, next_due_date, assets(id, site_id, unit_id, label, asset_type, status)',
                    )
                    .eq('company_id', intCompanyId)
                    .eq('is_active', true)
                    .lte('next_due_date', cutoffDate)
                as List)
            .cast<Map<String, dynamic>>();
    if (schedules.isEmpty) {
      return const {
        'created': 0,
        'skipped_existing': 0,
        'skipped_missing_site_client': 0,
      };
    }

    final sites =
        (await _client
                    .from('sites')
                    .select('id, client_id')
                    .eq('company_id', intCompanyId)
                as List)
            .cast<Map<String, dynamic>>();
    final clientBySite = <String, String>{
      for (final s in sites)
        if (s['id'] != null && s['client_id'] != null)
          s['id'].toString(): s['client_id'].toString(),
    };

    final refs = schedules.map((s) {
      final due = DateTime.tryParse(s['next_due_date']?.toString() ?? '');
      final dayKey = due == null ? 'na' : DateFormat('yyyyMMdd').format(due);
      return 'pm_sched:${s['id']}:$dayKey';
    }).toSet();
    final existingRows = refs.isEmpty
        ? const <Map<String, dynamic>>[]
        : (await _client
                      .from('jobs')
                      .select('external_ref')
                      .eq('company_id', intCompanyId)
                      .inFilter('external_ref', refs.toList())
                  as List)
              .cast<Map<String, dynamic>>();
    final existingRefs = existingRows
        .map((r) => r['external_ref']?.toString())
        .whereType<String>()
        .toSet();

    int created = 0;
    int skippedExisting = 0;
    int skippedMissingSiteClient = 0;

    for (final s in schedules) {
      final due = DateTime.tryParse(s['next_due_date']?.toString() ?? '');
      if (due == null) continue;
      final asset = s['assets'] is Map<String, dynamic>
          ? Map<String, dynamic>.from(s['assets'] as Map<String, dynamic>)
          : <String, dynamic>{};
      final assetStatus = (asset['status']?.toString() ?? 'active')
          .toLowerCase();
      if (assetStatus != 'active') continue;
      final siteId = asset['site_id']?.toString();
      final clientId = siteId == null ? null : clientBySite[siteId];
      if (siteId == null || clientId == null) {
        skippedMissingSiteClient++;
        continue;
      }
      final dayKey = DateFormat('yyyyMMdd').format(due);
      final externalRef = 'pm_sched:${s['id']}:$dayKey';
      if (existingRefs.contains(externalRef)) {
        skippedExisting++;
        continue;
      }
      final scheduledStart = DateTime(due.year, due.month, due.day, 9, 0, 0);
      final scheduledEnd = scheduledStart.add(const Duration(hours: 2));
      final inspectionType = (s['inspection_type']?.toString() ?? 'Inspection')
          .trim();
      final assetLabel = (asset['label']?.toString() ?? 'Asset').trim();
      String? assigneeEmployeeId;
      if (autoAssignBestWorker) {
        final suggestions = await getDispatchSuggestions(
          companyId: companyId,
          scheduledStart: scheduledStart,
          scheduledEnd: scheduledEnd,
          limit: 1,
        );
        assigneeEmployeeId = suggestions.isNotEmpty
            ? suggestions.first['employee_id']?.toString()
            : null;
      }

      await _client.from('jobs').insert({
        'company_id': intCompanyId,
        'title': 'Preventive: $inspectionType - $assetLabel',
        'description':
            'Auto-generated preventive maintenance from inspection schedule. Type: $inspectionType. Asset: $assetLabel.',
        'client_id': int.tryParse(clientId),
        'site_id': int.tryParse(siteId),
        'unit_id': int.tryParse(asset['unit_id']?.toString() ?? ''),
        'status': 'pending',
        'priority': 'medium',
        'scheduled_start': scheduledStart.toIso8601String(),
        'scheduled_end': scheduledEnd.toIso8601String(),
        'opened_at': DateTime.now().toIso8601String(),
        'is_preventive': true,
        'assignee_employee_id': int.tryParse(assigneeEmployeeId ?? ''),
        'assigned_employee_ids': assigneeEmployeeId == null
            ? const <String>[]
            : [assigneeEmployeeId],
        'external_ref': externalRef,
      });
      existingRefs.add(externalRef);
      created++;
    }

    return {
      'created': created,
      'skipped_existing': skippedExisting,
      'skipped_missing_site_client': skippedMissingSiteClient,
    };
  }

  // ---- Inventory Allocations -----------------------------------------------

  static InventoryAllocation _allocationFromViewRow(Map<String, dynamic> row) {
    DateTime? parseTs(dynamic v) =>
        v == null ? null : DateTime.tryParse(v.toString());
    double parseNum(dynamic v) {
      if (v == null) return 0;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString()) ?? 0;
    }

    return InventoryAllocation(
      id: row['allocation_id'].toString(),
      inventoryItemId: row['inventory_item_id']?.toString() ?? '',
      itemName: row['item_name'] as String?,
      unit: row['unit'] as String?,
      workerEmployeeId: row['worker_employee_id']?.toString() ?? '',
      workerName: row['worker_name'] as String?,
      workerType: row['worker_type'] as String?,
      jobId: row['job_id']?.toString(),
      jobTitle: row['job_title'] as String?,
      quantityAllocated: parseNum(row['quantity_allocated']),
      status: row['status'] as String? ?? 'active',
      allocatedAt: parseTs(row['allocated_at']),
      closedAt: parseTs(row['closed_at']),
      notes: row['notes'] as String?,
      quantityUsed: parseNum(row['quantity_used']),
      quantityExtra: parseNum(row['quantity_extra']),
      quantityReturned: parseNum(row['quantity_returned']),
      quantityRemaining: parseNum(row['quantity_remaining']),
    );
  }

  /// Returns every allocation for the company (with computed remaining).
  static Future<List<InventoryAllocation>> getAllocationsForCompany({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final data = await _client
        .from('v_inventory_allocations')
        .select()
        .eq('company_id', intCompanyId)
        .order('allocated_at', ascending: false);
    return (data as List)
        .cast<Map<String, dynamic>>()
        .map(_allocationFromViewRow)
        .toList();
  }

  /// Returns active allocations for a specific worker — used by the
  /// employee/contractor's job card to surface what they've been issued.
  static Future<List<InventoryAllocation>> getAllocationsForWorker({
    required String companyId,
    required String workerEmployeeId,
    String? jobId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intWorkerId = int.tryParse(workerEmployeeId);
    if (intCompanyId == null || intWorkerId == null) return const [];
    var query = _client
        .from('v_inventory_allocations')
        .select()
        .eq('company_id', intCompanyId)
        .eq('worker_employee_id', intWorkerId)
        .eq('status', 'active');
    if (jobId != null && int.tryParse(jobId) != null) {
      query = query.eq('job_id', int.parse(jobId));
    }
    final data = await query.order('allocated_at', ascending: false);
    return (data as List)
        .cast<Map<String, dynamic>>()
        .map(_allocationFromViewRow)
        .toList();
  }

  static Future<InventoryAllocation> insertInventoryAllocation({
    required String companyId,
    required String inventoryItemId,
    required String workerEmployeeId,
    required double quantity,
    String? jobId,
    String? unit,
    String? notes,
    String? allocatedByEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intItemId = int.tryParse(inventoryItemId);
    final intWorkerId = int.tryParse(workerEmployeeId);
    if (intCompanyId == null || intItemId == null || intWorkerId == null) {
      throw ArgumentError('Invalid company_id, item_id, or worker_id');
    }
    final payload = {
      'company_id': intCompanyId,
      'inventory_item_id': intItemId,
      'worker_employee_id': intWorkerId,
      'quantity_allocated': quantity,
      if (jobId != null && int.tryParse(jobId) != null)
        'job_id': int.parse(jobId),
      if (unit != null && unit.trim().isNotEmpty) 'unit': unit.trim(),
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      if (allocatedByEmployeeId != null &&
          int.tryParse(allocatedByEmployeeId) != null)
        'allocated_by': int.parse(allocatedByEmployeeId),
    };
    final res = await _client
        .from('inventory_allocations')
        .insert(payload)
        .select('id')
        .single();
    final newId = res['id'].toString();
    // Re-fetch from the view so callers get the computed columns.
    final rowData = await _client
        .from('v_inventory_allocations')
        .select()
        .eq('allocation_id', int.parse(newId))
        .maybeSingle();
    if (rowData == null) {
      // Fall back to a minimal model if the view miss is transient.
      return InventoryAllocation(
        id: newId,
        inventoryItemId: inventoryItemId,
        workerEmployeeId: workerEmployeeId,
        quantityAllocated: quantity,
      );
    }
    return _allocationFromViewRow(Map<String, dynamic>.from(rowData));
  }

  static Future<void> setAllocationStatus({
    required String allocationId,
    required String status,
  }) async {
    final intId = int.tryParse(allocationId);
    if (intId == null) return;
    final patch = <String, dynamic>{
      'status': status,
      if (status != 'active') 'closed_at': DateTime.now().toIso8601String(),
    };
    await _client.from('inventory_allocations').update(patch).eq('id', intId);
  }

  /// Replaces (delete + insert) the usage row that links a specific
  /// allocation to actual consumption. Idempotent — safe to call multiple
  /// times when the worker re-saves their job card. If [quantityUsed] +
  /// [leftoverReturned] + [extraUsed] are all zero/null we just clear
  /// the existing row (worker hasn't recorded usage yet).
  static Future<void> replaceAllocationUsage({
    required String companyId,
    required String jobId,
    required String allocationId,
    required String inventoryItemId,
    double quantityUsed = 0,
    double? leftoverReturned,
    double? extraUsed,
    String? employeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intJobId = int.tryParse(jobId);
    final intAllocId = int.tryParse(allocationId);
    final intItemId = int.tryParse(inventoryItemId);
    if (intCompanyId == null ||
        intJobId == null ||
        intAllocId == null ||
        intItemId == null) {
      throw ArgumentError('Invalid id passed to replaceAllocationUsage');
    }
    // Wipe any existing row linked to this allocation for this job.
    await _client
        .from('job_inventory_usage')
        .delete()
        .eq('job_id', intJobId)
        .eq('allocation_id', intAllocId);

    final hasAnything =
        quantityUsed > 0 || (leftoverReturned ?? 0) > 0 || (extraUsed ?? 0) > 0;
    if (!hasAnything) return;

    final payload = {
      'company_id': intCompanyId,
      'job_id': intJobId,
      'inventory_item_id': intItemId,
      'allocation_id': intAllocId,
      'quantity': quantityUsed,
      if (leftoverReturned != null && leftoverReturned > 0)
        'leftover_returned': leftoverReturned,
      if (extraUsed != null && extraUsed > 0) 'extra_used': extraUsed,
      if (employeeId != null && int.tryParse(employeeId) != null)
        'employee_id': int.parse(employeeId),
    };
    await _client.from('job_inventory_usage').insert(payload);
  }

  /// Records actual inventory consumption for a job. Optionally links to
  /// an allocation so the variance maths work out, and accepts leftover /
  /// extra quantities for over-or-under usage.
  static Future<void> recordInventoryUsage({
    required String companyId,
    required String jobId,
    required String inventoryItemId,
    required double quantityUsed,
    String? employeeId,
    String? allocationId,
    double? leftoverReturned,
    double? extraUsed,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intJobId = int.tryParse(jobId);
    final intItemId = int.tryParse(inventoryItemId);
    if (intCompanyId == null || intJobId == null || intItemId == null) {
      throw ArgumentError('Invalid company_id, job_id, or item_id');
    }
    final payload = {
      'company_id': intCompanyId,
      'job_id': intJobId,
      'inventory_item_id': intItemId,
      'quantity': quantityUsed,
      if (employeeId != null && int.tryParse(employeeId) != null)
        'employee_id': int.parse(employeeId),
      if (allocationId != null && int.tryParse(allocationId) != null)
        'allocation_id': int.parse(allocationId),
      if (leftoverReturned != null) 'leftover_returned': leftoverReturned,
      if (extraUsed != null) 'extra_used': extraUsed,
    };
    await _client.from('job_inventory_usage').insert(payload);
  }

  // ---- Jobs & Job Cards -----------------------------------------------------

  static JobStatus _statusFromString(String? value) {
    final v = (value ?? '').toLowerCase();
    if (v == 'in_progress') return JobStatus.inProgress;
    if (v == 'completed') return JobStatus.completed;
    if (v == 'cancelled') return JobStatus.cancelled;
    return JobStatus.scheduled;
  }

  static String _statusToString(JobStatus status) {
    switch (status) {
      case JobStatus.inProgress:
        return 'in_progress';
      case JobStatus.completed:
        return 'completed';
      case JobStatus.cancelled:
        return 'cancelled';
      case JobStatus.scheduled:
        return 'scheduled';
    }
  }

  /// Maps a single `jobs` row to a [Job]. Single source of truth for
  /// the row → model conversion so all fetch paths agree on every field.
  static Job _jobFromRow(Map<String, dynamic> row) {
    final assigned =
        (row['assigned_employee_ids'] as List?)
            ?.map((e) => e.toString())
            .toList() ??
        <String>[];
    DateTime? parseTs(dynamic v) =>
        v == null ? null : DateTime.tryParse(v.toString());
    double? parseNum(dynamic v) {
      if (v == null) return null;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString());
    }

    return Job(
      id: row['id'].toString(),
      title: row['title'] as String? ?? '',
      description: row['description'] as String?,
      clientId: row['client_id']?.toString() ?? '',
      siteId: row['site_id']?.toString(),
      scheduledStart: parseTs(row['scheduled_start']),
      scheduledEnd: parseTs(row['scheduled_end']),
      status: _statusFromString(row['status'] as String?),
      assignedEmployeeIds: assigned,
      priority: jobPriorityFromString(row['priority'] as String?),
      issueCategoryId: row['issue_category_id']?.toString(),
      unitId: row['unit_id']?.toString(),
      reporterResidentId: row['reporter_resident_id']?.toString(),
      openedAt: parseTs(row['opened_at']),
      firstResponseAt: parseTs(row['first_response_at']),
      closedAt: parseTs(row['closed_at']),
      estimatedCost: parseNum(row['estimated_cost']),
      actualCost: parseNum(row['actual_cost']),
      inventoryCost: parseNum(row['inventory_cost']),
      laborCost: parseNum(row['labor_cost']),
      otherCost: parseNum(row['other_cost']),
      assigneeEmployeeId: row['assignee_employee_id']?.toString(),
      contractorEmployeeId: row['contractor_employee_id']?.toString(),
      contractorId: row['contractor_id']?.toString(),
      isCallback: (row['is_callback'] as bool?) ?? false,
      isPreventive: (row['is_preventive'] as bool?) ?? false,
      parentJobId: row['parent_job_id']?.toString(),
      slaTargetId: row['sla_target_id']?.toString(),
      externalRef: row['external_ref']?.toString(),
      dealId: row['deal_id']?.toString(),
    );
  }

  static Future<List<Job>> getJobs({String? companyId}) async {
    final query = _client.from('jobs').select();
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query.order('scheduled_start');
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows.map(_jobFromRow).toList();
  }

  static Future<Job?> getJobById(String id, {String? companyId}) async {
    final intId = int.tryParse(id);
    if (intId == null) return null;
    final query = _client.from('jobs').select().eq('id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final row = await query.maybeSingle();
    if (row == null) return null;
    return _jobFromRow(Map<String, dynamic>.from(row));
  }

  static Future<List<Job>> getJobsForEmployee(
    String employeeId, {
    String? companyId,
  }) async {
    final intEmpId = int.tryParse(employeeId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId) &&
        intEmpId != null &&
        intCompanyId != null) {
      final data = await _client.rpc(
        'employee_get_jobs_for_employee',
        params: {'p_company_id': intCompanyId, 'p_employee_id': intEmpId},
      );
      final rows =
          (data as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      return rows.map(_jobFromRow).toList();
    }
    // Assuming assigned_employee_ids is a text[] column.
    final query = _client.from('jobs').select().contains(
      'assigned_employee_ids',
      [int.tryParse(employeeId) ?? employeeId],
    );
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query;
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows.map(_jobFromRow).toList();
  }

  static Future<void> upsertJob(
    Job job, {
    String? companyId,
    String? employeeId,
  }) async {
    final intId = int.tryParse(job.id);
    final clientIntId = int.tryParse(job.clientId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    final intEmployeeId = employeeId != null ? int.tryParse(employeeId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId) &&
        intCompanyId != null &&
        intEmployeeId != null &&
        intId != null) {
      await _client.rpc(
        'employee_update_job_status',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': intEmployeeId,
          'p_job_id': intId,
          'p_status': _statusToString(job.status),
        },
      );
      return;
    }
    if (clientIntId == null) return;
    Map<String, dynamic>? previous;
    if (intId != null && intCompanyId != null) {
      previous = await _client
          .from('jobs')
          .select(
            'id, title, status, assigned_employee_ids, assignee_employee_id, contractor_employee_id',
          )
          .eq('company_id', intCompanyId)
          .eq('id', intId)
          .maybeSingle();
    }
    final payload = _jobPayload(job, companyId: companyId);
    String? savedJobId;
    if (intId == null) {
      // New row: stamp opened_at if the caller didn't supply it.
      payload['opened_at'] ??= (job.openedAt ?? DateTime.now())
          .toIso8601String();
      final inserted = await _client
          .from('jobs')
          .insert(payload)
          .select('id')
          .maybeSingle();
      savedJobId = inserted?['id']?.toString();
    } else {
      await _client.from('jobs').upsert({'id': intId, ...payload});
      savedJobId = intId.toString();
    }
    if (intCompanyId != null) {
      await _emitJobNotifications(
        companyId: intCompanyId,
        jobId: savedJobId ?? job.id,
        title: job.title,
        previous: previous,
        next: job,
      );
    }
  }

  /// Creates a new job row and returns the inserted `id`.
  ///
  /// Intended for initial job creation flows (e.g. employee "Add job").
  static Future<String?> createJobReturningId(
    Job job, {
    String? companyId,
  }) async {
    final clientIntId = int.tryParse(job.clientId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    if (clientIntId == null || intCompanyId == null) return null;

    final payload = _jobPayload(job, companyId: companyId);
    payload['opened_at'] ??= (job.openedAt ?? DateTime.now()).toIso8601String();

    final res = await _client
        .from('jobs')
        .insert(payload)
        .select('id')
        .maybeSingle();
    final savedJobId = res?['id']?.toString();
    if (savedJobId != null) {
      await _emitJobNotifications(
        companyId: intCompanyId,
        jobId: savedJobId,
        title: job.title,
        previous: null,
        next: job,
      );
    }
    return savedJobId;
  }

  /// Builds the insert/update payload for a `jobs` row from a [Job]. Only
  /// includes property-management columns when they have a value, so old
  /// flows that don't touch them remain unaffected.
  static Map<String, dynamic> _jobPayload(Job job, {String? companyId}) {
    final clientIntId = int.tryParse(job.clientId);
    final siteIntId = job.siteId != null ? int.tryParse(job.siteId!) : null;
    final priorityWire = job.priority.wireValue;
    final payload = <String, dynamic>{
      if (companyId != null) 'company_id': int.tryParse(companyId) ?? companyId,
      'title': job.title,
      'description': job.description,
      if (clientIntId != null) 'client_id': clientIntId,
      'site_id': siteIntId,
      'scheduled_start': job.scheduledStart?.toIso8601String(),
      'scheduled_end': job.scheduledEnd?.toIso8601String(),
      'status': _statusToString(job.status),
      'assigned_employee_ids': job.assignedEmployeeIds,
      // Property-management / SLA fields — null-safe, server keeps default
      // when the caller doesn't set them.
      if (priorityWire != null) 'priority': priorityWire,
      if (job.issueCategoryId != null)
        'issue_category_id': int.tryParse(job.issueCategoryId!),
      if (job.unitId != null) 'unit_id': int.tryParse(job.unitId!),
      if (job.reporterResidentId != null)
        'reporter_resident_id': int.tryParse(job.reporterResidentId!),
      if (job.openedAt != null) 'opened_at': job.openedAt!.toIso8601String(),
      if (job.firstResponseAt != null)
        'first_response_at': job.firstResponseAt!.toIso8601String(),
      if (job.closedAt != null) 'closed_at': job.closedAt!.toIso8601String(),
      if (job.estimatedCost != null) 'estimated_cost': job.estimatedCost,
      if (job.actualCost != null) 'actual_cost': job.actualCost,
      if (job.inventoryCost != null) 'inventory_cost': job.inventoryCost,
      if (job.laborCost != null) 'labor_cost': job.laborCost,
      if (job.otherCost != null) 'other_cost': job.otherCost,
      if (job.assigneeEmployeeId != null)
        'assignee_employee_id': int.tryParse(job.assigneeEmployeeId!),
      if (job.contractorEmployeeId != null)
        'contractor_employee_id': int.tryParse(job.contractorEmployeeId!),
      if (job.contractorId != null)
        'contractor_id': int.tryParse(job.contractorId!),
      if (job.isCallback) 'is_callback': true,
      if (job.isPreventive) 'is_preventive': true,
      if (job.parentJobId != null)
        'parent_job_id': int.tryParse(job.parentJobId!),
      if (job.slaTargetId != null)
        'sla_target_id': int.tryParse(job.slaTargetId!),
      if (job.externalRef != null) 'external_ref': job.externalRef,
      if (job.dealId != null) 'deal_id': int.tryParse(job.dealId!),
    };
    return payload;
  }

  static Set<String> _jobRecipientsFromRow(Map<String, dynamic>? row) {
    if (row == null) return <String>{};
    final ids = <String>{};
    final assigned = (row['assigned_employee_ids'] as List?) ?? const [];
    for (final v in assigned) {
      final value = v?.toString();
      if (value != null && value.isNotEmpty) ids.add(value);
    }
    final assignee = row['assignee_employee_id']?.toString();
    final contractor = row['contractor_employee_id']?.toString();
    if (assignee != null && assignee.isNotEmpty) ids.add(assignee);
    if (contractor != null && contractor.isNotEmpty) ids.add(contractor);
    return ids;
  }

  static Set<String> _jobRecipientsFromModel(Job job) {
    final ids = <String>{...job.assignedEmployeeIds};
    if ((job.assigneeEmployeeId ?? '').isNotEmpty)
      ids.add(job.assigneeEmployeeId!);
    if ((job.contractorEmployeeId ?? '').isNotEmpty)
      ids.add(job.contractorEmployeeId!);
    return ids;
  }

  static Future<void> _emitJobNotifications({
    required int companyId,
    required String jobId,
    required String title,
    required Map<String, dynamic>? previous,
    required Job next,
  }) async {
    final beforeRecipients = _jobRecipientsFromRow(previous);
    final afterRecipients = _jobRecipientsFromModel(next);

    final oldStatus = (previous?['status'] as String?)?.trim();
    final newStatus = _statusToString(next.status);
    final isNew = previous == null;
    final newlyAssigned = isNew
        ? afterRecipients
        : afterRecipients.difference(beforeRecipients);

    if (newlyAssigned.isNotEmpty) {
      await _insertEmployeeNotifications(
        companyId: companyId,
        employeeIds: newlyAssigned,
        type: 'job_assigned',
        title: 'New job assigned',
        body: title,
        refType: 'job',
        refId: jobId,
      );
      await _insertHrNotification(
        companyId: companyId,
        type: 'job_assigned',
        title: 'Job assigned',
        body: '$title has been assigned to a worker.',
        refType: 'job',
        refId: jobId,
      );
    }

    if (!isNew &&
        oldStatus != null &&
        oldStatus != newStatus &&
        afterRecipients.isNotEmpty) {
      await _insertEmployeeNotifications(
        companyId: companyId,
        employeeIds: afterRecipients,
        type: 'job_status_updated',
        title: 'Job status updated',
        body: '$title is now ${newStatus.replaceAll('_', ' ')}.',
        refType: 'job',
        refId: jobId,
      );
      await _insertHrNotification(
        companyId: companyId,
        type: 'job_status_updated',
        title: 'Job status changed',
        body:
            '$title changed from ${oldStatus.replaceAll('_', ' ')} to ${newStatus.replaceAll('_', ' ')}.',
        refType: 'job',
        refId: jobId,
      );
    }
  }

  /// Marks the first technician response on a job. SLA response time is
  /// measured from `opened_at` to this timestamp. Idempotent — only sets
  /// the value if currently null.
  static Future<void> markJobFirstResponse({
    required String jobId,
    DateTime? at,
  }) async {
    final intId = int.tryParse(jobId);
    if (intId == null) return;
    final ts = (at ?? DateTime.now()).toIso8601String();
    await _client
        .from('jobs')
        .update({'first_response_at': ts})
        .eq('id', intId)
        .filter('first_response_at', 'is', null);
  }

  /// Closes a job (status=completed + closed_at timestamp). Optionally
  /// records the actual_cost at close time. The post-closure feedback
  /// flow is triggered downstream from this call.
  static Future<void> closeJob({
    required String jobId,
    double? actualCost,
    DateTime? at,
  }) async {
    final intId = int.tryParse(jobId);
    if (intId == null) return;
    final ts = (at ?? DateTime.now()).toIso8601String();
    final payload = <String, dynamic>{
      'status': _statusToString(JobStatus.completed),
      'closed_at': ts,
    };
    if (actualCost != null) payload['actual_cost'] = actualCost;
    await _client.from('jobs').update(payload).eq('id', intId);
  }

  static Future<Map<String, dynamic>?> getJobFeedback({
    required String companyId,
    required String jobId,
  }) async {
    final cid = int.tryParse(companyId);
    final jid = int.tryParse(jobId);
    if (cid == null || jid == null) return null;
    final row = await _client
        .from('job_feedback')
        .select()
        .eq('company_id', cid)
        .eq('job_id', jid)
        .maybeSingle();
    return row == null ? null : Map<String, dynamic>.from(row);
  }

  static Future<void> upsertJobFeedback({
    required String companyId,
    required String jobId,
    required int rating,
    String? comments,
    String? residentId,
    String channel = 'direct',
  }) async {
    final cid = int.tryParse(companyId);
    final jid = int.tryParse(jobId);
    final rid = int.tryParse(residentId ?? '');
    if (cid == null || jid == null) return;
    await _client.from('job_feedback').upsert({
      'company_id': cid,
      'job_id': jid,
      'resident_id': rid,
      'rating_1_to_5': rating.clamp(1, 5),
      'comments': comments?.trim().isEmpty == true ? null : comments?.trim(),
      'channel': channel,
      'submitted_at': DateTime.now().toIso8601String(),
      'request_token_used_at': DateTime.now().toIso8601String(),
      'decision_source': 'client',
    });
    final jobRow = await _client
        .from('jobs')
        .select(
          'id, title, assigned_employee_ids, assignee_employee_id, contractor_employee_id',
        )
        .eq('company_id', cid)
        .eq('id', jid)
        .maybeSingle();
    await _insertHrNotification(
      companyId: cid,
      type: 'feedback_submitted',
      title: 'Client feedback submitted',
      body: 'A client submitted feedback for a completed job.',
      refType: 'job',
      refId: jobId,
    );
    await _insertEmployeeNotifications(
      companyId: cid,
      employeeIds: _jobRecipientsFromRow(jobRow),
      type: 'feedback_submitted',
      title: 'Client feedback received',
      body:
          (jobRow?['title']?.toString() ?? 'A job') +
          ' received client feedback.',
      refType: 'job',
      refId: jobId,
    );
  }

  static Future<String?> createJobFeedbackRequestToken({
    required String companyId,
    required String jobId,
  }) async {
    final cid = int.tryParse(companyId);
    final jid = int.tryParse(jobId);
    if (cid == null || jid == null) return null;
    final token = _uuid.v4().replaceAll('-', '');
    await _client.from('job_feedback').upsert({
      'company_id': cid,
      'job_id': jid,
      'request_token': token,
      'requested_at': DateTime.now().toIso8601String(),
      'request_token_expires_at': DateTime.now()
          .add(const Duration(days: 7))
          .toIso8601String(),
      'request_token_used_at': null,
      'request_sent_via': 'link_copy',
      'request_send_count': 1,
      'request_last_sent_at': DateTime.now().toIso8601String(),
      'channel': 'pending_link',
    });
    return token;
  }

  static Future<void> markFeedbackRequestSent({
    required String companyId,
    required String jobId,
    required String sentVia, // email, sms, whatsapp, link_copy, on_device
  }) async {
    final cid = int.tryParse(companyId);
    final jid = int.tryParse(jobId);
    if (cid == null || jid == null) return;
    final current = await _client
        .from('job_feedback')
        .select('id, request_token, request_send_count')
        .eq('company_id', cid)
        .eq('job_id', jid)
        .maybeSingle();
    if (current == null) return;
    final sendCount = (current['request_send_count'] as num?)?.toInt() ?? 0;
    await _client
        .from('job_feedback')
        .update({
          'request_sent_via': sentVia,
          'request_send_count': sendCount + 1,
          'request_last_sent_at': DateTime.now().toIso8601String(),
        })
        .eq('id', current['id']);
    await _client.from('job_feedback_events').insert({
      'company_id': cid,
      'job_feedback_id': current['id'],
      'request_token': current['request_token'],
      'event_type': 'requested',
      'metadata': {'sent_via': sentVia},
    });
  }

  static String buildPublicFeedbackLink(String token) {
    final host = Uri.parse(SupabaseConfig.url).host;
    final projectRef = host.split('.').first;
    return 'https://$projectRef.functions.supabase.co/job_feedback_public?token=$token';
  }

  static Future<Map<String, dynamic>?> getActiveClientPortalToken({
    required String companyId,
    required String clientId,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    if (cid == null || clid == null) return null;
    final row = await _client
        .from('client_portal_tokens')
        .select()
        .eq('company_id', cid)
        .eq('client_id', clid)
        .eq('status', 'active')
        .maybeSingle();
    if (row == null) return null;
    return Map<String, dynamic>.from(row);
  }

  static Future<String?> createClientPortalToken({
    required String companyId,
    required String clientId,
    int expiresInDays = 30,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    if (cid == null || clid == null) return null;
    final existing = await getActiveClientPortalToken(
      companyId: companyId,
      clientId: clientId,
    );
    if (existing != null) {
      return existing['token']?.toString();
    }
    final token = _uuid.v4().replaceAll('-', '');
    final payload = <String, dynamic>{
      'company_id': cid,
      'client_id': clid,
      'token': token,
      'status': 'active',
      'expires_at': DateTime.now()
          .add(Duration(days: expiresInDays))
          .toIso8601String(),
      'created_by_hr_user_id': _client.auth.currentUser?.id,
      'updated_at': DateTime.now().toIso8601String(),
    };
    await _client.from('client_portal_tokens').insert(payload);
    return token;
  }

  static Future<void> revokeClientPortalToken({
    required String companyId,
    required String clientId,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    if (cid == null || clid == null) return;
    await _client
        .from('client_portal_tokens')
        .update({
          'status': 'revoked',
          'updated_at': DateTime.now().toIso8601String(),
        })
        .eq('company_id', cid)
        .eq('client_id', clid)
        .eq('status', 'active');
  }

  static Future<List<Map<String, dynamic>>> getClientPortalEvents({
    required String companyId,
    required String clientId,
    int limit = 100,
  }) async {
    final cid = int.tryParse(companyId);
    final clid = int.tryParse(clientId);
    if (cid == null || clid == null) return [];
    final data = await _client
        .from('client_portal_events')
        .select()
        .eq('company_id', cid)
        .eq('client_id', clid)
        .order('created_at', ascending: false)
        .limit(limit);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<List<Map<String, dynamic>>> getClientDecisionSnapshot({
    required String companyId,
    String status = 'pending',
    int limit = 30,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null) return [];
    final normalized = status.trim().toLowerCase();
    final dealRows = await _client
        .from('client_deals')
        .select(
          'id, client_id, title, offer_amount, client_decision_status, client_decision_note, client_decision_at, created_at',
        )
        .eq('company_id', cid)
        .eq('client_decision_status', normalized)
        .order('client_decision_at', ascending: false)
        .limit(limit);
    final paymentRows = await _client
        .from('client_payments')
        .select(
          'id, client_id, description, amount_due, client_decision_status, client_decision_note, client_decision_at, created_at',
        )
        .eq('company_id', cid)
        .eq('client_decision_status', normalized)
        .order('client_decision_at', ascending: false)
        .limit(limit);
    final clients = await _client
        .from('clients')
        .select('id, name')
        .eq('company_id', cid);
    final clientNames = <String, String>{
      for (final row in (clients as List).cast<Map<String, dynamic>>())
        row['id'].toString(): (row['name']?.toString() ?? 'Unnamed client'),
    };

    final items = <Map<String, dynamic>>[];
    for (final row in (dealRows as List).cast<Map<String, dynamic>>()) {
      items.add({
        'kind': 'deal',
        'id': row['id'],
        'client_id': row['client_id'],
        'client_name':
            clientNames[row['client_id']?.toString()] ?? 'Unknown client',
        'title': row['title'] ?? WorkspaceTerms.untitledProject,
        'amount': (row['offer_amount'] as num?)?.toDouble() ?? 0,
        'status': row['client_decision_status']?.toString() ?? 'pending',
        'note': row['client_decision_note']?.toString(),
        'decided_at': row['client_decision_at']?.toString(),
        'created_at': row['created_at']?.toString(),
      });
    }
    for (final row in (paymentRows as List).cast<Map<String, dynamic>>()) {
      items.add({
        'kind': 'payment',
        'id': row['id'],
        'client_id': row['client_id'],
        'client_name':
            clientNames[row['client_id']?.toString()] ?? 'Unknown client',
        'title': row['description'] ?? 'Payment item',
        'amount': (row['amount_due'] as num?)?.toDouble() ?? 0,
        'status': row['client_decision_status']?.toString() ?? 'pending',
        'note': row['client_decision_note']?.toString(),
        'decided_at': row['client_decision_at']?.toString(),
        'created_at': row['created_at']?.toString(),
      });
    }
    items.sort((a, b) {
      final aTs =
          DateTime.tryParse(
            (a['decided_at'] ?? a['created_at'] ?? '').toString(),
          ) ??
          DateTime.fromMillisecondsSinceEpoch(0);
      final bTs =
          DateTime.tryParse(
            (b['decided_at'] ?? b['created_at'] ?? '').toString(),
          ) ??
          DateTime.fromMillisecondsSinceEpoch(0);
      return bTs.compareTo(aTs);
    });
    return items.take(limit).toList();
  }

  static String buildClientPortalLink(String token) {
    final host = Uri.parse(SupabaseConfig.url).host;
    final projectRef = host.split('.').first;
    return 'https://$projectRef.functions.supabase.co/client_portal_public?token=$token';
  }

  static Future<void> deleteJob(String id) async {
    final intId = int.tryParse(id);
    if (intId == null) return;
    await _client.from('jobs').delete().eq('id', intId);
  }

  static Future<JobCard?> getJobCardForJob(
    String jobId, {
    String? companyId,
    String? employeeId,
  }) async {
    final intId = int.tryParse(jobId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    final intEmployeeId = employeeId != null ? int.tryParse(employeeId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId) &&
        intId != null &&
        intCompanyId != null) {
      final data = await _client.rpc(
        'employee_get_job_card_for_job',
        params: {
          'p_company_id': intCompanyId,
          'p_job_id': intId,
          'p_employee_id': intEmployeeId,
        },
      );
      if (data == null) return null;
      final row = Map<String, dynamic>.from(data as Map);
      final photos = (row['photo_urls'] as List?)?.cast<String>() ?? <String>[];
      return JobCard(
        id: row['id'].toString(),
        jobId: row['job_id'].toString(),
        actualStart: row['actual_start'] != null
            ? DateTime.parse(row['actual_start'] as String)
            : null,
        actualEnd: row['actual_end'] != null
            ? DateTime.parse(row['actual_end'] as String)
            : null,
        workPerformed: row['work_performed'] as String?,
        materialsUsed: row['materials_used'] as String?,
        notes: row['notes'] as String?,
        photoUrls: photos,
        customerSignatureUrl: row['customer_signature_url'] as String?,
      );
    }
    if (intId != null) {
      final query = _client.from('job_cards').select().eq('job_id', intId);
      if (companyId != null) {
        query.eq('company_id', int.tryParse(companyId) ?? companyId);
      }
      final data = await query.limit(1).maybeSingle();
      if (data == null) return null;
      final photos =
          (data['photo_urls'] as List?)?.cast<String>() ?? <String>[];
      return JobCard(
        id: data['id'].toString(),
        jobId: data['job_id'].toString(),
        actualStart: data['actual_start'] != null
            ? DateTime.parse(data['actual_start'] as String)
            : null,
        actualEnd: data['actual_end'] != null
            ? DateTime.parse(data['actual_end'] as String)
            : null,
        workPerformed: data['work_performed'] as String?,
        materialsUsed: data['materials_used'] as String?,
        notes: data['notes'] as String?,
        photoUrls: photos,
        customerSignatureUrl: data['customer_signature_url'] as String?,
      );
    }
    final query = _client.from('job_cards').select().eq('job_id', jobId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query.limit(1).maybeSingle();
    if (data == null) return null;
    final photos = (data['photo_urls'] as List?)?.cast<String>() ?? <String>[];
    return JobCard(
      id: data['id'].toString(),
      jobId: data['job_id'].toString(),
      actualStart: data['actual_start'] != null
          ? DateTime.parse(data['actual_start'] as String)
          : null,
      actualEnd: data['actual_end'] != null
          ? DateTime.parse(data['actual_end'] as String)
          : null,
      workPerformed: data['work_performed'] as String?,
      materialsUsed: data['materials_used'] as String?,
      notes: data['notes'] as String?,
      photoUrls: photos,
      customerSignatureUrl: data['customer_signature_url'] as String?,
    );
  }

  static Future<void> upsertJobCard(
    JobCard card, {
    String? companyId,
    String? employeeId,
  }) async {
    final intId = int.tryParse(card.id);
    final jobIntId = int.tryParse(card.jobId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    final intEmployeeId = employeeId != null ? int.tryParse(employeeId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId) &&
        intCompanyId != null &&
        jobIntId != null) {
      await _client.rpc(
        'employee_upsert_job_card',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': intEmployeeId,
          'p_job_id': jobIntId,
          'p_actual_start': card.actualStart?.toIso8601String(),
          'p_actual_end': card.actualEnd?.toIso8601String(),
          'p_work_performed': card.workPerformed,
          'p_materials_used': card.materialsUsed,
          'p_notes': card.notes,
          'p_photo_urls': card.photoUrls,
          'p_customer_signature_url': card.customerSignatureUrl,
        },
      );
      return;
    }
    final payload = {
      if (companyId != null) 'company_id': int.tryParse(companyId) ?? companyId,
      'job_id': jobIntId ?? card.jobId,
      'actual_start': card.actualStart?.toIso8601String(),
      'actual_end': card.actualEnd?.toIso8601String(),
      'work_performed': card.workPerformed,
      'materials_used': card.materialsUsed,
      'notes': card.notes,
      'photo_urls': card.photoUrls,
      'customer_signature_url': card.customerSignatureUrl,
    };
    if (intId == null) {
      await _client.from('job_cards').upsert(payload);
    } else {
      await _client.from('job_cards').upsert({'id': intId, ...payload});
    }
  }

  // ---- Incidents ------------------------------------------------------------

  static Future<void> insertIncident(
    IncidentReport incident, {
    String? companyId,
    String? employeeCode,
    List<String> recipientUserIds = const [],
  }) async {
    final intEmpId = int.tryParse(incident.employeeId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId) && intCompanyId != null) {
      final intJobId = incident.jobId != null
          ? int.tryParse(incident.jobId!)
          : null;
      final intSiteId = incident.siteId != null
          ? int.tryParse(incident.siteId!)
          : null;
      await _client.rpc(
        'employee_insert_incident',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': intEmpId,
          'p_employee_code': employeeCode,
          'p_job_id': intJobId,
          'p_site_id': intSiteId,
          'p_description': incident.description,
          'p_severity': incident.severity,
          'p_created_at': incident.createdAt.toIso8601String(),
          'p_photo_urls': incident.photoUrls,
        },
      );
      final latest = await _client
          .from('incidents')
          .select('id')
          .eq('company_id', intCompanyId)
          .eq('employee_id', intEmpId ?? incident.employeeId)
          .order('created_at', ascending: false)
          .limit(1)
          .maybeSingle();
      final incId = latest?['id']?.toString();
      if (incId != null && recipientUserIds.isNotEmpty) {
        await _insertSubmissionRecipients(
          companyId: intCompanyId,
          submissionType: 'incident',
          submissionId: incId,
          recipientUserIds: recipientUserIds,
          title: 'New incident submitted',
          body: incident.description,
        );
      }
      if (incId != null) {
        await _insertHrNotification(
          companyId: intCompanyId,
          type: 'incident_reported',
          title: 'Incident reported',
          body: incident.description,
          refType: 'incident',
          refId: incId,
        );
      }
      return;
    }
    final inserted = await _client
        .from('incidents')
        .insert({
          if (companyId != null)
            'company_id': int.tryParse(companyId) ?? companyId,
          'employee_id': intEmpId ?? incident.employeeId,
          'job_id': incident.jobId,
          'site_id': incident.siteId,
          'description': incident.description,
          'severity': incident.severity,
          'created_at': incident.createdAt.toIso8601String(),
          'photo_urls': incident.photoUrls,
        })
        .select('id')
        .maybeSingle();
    final incId = inserted?['id']?.toString();
    if (intCompanyId != null && incId != null && recipientUserIds.isNotEmpty) {
      await _insertSubmissionRecipients(
        companyId: intCompanyId,
        submissionType: 'incident',
        submissionId: incId,
        recipientUserIds: recipientUserIds,
        title: 'New incident submitted',
        body: incident.description,
      );
    }
    if (intCompanyId != null && incId != null) {
      await _insertHrNotification(
        companyId: intCompanyId,
        type: 'incident_reported',
        title: 'Incident reported',
        body: incident.description,
        refType: 'incident',
        refId: incId,
      );
    }
  }

  static IncidentReport _incidentFromRow(Map<String, dynamic> row) {
    return IncidentReport(
      id: row['id'].toString(),
      employeeId: row['employee_id'].toString(),
      companyId: row['company_id']?.toString(),
      jobId: row['job_id']?.toString(),
      siteId: row['site_id']?.toString(),
      description: row['description'] as String? ?? '',
      severity: row['severity'] as String?,
      createdAt: row['created_at'] != null
          ? DateTime.parse(row['created_at'] as String)
          : DateTime.now(),
      photoUrls:
          (row['photo_urls'] as List?)?.map((e) => e.toString()).toList() ??
          <String>[],
    );
  }

  static Future<List<IncidentReport>> getIncidents({String? companyId}) async {
    final query = _client.from('incidents').select();
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query.order('created_at', ascending: false);
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows.map(_incidentFromRow).toList();
  }

  static Future<List<IncidentReport>> getIncidentsForJob(
    String jobId, {
    String? companyId,
  }) async {
    final intJobId = int.tryParse(jobId);
    final query = _client.from('incidents').select();
    if (intJobId != null) {
      query.eq('job_id', intJobId);
    } else {
      query.eq('job_id', jobId);
    }
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query.order('created_at', ascending: false);
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows.map(_incidentFromRow).toList();
  }

  static Future<List<IncidentReport>> getIncidentsForEmployee(
    String employeeId, {
    String? companyId,
  }) async {
    final intEmpId = int.tryParse(employeeId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId) &&
        intEmpId != null &&
        intCompanyId != null) {
      final data = await _client.rpc(
        'employee_get_incidents_for_employee',
        params: {'p_company_id': intCompanyId, 'p_employee_id': intEmpId},
      );
      final rows =
          (data as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      return rows.map(_incidentFromRow).toList();
    }
    final query = _client.from('incidents').select();
    if (intEmpId != null) {
      query.eq('employee_id', intEmpId);
    } else {
      query.eq('employee_id', employeeId);
    }
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query.order('created_at', ascending: false);
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows.map(_incidentFromRow).toList();
  }

  // ---- Inventory ------------------------------------------------------------

  static InventoryItem _inventoryItemFromRow(Map<String, dynamic> row) {
    return InventoryItem(
      id: row['id'].toString(),
      name: row['name'] as String? ?? '',
      stockCount: (row['stock_count'] as num?)?.toDouble() ?? 0.0,
      unit: row['unit'] as String?,
      unitCost: (row['unit_cost'] as num?)?.toDouble(),
      sellingPrice: (row['selling_price'] as num?)?.toDouble(),
      companyId: row['company_id']?.toString(),
    );
  }

  /// Inventory items are stored in `inventory_items` with:
  /// - id (bigint identity)
  /// - name (text)
  /// - stock_count (numeric)
  /// - unit (text, optional)
  /// - unit_cost (numeric, optional)
  static Future<List<InventoryItem>> getInventoryItems({
    String? companyId,
    String? employeeId,
  }) async {
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    final intEmployeeId = employeeId != null ? int.tryParse(employeeId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId) && intCompanyId != null) {
      final data = await _client.rpc(
        'employee_get_inventory_items',
        params: {'p_company_id': intCompanyId, 'p_employee_id': intEmployeeId},
      );
      final rows =
          (data as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      return rows.map(_inventoryItemFromRow).toList();
    }
    final query = _client.from('inventory_items').select();
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query.order('name');
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows.map(_inventoryItemFromRow).toList();
  }

  static Future<void> upsertInventoryItem(
    InventoryItem item, {
    String? companyId,
  }) async {
    final intId = int.tryParse(item.id);
    final payload = {
      if (companyId != null) 'company_id': int.tryParse(companyId) ?? companyId,
      'name': item.name,
      'stock_count': item.stockCount,
      'unit': item.unit,
      'unit_cost': item.unitCost,
      'selling_price': item.sellingPrice,
    };
    if (intId == null) {
      await _client.from('inventory_items').insert(payload);
    } else {
      await _client.from('inventory_items').upsert({'id': intId, ...payload});
    }
  }

  static Future<void> deleteInventoryItem(
    String id, {
    String? companyId,
  }) async {
    final intId = int.tryParse(id);
    if (intId == null) return;
    final query = _client.from('inventory_items').delete().eq('id', intId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    await query;
  }

  /// Adds [deltaStock] to `stock_count` (negative = removal / recorded sale).
  static Future<void> adjustInventoryStockCount({
    required String inventoryItemId,
    required double deltaStock,
    String? companyId,
  }) async {
    final intItemId = int.tryParse(inventoryItemId);
    if (intItemId == null) return;
    final base = _client.from('inventory_items').select('stock_count').eq('id', intItemId);
    final filtered = companyId != null
        ? base.eq('company_id', int.tryParse(companyId) ?? companyId)
        : base;
    final row = await filtered.maybeSingle();
    if (row == null) return;
    final current = (row['stock_count'] as num?)?.toDouble() ?? 0;
    final next = current + deltaStock;
    if (next < 0) {
      throw StateError('Stock cannot go negative.');
    }
    final upd = _client.from('inventory_items').update({'stock_count': next}).eq('id', intItemId);
    if (companyId != null) {
      upd.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    await upd;
  }

  // ---- Work teams -----------------------------------------------------------

  static WorkTeam _workTeamFromRow(Map<String, dynamic> row) {
    return WorkTeam(
      id: row['id'].toString(),
      name: row['name'] as String? ?? '',
      companyId: row['company_id']?.toString() ?? '',
    );
  }

  static Future<List<WorkTeam>> getWorkTeams({required String companyId}) async {
    final intCid = int.tryParse(companyId);
    if (intCid == null) return const [];
    final data = await _client
        .from('work_teams')
        .select('id, company_id, name')
        .eq('company_id', intCid)
        .order('name');
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows.map(_workTeamFromRow).toList();
  }

  static Future<String?> createWorkTeam({
    required String companyId,
    required String name,
  }) async {
    final intCid = int.tryParse(companyId);
    if (intCid == null) return null;
    final trimmed = name.trim();
    if (trimmed.isEmpty) return null;
    final res = await _client
        .from('work_teams')
        .insert({'company_id': intCid, 'name': trimmed})
        .select('id')
        .maybeSingle();
    return res?['id']?.toString();
  }

  static Future<void> deleteWorkTeam({
    required String teamId,
    required String companyId,
  }) async {
    final tid = int.tryParse(teamId);
    final cid = int.tryParse(companyId);
    if (tid == null || cid == null) return;
    await _client.from('work_teams').delete().eq('id', tid).eq('company_id', cid);
  }

  static Future<List<String>> getWorkTeamMemberEmployeeIds({
    required String teamId,
    required String companyId,
  }) async {
    final tid = int.tryParse(teamId);
    final cid = int.tryParse(companyId);
    if (tid == null || cid == null) return const [];
    final data = await _client
        .from('work_team_members')
        .select('employee_id')
        .eq('team_id', tid)
        .eq('company_id', cid);
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows.map((r) => r['employee_id'].toString()).toList();
  }

  static Future<void> addEmployeeToWorkTeam({
    required String companyId,
    required String teamId,
    required String employeeId,
  }) async {
    final cid = int.tryParse(companyId);
    final tid = int.tryParse(teamId);
    final eid = int.tryParse(employeeId);
    if (cid == null || tid == null || eid == null) return;
    await _client.from('work_team_members').insert({
      'company_id': cid,
      'team_id': tid,
      'employee_id': eid,
    });
  }

  static Future<void> removeEmployeeFromWorkTeam({
    required String companyId,
    required String teamId,
    required String employeeId,
  }) async {
    final cid = int.tryParse(companyId);
    final tid = int.tryParse(teamId);
    final eid = int.tryParse(employeeId);
    if (cid == null || tid == null || eid == null) return;
    await _client
        .from('work_team_members')
        .delete()
        .eq('company_id', cid)
        .eq('team_id', tid)
        .eq('employee_id', eid);
  }

  /// Teams the employee belongs to (respects RLS in worker sessions).
  static Future<List<WorkTeam>> getWorkTeamsForEmployee({
    required String companyId,
    required String employeeId,
  }) async {
    final cid = int.tryParse(companyId);
    final eid = int.tryParse(employeeId);
    if (cid == null || eid == null) return const [];
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      final raw = await _client.rpc(
        'employee_get_work_teams',
        params: {'p_company_id': cid, 'p_employee_id': eid},
      );
      final rows =
          (raw as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      final out = rows.map(_workTeamFromRow).toList();
      out.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      return out;
    }
    final data = await _client
        .from('work_team_members')
        .select('work_teams(id, company_id, name)')
        .eq('company_id', cid)
        .eq('employee_id', eid);
    final rows = (data as List).cast<Map<String, dynamic>>();
    final out = <WorkTeam>[];
    for (final r in rows) {
      final nested = r['work_teams'];
      if (nested is Map<String, dynamic>) {
        out.add(_workTeamFromRow(nested));
      }
    }
    out.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return out;
  }

  /// Usage records are stored in `job_inventory_usage`:
  /// - id (bigint identity)
  /// - job_id (bigint)
  /// - inventory_item_id (bigint)
  /// - quantity (numeric)
  /// - employee_id (bigint, optional)
  /// - created_at (timestamptz)
  static Future<List<InventoryUsage>> getInventoryUsageForJob(
    String jobId, {
    String? companyId,
    String? employeeId,
  }) async {
    final intJobId = int.tryParse(jobId);
    if (intJobId == null) return [];
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    final intEmployeeId = employeeId != null ? int.tryParse(employeeId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId) && intCompanyId != null) {
      final data = await _client.rpc(
        'employee_get_inventory_usage_for_job',
        params: {
          'p_company_id': intCompanyId,
          'p_job_id': intJobId,
          'p_employee_id': intEmployeeId,
        },
      );
      final rows =
          (data as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      return rows
          .map(
            (row) => InventoryUsage(
              id: row['id'].toString(),
              jobId: row['job_id'].toString(),
              inventoryItemId: row['inventory_item_id'].toString(),
              quantity: (row['quantity'] as num?)?.toDouble() ?? 0.0,
              employeeId: row['employee_id']?.toString(),
              createdAt: row['created_at'] != null
                  ? DateTime.parse(row['created_at'] as String)
                  : null,
            ),
          )
          .toList();
    }
    final query = _client
        .from('job_inventory_usage')
        .select()
        .eq('job_id', intJobId);
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query.order('created_at', ascending: true);
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows
        .map(
          (row) => InventoryUsage(
            id: row['id'].toString(),
            jobId: row['job_id'].toString(),
            inventoryItemId: row['inventory_item_id'].toString(),
            quantity: (row['quantity'] as num?)?.toDouble() ?? 0.0,
            employeeId: row['employee_id']?.toString(),
            createdAt: row['created_at'] != null
                ? DateTime.parse(row['created_at'] as String)
                : null,
          ),
        )
        .toList();
  }

  /// Set the usage list for a job and adjust stock by the delta vs previous usage.
  /// This keeps stock accurate even if the job card is edited.
  static Future<void> _syncJobActualCostFromInventoryUsage({
    required int intJobId,
    required List<InventoryUsage> usages,
    String? companyId,
    String? employeeId,
  }) async {
    try {
      final items = await getInventoryItems(
        companyId: companyId,
        employeeId: employeeId,
      );
      final byId = {for (final it in items) it.id: it};
      var inventoryCostTotal = 0.0;
      for (final u in usages) {
        final unitCost = byId[u.inventoryItemId]?.unitCost;
        if (unitCost == null || unitCost < 0) continue;
        inventoryCostTotal += (u.quantity * unitCost);
      }

      final query = _client
          .from('jobs')
          .select('actual_cost, inventory_cost, labor_cost, other_cost')
          .eq('id', intJobId);
      if (companyId != null) {
        query.eq('company_id', int.tryParse(companyId) ?? companyId);
      }
      final row = await query.maybeSingle();
      if (row == null) return;
      final currentActual = (row['actual_cost'] as num?)?.toDouble();
      final previousInventoryCost = (row['inventory_cost'] as num?)?.toDouble();
      final laborCost = (row['labor_cost'] as num?)?.toDouble();
      double? otherCost = (row['other_cost'] as num?)?.toDouble();

      // One-time backfill for legacy jobs that had only actual_cost:
      // preserve the historical non-inventory part as "other_cost".
      if (otherCost == null &&
          currentActual != null &&
          laborCost == null &&
          previousInventoryCost == null &&
          currentActual > inventoryCostTotal) {
        otherCost = currentActual - inventoryCostTotal;
      }

      final mergedActual =
          inventoryCostTotal + (laborCost ?? 0) + (otherCost ?? 0);
      final nextActual = mergedActual > 0 ? mergedActual : null;

      final updatePayload = <String, dynamic>{
        'inventory_cost': inventoryCostTotal > 0 ? inventoryCostTotal : null,
        'actual_cost': nextActual,
        if (otherCost != null) 'other_cost': otherCost,
      };
      final update = _client
          .from('jobs')
          .update(updatePayload)
          .eq('id', intJobId);
      if (companyId != null) {
        update.eq('company_id', int.tryParse(companyId) ?? companyId);
      }
      await update;
    } catch (_) {
      // Non-blocking: inventory usage save should not fail if auto cost sync
      // cannot run due to permissions/RLS or partial pricing setup.
    }
  }

  static Future<void> setInventoryUsageForJob({
    required String jobId,
    String? employeeId,
    String? companyId,
    required List<InventoryUsage> usages,
  }) async {
    final intJobId = int.tryParse(jobId);
    if (intJobId == null) return;
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    final intEmployeeId = employeeId != null ? int.tryParse(employeeId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId) && intCompanyId != null) {
      await _client.rpc(
        'employee_set_inventory_usage_for_job',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': intEmployeeId,
          'p_job_id': intJobId,
          'p_usages': usages
              .map(
                (u) => {
                  'inventory_item_id':
                      int.tryParse(u.inventoryItemId) ?? u.inventoryItemId,
                  'quantity': u.quantity,
                },
              )
              .toList(),
        },
      );
      await _syncJobActualCostFromInventoryUsage(
        intJobId: intJobId,
        usages: usages,
        companyId: companyId,
        employeeId: employeeId,
      );
      return;
    }

    final existing = await getInventoryUsageForJob(
      jobId,
      companyId: companyId,
      employeeId: employeeId,
    );
    final beforeByItem = <String, double>{};
    for (final u in existing) {
      beforeByItem[u.inventoryItemId] =
          (beforeByItem[u.inventoryItemId] ?? 0) + u.quantity;
    }
    final afterByItem = <String, double>{};
    for (final u in usages) {
      afterByItem[u.inventoryItemId] =
          (afterByItem[u.inventoryItemId] ?? 0) + u.quantity;
    }

    // Apply deltas to stock_count.
    final affected = <String>{...beforeByItem.keys, ...afterByItem.keys};
    for (final itemId in affected) {
      final before = beforeByItem[itemId] ?? 0.0;
      final after = afterByItem[itemId] ?? 0.0;
      final deltaUsed =
          after - before; // + means consume more, - means return stock
      if (deltaUsed == 0) continue;
      final intItemId = int.tryParse(itemId);
      if (intItemId == null) continue;
      // stock_count := stock_count - deltaUsed
      // (if deltaUsed is negative, this increases stock).
      await _client.rpc(
        'inventory_adjust_stock',
        params: {'p_item_id': intItemId, 'p_delta_used': deltaUsed},
      );
    }

    // If we got here, stock adjustments succeeded: replace rows for this job.
    final deleteQuery = _client
        .from('job_inventory_usage')
        .delete()
        .eq('job_id', intJobId);
    if (companyId != null) {
      deleteQuery.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    await deleteQuery;

    final intEmpId = employeeId != null ? int.tryParse(employeeId) : null;
    if (usages.isNotEmpty) {
      final payload = usages.map((u) {
        return {
          'job_id': intJobId,
          if (companyId != null)
            'company_id': int.tryParse(companyId) ?? companyId,
          'inventory_item_id':
              int.tryParse(u.inventoryItemId) ?? u.inventoryItemId,
          'quantity': u.quantity,
          'employee_id': intEmpId,
          'created_at': DateTime.now().toIso8601String(),
        };
      }).toList();
      await _client.from('job_inventory_usage').insert(payload);
    }
    await _syncJobActualCostFromInventoryUsage(
      intJobId: intJobId,
      usages: usages,
      companyId: companyId,
      employeeId: employeeId,
    );
  }

  // ---- Payments approvals ---------------------------------------------------

  /// Stores HR overrides/approval per employee per month.
  ///
  /// Table: `payment_approvals`
  /// - employee_id (bigint)
  /// - period_start (date) (first day of month)
  /// - edited_amount (numeric, nullable)
  /// - approved (bool)
  /// - approved_at (timestamptz, nullable)
  /// Unique: (employee_id, period_start)
  static Future<List<PaymentApproval>> getPaymentApprovalsForMonth(
    DateTime periodStart, {
    String? companyId,
  }) async {
    final start = DateTime(periodStart.year, periodStart.month, 1);
    final query = _client
        .from('payment_approvals')
        .select()
        .eq('period_start', _dateFmt.format(start));
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query;
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows
        .map(
          (row) => PaymentApproval(
            id: row['id']?.toString(),
            employeeId: row['employee_id'].toString(),
            companyId: row['company_id']?.toString(),
            periodStart: DateTime.parse(row['period_start'] as String),
            editedAmount: (row['edited_amount'] as num?)?.toDouble(),
            approved: (row['approved'] as bool?) ?? false,
            approvedAt: row['approved_at'] != null
                ? DateTime.parse(row['approved_at'] as String)
                : null,
            status:
                row['status']?.toString() ??
                ((row['approved'] as bool?) == true ? 'approved' : 'pending'),
            decisionNote: row['decision_note']?.toString(),
          ),
        )
        .toList();
  }

  /// Returns all monthly approvals whose `period_start` month falls within
  /// the provided date range (inclusive).
  static Future<List<PaymentApproval>> getPaymentApprovalsForRange(
    DateTime from,
    DateTime to, {
    String? companyId,
  }) async {
    final startMonth = DateTime(from.year, from.month, 1);
    final endMonth = DateTime(to.year, to.month, 1);
    final query = _client
        .from('payment_approvals')
        .select()
        .gte('period_start', _dateFmt.format(startMonth))
        .lte('period_start', _dateFmt.format(endMonth));
    if (companyId != null) {
      query.eq('company_id', int.tryParse(companyId) ?? companyId);
    }
    final data = await query;
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows
        .map(
          (row) => PaymentApproval(
            id: row['id']?.toString(),
            employeeId: row['employee_id'].toString(),
            companyId: row['company_id']?.toString(),
            periodStart: DateTime.parse(row['period_start'] as String),
            editedAmount: (row['edited_amount'] as num?)?.toDouble(),
            approved: (row['approved'] as bool?) ?? false,
            approvedAt: row['approved_at'] != null
                ? DateTime.parse(row['approved_at'] as String)
                : null,
            status:
                row['status']?.toString() ??
                ((row['approved'] as bool?) == true ? 'approved' : 'pending'),
            decisionNote: row['decision_note']?.toString(),
          ),
        )
        .toList();
  }

  static Future<void> upsertPaymentApproval(
    PaymentApproval approval, {
    String? companyId,
  }) async {
    final intEmpId = int.tryParse(approval.employeeId);
    final intCompanyId = companyId != null ? int.tryParse(companyId) : null;
    if (intEmpId == null) return;
    final start = DateTime(
      approval.periodStart.year,
      approval.periodStart.month,
      1,
    );
    await _client.from('payment_approvals').upsert({
      'employee_id': intEmpId,
      if (companyId != null) 'company_id': int.tryParse(companyId) ?? companyId,
      'period_start': _dateFmt.format(start),
      'edited_amount': approval.editedAmount,
      'approved': approval.approved,
      'status': approval.status,
      'decision_note': approval.decisionNote,
      'approved_at': approval.approved
          ? (approval.approvedAt ?? DateTime.now()).toIso8601String()
          : null,
      'updated_at': DateTime.now().toIso8601String(),
    });
    if (intCompanyId != null) {
      final status = approval.status;
      final title = switch (status) {
        'approved' => 'Payment approved',
        'declined' => 'Payment declined',
        'partial' => 'Payment partially approved',
        _ => 'Payment update',
      };
      final body = approval.decisionNote?.trim().isNotEmpty == true
          ? approval.decisionNote!.trim()
          : 'Your monthly payment review has been updated.';
      await _insertEmployeeNotifications(
        companyId: intCompanyId,
        employeeIds: {approval.employeeId},
        type: 'payment_status_updated',
        title: title,
        body: body,
        refType: 'payment_approval',
        refId: '${approval.employeeId}:${_dateFmt.format(start)}',
      );
    }
  }

  // ---- Paperless: forms + approvals ----------------------------------------

  static Future<List<WorkflowFormTemplate>> getFormTemplates({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('form_templates')
        .select()
        .eq('company_id', intCompanyId)
        .eq('is_active', true)
        .order('name');
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows
        .map(
          (r) => WorkflowFormTemplate(
            id: r['id'].toString(),
            companyId: r['company_id'].toString(),
            name: r['name'] as String? ?? '',
            formType: r['form_type'] as String? ?? '',
            schemaJson: Map<String, dynamic>.from(
              (r['schema_json'] as Map?) ?? const {},
            ),
            requiresEmployeeSignature:
                (r['requires_employee_signature'] as bool?) ?? false,
            requiresSupervisorSignature:
                (r['requires_supervisor_signature'] as bool?) ?? false,
            requiresClientSignature:
                (r['requires_client_signature'] as bool?) ?? false,
          ),
        )
        .toList();
  }

  static Future<void> upsertFormTemplate(
    WorkflowFormTemplate template, {
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(template.id);
    if (intCompanyId == null) return;
    final payload = {
      'company_id': intCompanyId,
      'name': template.name,
      'form_type': template.formType,
      'schema_json': template.schemaJson,
      'requires_employee_signature': template.requiresEmployeeSignature,
      'requires_supervisor_signature': template.requiresSupervisorSignature,
      'requires_client_signature': template.requiresClientSignature,
    };
    if (intId == null) {
      await _client.from('form_templates').insert(payload);
    } else {
      await _client.from('form_templates').upsert({'id': intId, ...payload});
    }
  }

  static Future<List<WorkflowFormSubmission>> getFormSubmissions({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('form_submissions')
        .select()
        .eq('company_id', intCompanyId)
        .order('created_at', ascending: false);
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows
        .map(
          (r) => WorkflowFormSubmission(
            id: r['id'].toString(),
            templateId: r['template_id'].toString(),
            companyId: r['company_id'].toString(),
            status: r['status'] as String? ?? 'draft',
            employeeId: r['employee_id']?.toString(),
            jobId: r['job_id']?.toString(),
            payloadJson: Map<String, dynamic>.from(
              (r['payload_json'] as Map?) ?? const {},
            ),
            employeeSignatureUrl: r['employee_signature_url'] as String?,
            supervisorSignatureUrl: r['supervisor_signature_url'] as String?,
            clientSignatureUrl: r['client_signature_url'] as String?,
            createdAt: r['created_at'] != null
                ? DateTime.parse(r['created_at'] as String)
                : DateTime.now(),
          ),
        )
        .toList();
  }

  static Future<void> upsertFormSubmission(
    WorkflowFormSubmission submission, {
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(submission.id);
    final intTemplateId = int.tryParse(submission.templateId);
    if (intCompanyId == null || intTemplateId == null) return;
    final payload = {
      'company_id': intCompanyId,
      'template_id': intTemplateId,
      'employee_id': int.tryParse(submission.employeeId ?? ''),
      'job_id': int.tryParse(submission.jobId ?? ''),
      'status': submission.status,
      'payload_json': submission.payloadJson,
      'employee_signature_url': submission.employeeSignatureUrl,
      'supervisor_signature_url': submission.supervisorSignatureUrl,
      'client_signature_url': submission.clientSignatureUrl,
    };
    if (intId == null) {
      await _client.from('form_submissions').insert(payload);
    } else {
      await _client.from('form_submissions').upsert({'id': intId, ...payload});
    }
  }

  static Future<void> setFormSubmissionStatus({
    required String companyId,
    required String submissionId,
    required String status,
    String? comments,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intSubmissionId = int.tryParse(submissionId);
    if (intCompanyId == null || intSubmissionId == null) return;
    await _client
        .from('form_submissions')
        .update({
          'status': status,
          'updated_at': DateTime.now().toIso8601String(),
        })
        .eq('company_id', intCompanyId)
        .eq('id', intSubmissionId);
    final profile = await getCurrentHrProfile();
    await _client.from('form_approvals').insert({
      'company_id': intCompanyId,
      'submission_id': intSubmissionId,
      'step_order': 1,
      'required_role': profile?.role ?? 'manager',
      'status': status == 'approved'
          ? 'approved'
          : (status == 'rejected' ? 'rejected' : 'pending'),
      'approver_user_id': _client.auth.currentUser?.id,
      'comments': comments,
      'acted_at': DateTime.now().toIso8601String(),
    });
  }

  // ---- Paperless: document vault -------------------------------------------

  static Future<List<Map<String, dynamic>>> getDocumentFiles({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('document_files')
        .select()
        .eq('company_id', intCompanyId)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> upsertDocumentFile({
    required String companyId,
    String? id,
    String? employeeId,
    String? jobId,
    String? clientId,
    required String category,
    required String title,
    required String fileUrl,
    String? mimeType,
    int? fileSizeBytes,
    int versionNo = 1,
    String? parentDocumentId,
    List<String> tags = const [],
    DateTime? expiryDate,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(id ?? '');
    if (intCompanyId == null) return;
    final payload = {
      'company_id': intCompanyId,
      'employee_id': int.tryParse(employeeId ?? ''),
      'job_id': int.tryParse(jobId ?? ''),
      'client_id': int.tryParse(clientId ?? ''),
      'category': category,
      'title': title,
      'file_url': fileUrl,
      'mime_type': mimeType,
      'file_size_bytes': fileSizeBytes,
      'version_no': versionNo,
      'parent_document_id': int.tryParse(parentDocumentId ?? ''),
      'tags': tags,
      'expiry_date': expiryDate != null ? _dateFmt.format(expiryDate) : null,
    };
    if (intId == null) {
      await _client.from('document_files').insert(payload);
    } else {
      await _client.from('document_files').upsert({'id': intId, ...payload});
    }
  }

  // ---- Paperless: compliance + handover ------------------------------------

  static Future<List<Map<String, dynamic>>> getEmployeeComplianceRecords({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('employee_compliance_records')
        .select('*, compliance_requirements(title)')
        .eq('company_id', intCompanyId)
        .order('updated_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> upsertEmployeeComplianceRecord({
    required String companyId,
    String? id,
    required String employeeId,
    required String requirementId,
    String status = 'valid',
    DateTime? issuedOn,
    DateTime? expiresOn,
    String? documentFileId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(id ?? '');
    final intEmployeeId = int.tryParse(employeeId);
    final intRequirementId = int.tryParse(requirementId);
    if (intCompanyId == null ||
        intEmployeeId == null ||
        intRequirementId == null)
      return;
    final payload = {
      'company_id': intCompanyId,
      'employee_id': intEmployeeId,
      'requirement_id': intRequirementId,
      'document_file_id': int.tryParse(documentFileId ?? ''),
      'status': status,
      'issued_on': issuedOn != null ? _dateFmt.format(issuedOn) : null,
      'expires_on': expiresOn != null ? _dateFmt.format(expiresOn) : null,
    };
    if (intId == null) {
      await _client.from('employee_compliance_records').insert(payload);
    } else {
      await _client.from('employee_compliance_records').upsert({
        'id': intId,
        ...payload,
      });
    }
  }

  static Future<List<Map<String, dynamic>>> getHandoverPacks({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('handover_packs')
        .select()
        .eq('company_id', intCompanyId)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> upsertHandoverPack({
    required String companyId,
    String? id,
    required String jobId,
    String? generatedPdfUrl,
    Map<String, dynamic> checklistJson = const {},
    String? sharedWithEmail,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(id ?? '');
    final intJobId = int.tryParse(jobId);
    if (intCompanyId == null || intJobId == null) return;
    final payload = {
      'company_id': intCompanyId,
      'job_id': intJobId,
      'generated_pdf_url': generatedPdfUrl,
      'checklist_json': checklistJson,
      'shared_with_email': sharedWithEmail,
      'shared_at': sharedWithEmail != null
          ? DateTime.now().toIso8601String()
          : null,
    };
    if (intId == null) {
      await _client.from('handover_packs').upsert(payload);
    } else {
      await _client.from('handover_packs').upsert({'id': intId, ...payload});
    }
  }

  // ---- Paperless: automations + integrations -------------------------------

  static Future<List<Map<String, dynamic>>> getAutomationRules({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('automation_rules')
        .select()
        .eq('company_id', intCompanyId)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> upsertAutomationRule({
    required String companyId,
    String? id,
    required String name,
    required String triggerType,
    required Map<String, dynamic> triggerConfig,
    required String actionType,
    required Map<String, dynamic> actionConfig,
    bool isActive = true,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(id ?? '');
    if (intCompanyId == null) return;
    final payload = {
      'company_id': intCompanyId,
      'name': name,
      'trigger_type': triggerType,
      'trigger_config': triggerConfig,
      'action_type': actionType,
      'action_config': actionConfig,
      'is_active': isActive,
    };
    if (intId == null) {
      await _client.from('automation_rules').insert(payload);
    } else {
      await _client.from('automation_rules').upsert({'id': intId, ...payload});
    }
  }

  static Future<List<Map<String, dynamic>>> getScheduledExports({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('scheduled_exports')
        .select()
        .eq('company_id', intCompanyId)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> upsertScheduledExport({
    required String companyId,
    String? id,
    required String exportType,
    required String format,
    required String cronExpr,
    String? destinationEmail,
    String? destinationWebhook,
    bool isActive = true,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(id ?? '');
    if (intCompanyId == null) return;
    final payload = {
      'company_id': intCompanyId,
      'export_type': exportType,
      'format': format,
      'cron_expr': cronExpr,
      'destination_email': destinationEmail,
      'destination_webhook': destinationWebhook,
      'is_active': isActive,
    };
    if (intId == null) {
      await _client.from('scheduled_exports').insert(payload);
    } else {
      await _client.from('scheduled_exports').upsert({'id': intId, ...payload});
    }
  }

  static Future<List<Map<String, dynamic>>> getIntegrationEndpoints({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('integration_endpoints')
        .select()
        .eq('company_id', intCompanyId)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> upsertIntegrationEndpoint({
    required String companyId,
    String? id,
    required String provider,
    required Map<String, dynamic> configJson,
    bool isActive = true,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(id ?? '');
    if (intCompanyId == null) return;
    final payload = {
      'company_id': intCompanyId,
      'provider': provider,
      'config_json': configJson,
      'is_active': isActive,
    };
    if (intId == null) {
      await _client.from('integration_endpoints').insert(payload);
    } else {
      await _client.from('integration_endpoints').upsert({
        'id': intId,
        ...payload,
      });
    }
  }

  // ---- Smart scheduling + recipient routing --------------------------------

  static Future<List<Map<String, dynamic>>> getShiftTemplates({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('shift_templates')
        .select()
        .eq('company_id', intCompanyId)
        .order('name');
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<List<Map<String, dynamic>>> getShifts({
    required String companyId,
    DateTime? from,
    DateTime? to,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final query = _client
        .from('shifts')
        .select()
        .eq('company_id', intCompanyId);
    if (from != null) query.gte('starts_at', from.toIso8601String());
    if (to != null) query.lte('starts_at', to.toIso8601String());
    final data = await query.order('starts_at');
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> upsertShift({
    required String companyId,
    String? id,
    String? jobId,
    String? siteId,
    required String title,
    required DateTime startsAt,
    required DateTime endsAt,
    int requiredHeadcount = 1,
    String? branch,
    int geofenceRadiusM = 200,
    String status = 'open',
    String? notes,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(id ?? '');
    if (intCompanyId == null) return;
    final payload = {
      'company_id': intCompanyId,
      'job_id': int.tryParse(jobId ?? ''),
      'site_id': int.tryParse(siteId ?? ''),
      'title': title,
      'starts_at': startsAt.toIso8601String(),
      'ends_at': endsAt.toIso8601String(),
      'required_headcount': requiredHeadcount,
      'branch': branch,
      'geofence_radius_m': geofenceRadiusM,
      'status': status,
      'notes': notes,
    };
    if (intId == null) {
      await _client.from('shifts').insert(payload);
    } else {
      await _client.from('shifts').upsert({'id': intId, ...payload});
    }
  }

  // Same as `upsertShift`, but returns the created/upserted shift id.
  // Needed for immediately creating `shift_assignments`.
  static Future<String?> upsertShiftReturningId({
    required String companyId,
    String? id,
    String? jobId,
    String? siteId,
    required String title,
    required DateTime startsAt,
    required DateTime endsAt,
    int requiredHeadcount = 1,
    String? branch,
    int geofenceRadiusM = 200,
    String status = 'open',
    String? notes,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(id ?? '');
    if (intCompanyId == null) return null;

    final payload = {
      'company_id': intCompanyId,
      'job_id': int.tryParse(jobId ?? ''),
      'site_id': int.tryParse(siteId ?? ''),
      'title': title,
      'starts_at': startsAt.toIso8601String(),
      'ends_at': endsAt.toIso8601String(),
      'required_headcount': requiredHeadcount,
      'branch': branch,
      'geofence_radius_m': geofenceRadiusM,
      'status': status,
      'notes': notes,
    };

    final row = intId == null
        ? await _client
              .from('shifts')
              .insert(payload)
              .select('id')
              .maybeSingle()
        : await _client
              .from('shifts')
              .upsert({'id': intId, ...payload})
              .select('id')
              .maybeSingle();

    return row?['id']?.toString();
  }

  static Future<List<Map<String, dynamic>>> suggestAssignmentsForShift({
    required String companyId,
    required String shiftId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intShiftId = int.tryParse(shiftId);
    if (intCompanyId == null || intShiftId == null) return [];
    final shift = await _client
        .from('shifts')
        .select('id, starts_at, ends_at, branch')
        .eq('company_id', intCompanyId)
        .eq('id', intShiftId)
        .maybeSingle();
    if (shift == null) return [];
    final emps = await _client
        .from('employees')
        .select()
        .eq('company_id', intCompanyId);
    final rows = (emps as List).cast<Map<String, dynamic>>();
    final suggestions = <Map<String, dynamic>>[];
    for (final e in rows) {
      final scoreData = await _client.rpc(
        'shift_assignment_score',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': (e['id'] as num).toInt(),
          'p_shift_id': intShiftId,
        },
      );
      final scoreRow =
          (scoreData as List?)?.cast<Map<String, dynamic>>().firstOrNull ??
          const {};
      suggestions.add({
        'employee_id': e['id'],
        'name': '${e['name'] ?? ''} ${e['surname'] ?? ''}'.trim(),
        'branch': e['branch'],
        'score': scoreRow['score'] ?? 0,
        'score_reason': scoreRow['reason'] ?? 'baseline',
      });
    }
    suggestions.sort(
      (a, b) =>
          ((b['score'] as num?) ?? 0).compareTo((a['score'] as num?) ?? 0),
    );
    return suggestions;
  }

  static Future<void> upsertShiftAssignment({
    required String companyId,
    required String shiftId,
    required String employeeId,
    String status = 'offered',
    double? score,
    String? scoreReason,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intShiftId = int.tryParse(shiftId);
    final intEmployeeId = int.tryParse(employeeId);
    if (intCompanyId == null || intShiftId == null || intEmployeeId == null)
      return;
    await _client.from('shift_assignments').upsert({
      'company_id': intCompanyId,
      'shift_id': intShiftId,
      'employee_id': intEmployeeId,
      'status': status,
      'score': score,
      'score_reason': scoreReason,
      'responded_at': (status == 'accepted' || status == 'declined')
          ? DateTime.now().toIso8601String()
          : null,
    });
  }

  static Future<List<Map<String, dynamic>>> getShiftAssignmentsForEmployee({
    required String companyId,
    required String employeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmployeeId = int.tryParse(employeeId);
    if (intCompanyId == null || intEmployeeId == null) return [];
    final data = await _client
        .from('shift_assignments')
        .select('*, shifts(*)')
        .eq('company_id', intCompanyId)
        .eq('employee_id', intEmployeeId)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<Map<String, dynamic>?> validatePunchAgainstShift({
    required String companyId,
    required String employeeId,
    required DateTime punchAt,
    required double? latitude,
    required double? longitude,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmployeeId = int.tryParse(employeeId);
    if (intCompanyId == null || intEmployeeId == null) return null;
    final assignment = await _client
        .from('shift_assignments')
        .select(
          'id, shift_id, shifts(id, starts_at, ends_at, geofence_radius_m, site_id)',
        )
        .eq('company_id', intCompanyId)
        .eq('employee_id', intEmployeeId)
        .eq('status', 'accepted')
        .lte('shifts.starts_at', punchAt.toIso8601String())
        .gte('shifts.ends_at', punchAt.toIso8601String())
        .limit(1)
        .maybeSingle();
    if (assignment == null) {
      return {
        'allowed': false,
        'reason': 'No accepted active shift for this time window.',
      };
    }
    final shift = Map<String, dynamic>.from(assignment['shifts'] as Map);
    final siteId = shift['site_id']?.toString();
    if (siteId != null && latitude != null && longitude != null) {
      final site = await getSiteById(siteId, companyId: companyId);
      if (site != null && site.latitude != null && site.longitude != null) {
        final meters = _haversineMeters(
          latitude,
          longitude,
          site.latitude!,
          site.longitude!,
        );
        final radius = (shift['geofence_radius_m'] as num?)?.toDouble() ?? 200;
        if (meters > radius) {
          await _insertShiftEvent(
            companyId: intCompanyId,
            shiftId: shift['id'].toString(),
            assignmentId: assignment['id'].toString(),
            employeeId: employeeId,
            eventType: 'geofence_block',
            details: {'distance_m': meters, 'allowed_radius_m': radius},
          );
          return {
            'allowed': false,
            'reason': 'You are outside the allowed shift site radius.',
          };
        }
      }
    }
    return {
      'allowed': true,
      'shift_id': shift['id'].toString(),
      'assignment_id': assignment['id'].toString(),
    };
  }

  static Future<void> _insertShiftEvent({
    required int companyId,
    required String shiftId,
    String? assignmentId,
    String? employeeId,
    required String eventType,
    Map<String, dynamic> details = const {},
  }) async {
    await _client.from('shift_events').insert({
      'company_id': companyId,
      'shift_id': int.tryParse(shiftId),
      'assignment_id': int.tryParse(assignmentId ?? ''),
      'employee_id': int.tryParse(employeeId ?? ''),
      'event_type': eventType,
      'details': details,
    });
  }

  static Future<List<Map<String, dynamic>>> getNotificationQueue({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('notification_queue')
        .select()
        .eq('company_id', intCompanyId)
        .order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<List<Map<String, dynamic>>> getRecipientUsers({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return [];
    final data = await _client
        .from('hr_users')
        .select('auth_user_id, role, is_active, display_name')
        .eq('company_id', intCompanyId)
        .eq('is_active', true);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<List<HrRecipientUser>> getManagerCandidates({
    required String companyId,
  }) async {
    final rows = await getRecipientUsers(companyId: companyId);
    return rows
        .where((r) {
          final role = (r['role']?.toString().toLowerCase() ?? '');
          return role == 'manager' || role == 'admin' || role == 'owner';
        })
        .map(
          (r) => HrRecipientUser(
            authUserId: r['auth_user_id'].toString(),
            role: r['role']?.toString() ?? 'manager',
            displayName: r['display_name']?.toString(),
          ),
        )
        .toList();
  }

  static Future<void> _insertSubmissionRecipients({
    required int companyId,
    required String submissionType,
    required String submissionId,
    required List<String> recipientUserIds,
    required String title,
    required String body,
  }) async {
    if (recipientUserIds.isEmpty) return;
    final rows = recipientUserIds.map((id) {
      return {
        'company_id': companyId,
        'submission_type': submissionType,
        'submission_id': int.tryParse(submissionId),
        'recipient_user_id': id,
      };
    }).toList();
    await _client.from('submission_recipients').insert(rows);
    final notifs = recipientUserIds.map((id) {
      return {
        'company_id': companyId,
        'recipient_user_id': id,
        'channel': 'in_app',
        'source': submissionType,
        'title': title,
        'body': body,
        'payload': {
          'submission_type': submissionType,
          'submission_id': submissionId,
        },
      };
    }).toList();
    await _client.from('notification_queue').insert(notifs);
  }

  static Future<Map<String, List<String>>> getSubmissionRecipients({
    required String companyId,
    required String submissionType,
    required List<String> submissionIds,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null || submissionIds.isEmpty) return {};
    final ids = submissionIds
        .map((e) => int.tryParse(e))
        .whereType<int>()
        .toList();
    if (ids.isEmpty) return {};
    final data = await _client
        .from('submission_recipients')
        .select('submission_id, recipient_user_id')
        .eq('company_id', intCompanyId)
        .eq('submission_type', submissionType)
        .inFilter('submission_id', ids);
    final rows = (data as List).cast<Map<String, dynamic>>();
    final map = <String, List<String>>{};
    for (final r in rows) {
      final sid = r['submission_id'].toString();
      map.putIfAbsent(sid, () => []);
      map[sid]!.add(r['recipient_user_id'].toString());
    }
    return map;
  }

  static Future<Map<String, List<String>>> getSubmissionRecipientsForType({
    required String companyId,
    required String submissionType,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return {};
    final data = await _client
        .from('submission_recipients')
        .select('submission_id, recipient_user_id')
        .eq('company_id', intCompanyId)
        .eq('submission_type', submissionType);
    final rows = (data as List).cast<Map<String, dynamic>>();
    final map = <String, List<String>>{};
    for (final r in rows) {
      final sid = r['submission_id'].toString();
      map.putIfAbsent(sid, () => []);
      map[sid]!.add(r['recipient_user_id'].toString());
    }
    return map;
  }

  static Future<String?> insertEmployeeJobRequest({
    required String companyId,
    required String employeeId,
    required String title,
    String? description,
    DateTime? preferredDate,
    List<String> recipientUserIds = const [],
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmployeeId = int.tryParse(employeeId);
    if (intCompanyId == null || intEmployeeId == null) return null;
    final row = await _client
        .from('employee_job_requests')
        .insert({
          'company_id': intCompanyId,
          'employee_id': intEmployeeId,
          'title': title,
          'description': description,
          'preferred_date': preferredDate != null
              ? _dateFmt.format(preferredDate)
              : null,
        })
        .select('id')
        .maybeSingle();
    final id = row?['id']?.toString();
    if (id != null && recipientUserIds.isNotEmpty) {
      await _insertSubmissionRecipients(
        companyId: intCompanyId,
        submissionType: 'job_request',
        submissionId: id,
        recipientUserIds: recipientUserIds,
        title: 'New job request submitted',
        body: title,
      );
    }
    return id;
  }

  static Future<void> updateEmployeeJobRequestStatus({
    required String companyId,
    required String requestId,
    required String status,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intRequestId = int.tryParse(requestId);
    if (intCompanyId == null || intRequestId == null) return;

    await _client
        .from('employee_job_requests')
        .update({
          'status': status,
          'updated_at': DateTime.now().toIso8601String(),
        })
        .eq('company_id', intCompanyId)
        .eq('id', intRequestId);
  }

  static Future<List<Map<String, dynamic>>> getEmployeeJobRequests({
    required String companyId,
    String? employeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmployeeId = int.tryParse(employeeId ?? '');
    if (intCompanyId == null) return [];
    final query = _client
        .from('employee_job_requests')
        .select()
        .eq('company_id', intCompanyId);
    if (intEmployeeId != null) query.eq('employee_id', intEmployeeId);
    final data = await query.order('created_at', ascending: false);
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<void> evaluateShiftExceptions({
    required String companyId,
    required String shiftId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intShiftId = int.tryParse(shiftId);
    if (intCompanyId == null || intShiftId == null) return;
    final shift = await _client
        .from('shifts')
        .select()
        .eq('company_id', intCompanyId)
        .eq('id', intShiftId)
        .maybeSingle();
    if (shift == null) return;
    final startsAt = DateTime.tryParse(shift['starts_at'].toString());
    final endsAt = DateTime.tryParse(shift['ends_at'].toString());
    if (startsAt == null || endsAt == null) return;
    final assignments = await _client
        .from('shift_assignments')
        .select()
        .eq('company_id', intCompanyId)
        .eq('shift_id', intShiftId);
    final rows = (assignments as List).cast<Map<String, dynamic>>();
    final accepted = rows.where((r) => r['status'] == 'accepted').toList();
    if (accepted.length <
        ((shift['required_headcount'] as num?)?.toInt() ?? 1)) {
      final hrUsers = await getRecipientUsers(companyId: companyId);
      for (final hr in hrUsers) {
        await _client.from('notification_queue').insert({
          'company_id': intCompanyId,
          'recipient_user_id': hr['auth_user_id'],
          'source': 'shift_fill',
          'title': 'Unfilled shift',
          'body': '${shift['title']} has open slots before start.',
          'payload': {'shift_id': shiftId},
        });
      }
    }
    final now = DateTime.now();
    if (now.isAfter(endsAt)) {
      for (final a in accepted) {
        final punches = await getPunchesForEmployee(
          a['employee_id'].toString(),
          from: startsAt,
          to: endsAt,
          companyId: companyId,
        );
        final hasIn = punches.any((p) => p.isSignIn);
        if (!hasIn) {
          await _insertShiftEvent(
            companyId: intCompanyId,
            shiftId: shiftId,
            assignmentId: a['id'].toString(),
            employeeId: a['employee_id'].toString(),
            eventType: 'no_show',
            details: const {},
          );
          await _client
              .from('shift_assignments')
              .update({'status': 'no_show'})
              .eq('id', a['id']);
        } else {
          final totalHours =
              punches.where((p) => p.isSignIn).isNotEmpty &&
                  punches.where((p) => p.isSignOut).isNotEmpty
              ? punches.last.dateTime
                        .difference(punches.first.dateTime)
                        .inMinutes /
                    60.0
              : 0.0;
          final planned = endsAt.difference(startsAt).inMinutes / 60.0;
          if (totalHours > planned + 0.5) {
            await _insertShiftEvent(
              companyId: intCompanyId,
              shiftId: shiftId,
              assignmentId: a['id'].toString(),
              employeeId: a['employee_id'].toString(),
              eventType: 'overtime_exception',
              details: {'planned_hours': planned, 'actual_hours': totalHours},
            );
          }
        }
      }
    }
  }

  static Future<Map<String, num>> getSchedulingKpis({
    required String companyId,
    DateTime? from,
    DateTime? to,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null)
      return {
        'fill_rate': 0,
        'acceptance_rate': 0,
        'late_no_show': 0,
        'overtime_exceptions': 0,
      };
    final shiftQuery = _client
        .from('shifts')
        .select('id, required_headcount, status')
        .eq('company_id', intCompanyId);
    if (from != null) shiftQuery.gte('starts_at', from.toIso8601String());
    if (to != null) shiftQuery.lte('starts_at', to.toIso8601String());
    final shiftRows = (await shiftQuery as List).cast<Map<String, dynamic>>();
    final shiftIds = shiftRows
        .map((e) => (e['id'] as num?)?.toInt())
        .whereType<int>()
        .toList();
    if (shiftIds.isEmpty) {
      return {
        'fill_rate': 0,
        'acceptance_rate': 0,
        'late_no_show': 0,
        'overtime_exceptions': 0,
      };
    }
    final assignRows =
        (await _client
                    .from('shift_assignments')
                    .select('shift_id, status')
                    .eq('company_id', intCompanyId)
                    .inFilter('shift_id', shiftIds)
                as List)
            .cast<Map<String, dynamic>>();
    final eventRows =
        (await _client
                    .from('shift_events')
                    .select('event_type')
                    .eq('company_id', intCompanyId)
                    .inFilter('shift_id', shiftIds)
                as List)
            .cast<Map<String, dynamic>>();
    final totalNeeded = shiftRows.fold<int>(
      0,
      (sum, s) => sum + ((s['required_headcount'] as num?)?.toInt() ?? 0),
    );
    final accepted = assignRows
        .where((a) => a['status'] == 'accepted' || a['status'] == 'completed')
        .length;
    final offered = assignRows
        .where(
          (a) =>
              a['status'] == 'offered' ||
              a['status'] == 'accepted' ||
              a['status'] == 'declined' ||
              a['status'] == 'completed',
        )
        .length;
    final filledShiftCount = shiftRows
        .where((s) => s['status'] == 'filled' || s['status'] == 'completed')
        .length;
    final lateNoShow = eventRows
        .where(
          (e) =>
              e['event_type'] == 'late_checkin' || e['event_type'] == 'no_show',
        )
        .length;
    final overtimeExceptions = eventRows
        .where((e) => e['event_type'] == 'overtime_exception')
        .length;
    return {
      'fill_rate': totalNeeded > 0
          ? (accepted / totalNeeded) * 100
          : (shiftRows.isNotEmpty
                ? (filledShiftCount / shiftRows.length) * 100
                : 0),
      'acceptance_rate': offered > 0 ? (accepted / offered) * 100 : 0,
      'late_no_show': lateNoShow,
      'overtime_exceptions': overtimeExceptions,
    };
  }

  static Future<Map<String, num>> getSlaCommandCenterKpis({
    required String companyId,
    DateTime? from,
    DateTime? to,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) {
      return const {
        'total_open': 0,
        'due_soon': 0,
        'response_breached': 0,
        'resolution_breached': 0,
      };
    }
    final query = _client
        .from('jobs')
        .select(
          'status, opened_at, first_response_at, scheduled_end, closed_at',
        )
        .eq('company_id', intCompanyId);
    if (from != null) query.gte('opened_at', from.toIso8601String());
    if (to != null) query.lte('opened_at', to.toIso8601String());
    final rows = (await query as List).cast<Map<String, dynamic>>();
    final now = DateTime.now();

    int totalOpen = 0;
    int dueSoon = 0;
    int responseBreached = 0;
    int resolutionBreached = 0;

    for (final row in rows) {
      final status = (row['status']?.toString() ?? '').toLowerCase();
      final openedAt = DateTime.tryParse(row['opened_at']?.toString() ?? '');
      final firstResponseAt = DateTime.tryParse(
        row['first_response_at']?.toString() ?? '',
      );
      final scheduledEnd = DateTime.tryParse(
        row['scheduled_end']?.toString() ?? '',
      );
      final closedAt = DateTime.tryParse(row['closed_at']?.toString() ?? '');
      final isOpen = status != 'completed' && status != 'cancelled';

      if (isOpen) totalOpen++;
      if (isOpen && scheduledEnd != null) {
        final diff = scheduledEnd.difference(now);
        if (!diff.isNegative && diff.inHours <= 24) dueSoon++;
      }
      if (openedAt != null &&
          firstResponseAt == null &&
          now.difference(openedAt).inHours > 2) {
        responseBreached++;
      }
      if (isOpen && scheduledEnd != null && now.isAfter(scheduledEnd)) {
        resolutionBreached++;
      }
      if (!isOpen &&
          scheduledEnd != null &&
          closedAt != null &&
          closedAt.isAfter(scheduledEnd)) {
        resolutionBreached++;
      }
    }

    return {
      'total_open': totalOpen,
      'due_soon': dueSoon,
      'response_breached': responseBreached,
      'resolution_breached': resolutionBreached,
    };
  }

  static Future<List<Map<String, dynamic>>> getSlaExceptionJobs({
    required String companyId,
    int limit = 20,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final rows =
        (await _client
                    .from('jobs')
                    .select(
                      'id, title, status, opened_at, first_response_at, scheduled_end, closed_at, assignee_employee_id, contractor_employee_id',
                    )
                    .eq('company_id', intCompanyId)
                    .order('scheduled_end', ascending: true)
                as List)
            .cast<Map<String, dynamic>>();
    final now = DateTime.now();
    final exceptions = <Map<String, dynamic>>[];
    for (final row in rows) {
      final status = (row['status']?.toString() ?? '').toLowerCase();
      final openedAt = DateTime.tryParse(row['opened_at']?.toString() ?? '');
      final firstResponseAt = DateTime.tryParse(
        row['first_response_at']?.toString() ?? '',
      );
      final scheduledEnd = DateTime.tryParse(
        row['scheduled_end']?.toString() ?? '',
      );
      final closedAt = DateTime.tryParse(row['closed_at']?.toString() ?? '');
      final isOpen = status != 'completed' && status != 'cancelled';
      final responseBreached =
          openedAt != null &&
          firstResponseAt == null &&
          now.difference(openedAt).inHours > 2;
      final resolutionBreached =
          (isOpen && scheduledEnd != null && now.isAfter(scheduledEnd)) ||
          (!isOpen &&
              scheduledEnd != null &&
              closedAt != null &&
              closedAt.isAfter(scheduledEnd));
      if (!responseBreached && !resolutionBreached) continue;
      exceptions.add({
        'id': row['id']?.toString(),
        'title': row['title']?.toString() ?? 'Untitled',
        'status': status,
        'response_breached': responseBreached,
        'resolution_breached': resolutionBreached,
        'scheduled_end': row['scheduled_end'],
      });
      if (exceptions.length >= limit) break;
    }
    return exceptions;
  }

  static Future<List<Map<String, dynamic>>> getOperationalEscalationRules({
    required String companyId,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null) return const [];
    final rows = await _client
        .from('operational_escalation_rules')
        .select()
        .eq('company_id', cid)
        .order('rule_key');
    return (rows as List).cast<Map<String, dynamic>>();
  }

  static Future<void> upsertOperationalEscalationRule({
    required String companyId,
    required String ruleKey,
    required bool isEnabled,
    required double thresholdHours,
    required String severity,
    Map<String, dynamic>? config,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null) return;
    await _client.from('operational_escalation_rules').upsert({
      'company_id': cid,
      'rule_key': ruleKey,
      'is_enabled': isEnabled,
      'threshold_hours': thresholdHours,
      'severity': severity,
      'config': config ?? const {},
      'updated_at': DateTime.now().toIso8601String(),
    });
  }

  static Future<Map<String, num>> getControlTowerSummary({
    required String companyId,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null) {
      return const {
        'open_alerts': 0,
        'critical_alerts': 0,
        'overdue_jobs': 0,
        'pending_client_decisions': 0,
      };
    }
    final now = DateTime.now();
    final jobs =
        (await _client
                    .from('jobs')
                    .select('id, status, scheduled_end')
                    .eq('company_id', cid)
                as List)
            .cast<Map<String, dynamic>>();
    int overdueJobs = 0;
    for (final j in jobs) {
      final status = (j['status']?.toString() ?? '').toLowerCase();
      if (status == 'completed' || status == 'cancelled') continue;
      final scheduledEnd = DateTime.tryParse(
        j['scheduled_end']?.toString() ?? '',
      );
      if (scheduledEnd != null && now.isAfter(scheduledEnd)) overdueJobs++;
    }
    final alerts =
        (await _client
                    .from('operational_escalation_events')
                    .select('id, severity')
                    .eq('company_id', cid)
                    .eq('status', 'open')
                as List)
            .cast<Map<String, dynamic>>();
    final pendingDealsCount = await _client
        .from('client_deals')
        .select('id')
        .eq('company_id', cid)
        .eq('client_decision_status', 'pending')
        .count(CountOption.exact);
    final pendingPaymentsCount = await _client
        .from('client_payments')
        .select('id')
        .eq('company_id', cid)
        .eq('client_decision_status', 'pending')
        .count(CountOption.exact);
    return {
      'open_alerts': alerts.length,
      'critical_alerts': alerts
          .where((a) => (a['severity']?.toString() ?? '') == 'critical')
          .length,
      'overdue_jobs': overdueJobs,
      'pending_client_decisions':
          pendingDealsCount.count + pendingPaymentsCount.count,
    };
  }

  static Future<List<Map<String, dynamic>>> getControlTowerAlerts({
    required String companyId,
    int limit = 50,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null) return const [];
    final rows = await _client
        .from('operational_escalation_events')
        .select()
        .eq('company_id', cid)
        .eq('status', 'open')
        .order('created_at', ascending: false)
        .limit(limit);
    return (rows as List).cast<Map<String, dynamic>>();
  }

  static Future<int> runOperationalEscalationEngine({
    required String companyId,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null) return 0;
    final rules = await getOperationalEscalationRules(companyId: companyId);
    final enabledByKey = <String, Map<String, dynamic>>{
      for (final r in rules.where((r) => r['is_enabled'] == true))
        (r['rule_key']?.toString() ?? ''): r,
    };
    final jobs =
        (await _client
                    .from('jobs')
                    .select('id, title, status, opened_at, scheduled_end')
                    .eq('company_id', cid)
                as List)
            .cast<Map<String, dynamic>>();
    final now = DateTime.now();
    var created = 0;

    Future<void> createAlert({
      required Map<String, dynamic>? rule,
      required String refType,
      required String refId,
      required String title,
      required String severity,
      Map<String, dynamic>? details,
    }) async {
      final existing = await _client
          .from('operational_escalation_events')
          .select('id')
          .eq('company_id', cid)
          .eq('ref_type', refType)
          .eq('ref_id', refId)
          .eq('status', 'open')
          .maybeSingle();
      if (existing != null) return;
      await _client.from('operational_escalation_events').insert({
        'company_id': cid,
        'rule_id': rule?['id'],
        'ref_type': refType,
        'ref_id': refId,
        'severity': severity,
        'title': title,
        'details': details ?? const {},
      });
      await _insertHrNotification(
        companyId: cid,
        type: 'operational_escalation',
        title: 'Operational alert',
        body: title,
        refType: refType,
        refId: refId,
      );
      created++;
    }

    for (final job in jobs) {
      final jobId = job['id']?.toString();
      if (jobId == null || jobId.isEmpty) continue;
      final status = (job['status']?.toString() ?? '').toLowerCase();
      if (status == 'completed' || status == 'cancelled') continue;
      final openedAt = DateTime.tryParse(job['opened_at']?.toString() ?? '');
      final scheduledEnd = DateTime.tryParse(
        job['scheduled_end']?.toString() ?? '',
      );

      final responseRule = enabledByKey['job_response_overdue'];
      if (responseRule != null && openedAt != null) {
        final threshold =
            ((responseRule['threshold_hours'] as num?)?.toDouble() ?? 2).abs();
        if (now.difference(openedAt).inMinutes >= (threshold * 60)) {
          await createAlert(
            rule: responseRule,
            refType: 'job',
            refId: jobId,
            title: 'Job ${(job['title'] ?? '#$jobId')} has delayed response.',
            severity: responseRule['severity']?.toString() ?? 'high',
            details: {'rule': 'job_response_overdue'},
          );
        }
      }

      final resolutionRule = enabledByKey['job_resolution_overdue'];
      if (resolutionRule != null &&
          scheduledEnd != null &&
          now.isAfter(scheduledEnd)) {
        await createAlert(
          rule: resolutionRule,
          refType: 'job',
          refId: jobId,
          title: 'Job ${(job['title'] ?? '#$jobId')} is overdue past schedule.',
          severity: resolutionRule['severity']?.toString() ?? 'critical',
          details: {'rule': 'job_resolution_overdue'},
        );
      }
    }
    return created;
  }

  static Future<void> resolveControlTowerAlert({
    required String alertId,
  }) async {
    final id = int.tryParse(alertId);
    if (id == null) return;
    await _client
        .from('operational_escalation_events')
        .update({
          'status': 'resolved',
          'resolved_at': DateTime.now().toIso8601String(),
        })
        .eq('id', id);
  }

  static Future<void> escalateJobManually({
    required String companyId,
    required String jobId,
    String severity = 'high',
    String? note,
  }) async {
    final cid = int.tryParse(companyId);
    final jid = int.tryParse(jobId);
    if (cid == null || jid == null) return;
    await _client.from('operational_escalation_events').insert({
      'company_id': cid,
      'ref_type': 'job',
      'ref_id': jobId,
      'severity': severity,
      'title': 'Manual escalation for job #$jobId',
      'details': {
        'source': 'manual',
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      },
    });
    await _insertHrNotification(
      companyId: cid,
      type: 'operational_escalation',
      title: 'Manual job escalation',
      body: 'Job #$jobId has been escalated.',
      refType: 'job',
      refId: jobId,
    );
  }

  static Future<void> reassignJobPrimaryAssignee({
    required String companyId,
    required String jobId,
    required String employeeId,
  }) async {
    final cid = int.tryParse(companyId);
    final jid = int.tryParse(jobId);
    final eid = int.tryParse(employeeId);
    if (cid == null || jid == null || eid == null) return;
    final row = await _client
        .from('jobs')
        .select('assigned_employee_ids')
        .eq('company_id', cid)
        .eq('id', jid)
        .maybeSingle();
    final ids = <String>{};
    final existing = (row?['assigned_employee_ids'] as List?) ?? const [];
    for (final v in existing) {
      final s = v.toString();
      if (s.isNotEmpty) ids.add(s);
    }
    ids.add(employeeId);
    await _client
        .from('jobs')
        .update({
          'assignee_employee_id': eid,
          'assigned_employee_ids': ids.toList(),
          'updated_at': DateTime.now().toIso8601String(),
        })
        .eq('company_id', cid)
        .eq('id', jid);
    await _insertEmployeeNotifications(
      companyId: cid,
      employeeIds: {employeeId},
      type: 'job_reassigned',
      title: 'Job reassigned',
      body: 'You have been assigned as the primary assignee for job #$jobId.',
      refType: 'job',
      refId: jobId,
    );
  }

  static Future<List<Map<String, dynamic>>> getClientProfitabilitySnapshot({
    required String companyId,
    DateTime? from,
    DateTime? to,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];

    final clientRows =
        (await _client
                    .from('clients')
                    .select('id, name')
                    .eq('company_id', intCompanyId)
                as List)
            .cast<Map<String, dynamic>>();
    final dealQuery = _client
        .from('client_deals')
        .select('id, client_id, offer_amount')
        .eq('company_id', intCompanyId);
    if (from != null) dealQuery.gte('created_at', from.toIso8601String());
    if (to != null) dealQuery.lte('created_at', to.toIso8601String());
    final dealRows = (await dealQuery as List).cast<Map<String, dynamic>>();

    final jobQuery = _client
        .from('jobs')
        .select('id, client_id, deal_id, actual_cost, opened_at')
        .eq('company_id', intCompanyId);
    if (from != null) jobQuery.gte('opened_at', from.toIso8601String());
    if (to != null) jobQuery.lte('opened_at', to.toIso8601String());
    final jobRows = (await jobQuery as List).cast<Map<String, dynamic>>();

    final revenueByClient = <String, double>{};
    final dealClientById = <String, String>{};
    for (final d in dealRows) {
      final clientId = d['client_id']?.toString();
      final dealId = d['id']?.toString();
      if (clientId == null) continue;
      if (dealId != null) dealClientById[dealId] = clientId;
      final offer = (d['offer_amount'] as num?)?.toDouble() ?? 0;
      revenueByClient[clientId] = (revenueByClient[clientId] ?? 0) + offer;
    }

    final costByClient = <String, double>{};
    for (final j in jobRows) {
      final directClientId = j['client_id']?.toString();
      final viaDealClientId = dealClientById[j['deal_id']?.toString() ?? ''];
      final clientId = directClientId ?? viaDealClientId;
      if (clientId == null) continue;
      final actualCost = (j['actual_cost'] as num?)?.toDouble() ?? 0;
      costByClient[clientId] = (costByClient[clientId] ?? 0) + actualCost;
    }

    final output = <Map<String, dynamic>>[];
    for (final c in clientRows) {
      final clientId = c['id']?.toString();
      if (clientId == null) continue;
      final revenue = revenueByClient[clientId] ?? 0;
      final cost = costByClient[clientId] ?? 0;
      output.add({
        'client_id': clientId,
        'client_name': c['name']?.toString() ?? 'Unnamed client',
        'revenue': revenue,
        'cost': cost,
        'gross_profit': revenue - cost,
      });
    }
    output.sort(
      (a, b) => ((a['gross_profit'] as num?) ?? 0).compareTo(
        (b['gross_profit'] as num?) ?? 0,
      ),
    );
    return output;
  }

  static Future<Map<String, num>> getExecutiveScorecards({
    required String companyId,
    DateTime? from,
    DateTime? to,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null) {
      return const {
        'completion_rate': 0,
        'sla_on_time_rate': 0,
        'gross_margin_rate': 0,
        'collection_rate': 0,
        'overdue_rate': 0,
      };
    }
    final now = DateTime.now();
    final fromTs = from ?? DateTime(now.year, now.month, 1);
    final toTs = to ?? now;

    final jobs =
        (await _client
                    .from('jobs')
                    .select(
                      'id, status, opened_at, scheduled_end, closed_at, actual_cost',
                    )
                    .eq('company_id', cid)
                    .gte('opened_at', fromTs.toIso8601String())
                    .lte('opened_at', toTs.toIso8601String())
                as List)
            .cast<Map<String, dynamic>>();
    final deals =
        (await _client
                    .from('client_deals')
                    .select('offer_amount, created_at')
                    .eq('company_id', cid)
                    .gte('created_at', fromTs.toIso8601String())
                    .lte('created_at', toTs.toIso8601String())
                as List)
            .cast<Map<String, dynamic>>();
    final payments =
        (await _client
                    .from('client_payments')
                    .select('amount_due, status, due_date')
                    .eq('company_id', cid)
                    .gte('created_at', fromTs.toIso8601String())
                    .lte('created_at', toTs.toIso8601String())
                as List)
            .cast<Map<String, dynamic>>();

    final totalJobs = jobs.length;
    final completed = jobs
        .where(
          (j) => (j['status']?.toString().toLowerCase() ?? '') == 'completed',
        )
        .length;
    final onTimeCompleted = jobs.where((j) {
      final status = (j['status']?.toString().toLowerCase() ?? '');
      if (status != 'completed') return false;
      final closedAt = DateTime.tryParse(j['closed_at']?.toString() ?? '');
      final scheduledEnd = DateTime.tryParse(
        j['scheduled_end']?.toString() ?? '',
      );
      if (closedAt == null || scheduledEnd == null) return false;
      return !closedAt.isAfter(scheduledEnd);
    }).length;

    double revenue = 0;
    double cost = 0;
    for (final d in deals) {
      revenue += (d['offer_amount'] as num?)?.toDouble() ?? 0;
    }
    for (final j in jobs) {
      cost += (j['actual_cost'] as num?)?.toDouble() ?? 0;
    }
    double paid = 0;
    double totalDue = 0;
    int overdue = 0;
    for (final p in payments) {
      final amount = (p['amount_due'] as num?)?.toDouble() ?? 0;
      totalDue += amount;
      if ((p['status']?.toString().toLowerCase() ?? '') == 'paid') {
        paid += amount;
      } else {
        final dueDate = DateTime.tryParse(p['due_date']?.toString() ?? '');
        if (dueDate != null && now.isAfter(dueDate)) overdue++;
      }
    }

    return {
      'completion_rate': totalJobs == 0 ? 0 : (completed / totalJobs) * 100,
      'sla_on_time_rate': completed == 0
          ? 0
          : (onTimeCompleted / completed) * 100,
      'gross_margin_rate': revenue <= 0
          ? 0
          : ((revenue - cost) / revenue) * 100,
      'collection_rate': totalDue <= 0 ? 0 : (paid / totalDue) * 100,
      'overdue_rate': payments.isEmpty ? 0 : (overdue / payments.length) * 100,
    };
  }

  static Future<Map<String, num>> getExecutiveTrendSnapshot({
    required String companyId,
    int windowDays = 30,
  }) async {
    final now = DateTime.now();
    final currentFrom = now.subtract(Duration(days: windowDays));
    final previousFrom = currentFrom.subtract(Duration(days: windowDays));
    final previousTo = currentFrom;
    final current = await getExecutiveScorecards(
      companyId: companyId,
      from: currentFrom,
      to: now,
    );
    final previous = await getExecutiveScorecards(
      companyId: companyId,
      from: previousFrom,
      to: previousTo,
    );
    num delta(String key) => (current[key] ?? 0) - (previous[key] ?? 0);
    return {
      'completion_rate_delta': delta('completion_rate'),
      'sla_on_time_rate_delta': delta('sla_on_time_rate'),
      'gross_margin_rate_delta': delta('gross_margin_rate'),
      'collection_rate_delta': delta('collection_rate'),
      'overdue_rate_delta': delta('overdue_rate'),
    };
  }

  static Future<List<Map<String, dynamic>>> getExecutiveBreakdown({
    required String companyId,
    required String dimension, // client | contractor | branch
    DateTime? from,
    DateTime? to,
    int limit = 12,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null) return const [];
    final now = DateTime.now();
    final fromTs = from ?? DateTime(now.year, now.month, 1);
    final toTs = to ?? now;

    final jobs =
        (await _client
                    .from('jobs')
                    .select(
                      'id, client_id, contractor_id, assignee_employee_id, status, actual_cost, agreed_amount, opened_at',
                    )
                    .eq('company_id', cid)
                    .gte('opened_at', fromTs.toIso8601String())
                    .lte('opened_at', toTs.toIso8601String())
                as List)
            .cast<Map<String, dynamic>>();

    final clients =
        (await _client.from('clients').select('id, name').eq('company_id', cid)
                as List)
            .cast<Map<String, dynamic>>();
    final contractors =
        (await _client
                    .from('contractors')
                    .select('id, name')
                    .eq('company_id', cid)
                as List)
            .cast<Map<String, dynamic>>();
    final employees =
        (await _client
                    .from('employees')
                    .select('id, branch')
                    .eq('company_id', cid)
                as List)
            .cast<Map<String, dynamic>>();

    final clientNames = {
      for (final r in clients)
        r['id'].toString(): r['name']?.toString() ?? 'Client',
    };
    final contractorNames = {
      for (final r in contractors)
        r['id'].toString(): r['name']?.toString() ?? 'Contractor',
    };
    final branchByEmployee = {
      for (final r in employees)
        r['id'].toString(): r['branch']?.toString() ?? 'Unassigned',
    };

    final agg = <String, Map<String, dynamic>>{};
    for (final j in jobs) {
      String key;
      String label;
      if (dimension == 'contractor') {
        key = j['contractor_id']?.toString() ?? '';
        if (key.isEmpty) continue;
        label = contractorNames[key] ?? 'Contractor #$key';
      } else if (dimension == 'branch') {
        key =
            branchByEmployee[j['assignee_employee_id']?.toString() ?? ''] ??
            'Unassigned';
        label = key;
      } else {
        key = j['client_id']?.toString() ?? '';
        if (key.isEmpty) continue;
        label = clientNames[key] ?? 'Client #$key';
      }
      final row = agg.putIfAbsent(
        key,
        () => {
          'key': key,
          'label': label,
          'jobs': 0,
          'completed': 0,
          'revenue': 0.0,
          'cost': 0.0,
        },
      );
      row['jobs'] = (row['jobs'] as int) + 1;
      if ((j['status']?.toString().toLowerCase() ?? '') == 'completed') {
        row['completed'] = (row['completed'] as int) + 1;
      }
      row['revenue'] =
          (row['revenue'] as double) +
          ((j['agreed_amount'] as num?)?.toDouble() ?? 0);
      row['cost'] =
          (row['cost'] as double) +
          ((j['actual_cost'] as num?)?.toDouble() ?? 0);
    }

    final rows = agg.values.map((r) {
      final jobsCount = (r['jobs'] as int);
      final completed = (r['completed'] as int);
      final revenue = (r['revenue'] as double);
      final cost = (r['cost'] as double);
      return {
        'label': r['label'],
        'jobs': jobsCount,
        'completion_rate': jobsCount == 0 ? 0 : (completed / jobsCount) * 100,
        'margin_rate': revenue <= 0 ? 0 : ((revenue - cost) / revenue) * 100,
        'revenue': revenue,
        'cost': cost,
      };
    }).toList();
    rows.sort(
      (a, b) =>
          ((b['revenue'] as num?) ?? 0).compareTo((a['revenue'] as num?) ?? 0),
    );
    return rows.take(limit).toList();
  }

  static Future<List<Map<String, dynamic>>> getExecutiveRecommendations({
    required String companyId,
  }) async {
    final score = await getExecutiveScorecards(companyId: companyId);
    final trend = await getExecutiveTrendSnapshot(
      companyId: companyId,
      windowDays: 30,
    );
    final out = <Map<String, dynamic>>[];

    final overdueRate = (score['overdue_rate'] ?? 0).toDouble();
    if (overdueRate > 20) {
      out.add({
        'priority': 'high',
        'title': 'Reduce overdue invoices',
        'action':
            'Focus collections workflow and follow up weekly on unpaid client payments.',
      });
    }
    final margin = (score['gross_margin_rate'] ?? 0).toDouble();
    if (margin < 25) {
      out.add({
        'priority': 'high',
        'title': 'Margin pressure detected',
        'action':
            'Review high-cost jobs and rebalance assignment/contractor mix.',
      });
    }
    final slaTrend = (trend['sla_on_time_rate_delta'] ?? 0).toDouble();
    if (slaTrend < -5) {
      out.add({
        'priority': 'medium',
        'title': 'SLA trend declining',
        'action': 'Increase proactive reassignment for high-risk overdue jobs.',
      });
    }
    final completionTrend = (trend['completion_rate_delta'] ?? 0).toDouble();
    if (completionTrend < -5) {
      out.add({
        'priority': 'medium',
        'title': 'Completion rate down',
        'action':
            'Check staffing load by branch and prioritize critical tickets.',
      });
    }
    if (out.isEmpty) {
      out.add({
        'priority': 'info',
        'title': 'Performance stable',
        'action':
            'Maintain current dispatch and escalation settings; monitor weekly.',
      });
    }
    return out;
  }

  static Future<List<Map<String, dynamic>>> getDispatchSuggestions({
    required String companyId,
    DateTime? scheduledStart,
    DateTime? scheduledEnd,
    int limit = 6,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];

    final dispatchSettings = await getDispatchSettings(companyId: companyId);
    final workloadPenalty =
        (dispatchSettings['workload_penalty_per_active_job'] as num?)
            ?.toDouble() ??
        10;
    final conflictPenalty =
        (dispatchSettings['conflict_penalty'] as num?)?.toDouble() ?? 25;
    final employeeBonus =
        (dispatchSettings['employee_preference_bonus'] as num?)?.toDouble() ??
        8;
    final technicianBonus =
        (dispatchSettings['technician_preference_bonus'] as num?)?.toDouble() ??
        4;
    final contractorPenalty =
        (dispatchSettings['contractor_penalty'] as num?)?.toDouble() ?? 6;
    final maxActiveJobs =
        (dispatchSettings['max_active_jobs'] as num?)?.toDouble() ?? 8;
    final excludeConflicts =
        (dispatchSettings['exclude_conflicts'] as bool?) ?? false;

    final employeeRows =
        (await _client
                    .from('employees')
                    .select('id, name, surname, worker_type, is_active, branch')
                    .eq('company_id', intCompanyId)
                as List)
            .cast<Map<String, dynamic>>();
    final employees = employeeRows.where((e) => e['is_active'] != false).where((
      e,
    ) {
      final wt = (e['worker_type']?.toString() ?? 'employee').toLowerCase();
      return wt == 'employee' ||
          wt == 'technician' ||
          wt == 'contractor' ||
          wt == 'subcontractor';
    }).toList();
    if (employees.isEmpty) return const [];

    final jobs =
        (await _client
                    .from('jobs')
                    .select(
                      'id, status, scheduled_start, scheduled_end, assigned_employee_ids, assignee_employee_id, contractor_employee_id',
                    )
                    .eq('company_id', intCompanyId)
                as List)
            .cast<Map<String, dynamic>>();

    final activeLoadByEmp = <String, int>{};
    for (final row in jobs) {
      final status = (row['status']?.toString() ?? '').toLowerCase();
      if (status == 'completed' || status == 'cancelled') continue;
      final ids = <String>{};
      final arr = (row['assigned_employee_ids'] as List?) ?? const [];
      for (final v in arr) {
        final s = v.toString();
        if (s.isNotEmpty) ids.add(s);
      }
      final assignee = row['assignee_employee_id']?.toString();
      if (assignee != null && assignee.isNotEmpty) ids.add(assignee);
      final contractor = row['contractor_employee_id']?.toString();
      if (contractor != null && contractor.isNotEmpty) ids.add(contractor);
      for (final id in ids) {
        activeLoadByEmp[id] = (activeLoadByEmp[id] ?? 0) + 1;
      }
    }

    bool hasConflict(Map<String, dynamic> job) {
      if (scheduledStart == null || scheduledEnd == null) return false;
      final js = DateTime.tryParse(job['scheduled_start']?.toString() ?? '');
      final je = DateTime.tryParse(job['scheduled_end']?.toString() ?? '');
      if (js == null || je == null) return false;
      return scheduledStart.isBefore(je) && scheduledEnd.isAfter(js);
    }

    final conflictByEmp = <String, int>{};
    for (final row in jobs.where(hasConflict)) {
      final ids = <String>{};
      final arr = (row['assigned_employee_ids'] as List?) ?? const [];
      for (final v in arr) {
        final s = v.toString();
        if (s.isNotEmpty) ids.add(s);
      }
      final assignee = row['assignee_employee_id']?.toString();
      if (assignee != null && assignee.isNotEmpty) ids.add(assignee);
      final contractor = row['contractor_employee_id']?.toString();
      if (contractor != null && contractor.isNotEmpty) ids.add(contractor);
      for (final id in ids) {
        conflictByEmp[id] = (conflictByEmp[id] ?? 0) + 1;
      }
    }

    final scored = employees.map((e) {
      final id = e['id'].toString();
      final workerType = (e['worker_type']?.toString() ?? 'employee')
          .toLowerCase();
      final activeJobs = activeLoadByEmp[id] ?? 0;
      final conflicts = conflictByEmp[id] ?? 0;
      final preferenceBonus = switch (workerType) {
        'employee' => employeeBonus,
        'technician' => technicianBonus,
        'contractor' || 'subcontractor' => -contractorPenalty,
        _ => 0.0,
      };
      var score =
          (100 -
                  (activeJobs * workloadPenalty) -
                  (conflicts * conflictPenalty) +
                  preferenceBonus)
              .clamp(0, 100)
              .toDouble();
      if (activeJobs >= maxActiveJobs) {
        score = (score - 12).clamp(0, 100).toDouble();
      }
      if (excludeConflicts && conflicts > 0) {
        score = 0;
      }
      final reasonParts = <String>[
        'active jobs: $activeJobs',
        if (conflicts > 0) 'conflicts: $conflicts',
        if (activeJobs >= maxActiveJobs) 'near load cap',
        if (preferenceBonus > 0) 'preferred type',
        if (preferenceBonus < 0) 'contractor penalty',
      ];
      return {
        'employee_id': id,
        'full_name': '${e['name'] ?? ''} ${e['surname'] ?? ''}'.trim(),
        'worker_type': workerType,
        'branch': e['branch']?.toString(),
        'active_jobs': activeJobs,
        'schedule_conflicts': conflicts,
        'score': score,
        'score_reason': reasonParts.join(' • '),
      };
    }).toList();

    scored.sort((a, b) => (b['score'] as num).compareTo(a['score'] as num));
    return scored.take(limit).toList();
  }

  static Future<Map<String, num>> getPreventiveMaintenanceKpis({
    required String companyId,
    DateTime? from,
    DateTime? to,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) {
      return const {'generated': 0, 'completed': 0, 'overdue_open': 0};
    }
    final query = _client
        .from('jobs')
        .select('status, is_preventive, scheduled_end, external_ref, opened_at')
        .eq('company_id', intCompanyId)
        .eq('is_preventive', true);
    if (from != null) query.gte('opened_at', from.toIso8601String());
    if (to != null) query.lte('opened_at', to.toIso8601String());
    final rows = (await query as List).cast<Map<String, dynamic>>();
    final now = DateTime.now();

    int generated = 0;
    int completed = 0;
    int overdueOpen = 0;
    for (final row in rows) {
      final status = (row['status']?.toString() ?? '').toLowerCase();
      final scheduledEnd = DateTime.tryParse(
        row['scheduled_end']?.toString() ?? '',
      );
      final externalRef = row['external_ref']?.toString() ?? '';
      if (externalRef.startsWith('pm_sched:')) {
        generated++;
      }
      if (status == 'completed') completed++;
      if (status != 'completed' &&
          status != 'cancelled' &&
          scheduledEnd != null &&
          now.isAfter(scheduledEnd)) {
        overdueOpen++;
      }
    }
    return {
      'generated': generated,
      'completed': completed,
      'overdue_open': overdueOpen,
    };
  }

  static double _haversineMeters(
    double lat1,
    double lon1,
    double lat2,
    double lon2,
  ) {
    const r = 6371000.0;
    final dLat = (lat2 - lat1) * 0.017453292519943295;
    final dLon = (lon2 - lon1) * 0.017453292519943295;
    final a =
        (sin(dLat / 2) * sin(dLat / 2)) +
        cos(lat1 * 0.017453292519943295) *
            cos(lat2 * 0.017453292519943295) *
            (sin(dLon / 2) * sin(dLon / 2));
    final c = 2 * atan2(sqrt(a), sqrt(1 - a));
    return r * c;
  }

  static Future<CompanyRegistrationResult> registerCompanySelfService({
    required String companyName,
    String ownerFirstName = '',
    String ownerLastName = '',
  }) async {
    final data = await _client.rpc(
      'self_register_company',
      params: {
        'p_company_name': companyName.trim(),
        'p_owner_first_name': ownerFirstName.trim(),
        'p_owner_last_name': ownerLastName.trim(),
      },
    );
    final row = Map<String, dynamic>.from((data as List).first as Map);
    return CompanyRegistrationResult(
      companyId: row['company_id'].toString(),
      companyCode: row['company_code'].toString(),
    );
  }

  /// Current HR owner transfers primary ownership to another active HR user
  /// in the same company (caller becomes admin).
  static Future<void> transferHrCompanyOwnership({
    required String companyId,
    required String newOwnerAuthUserId,
  }) async {
    final cid = int.tryParse(companyId);
    if (cid == null || newOwnerAuthUserId.trim().isEmpty) return;
    await _client.rpc(
      'transfer_hr_company_owner',
      params: {
        'p_company_id': cid,
        'p_new_owner_auth_user_id': newOwnerAuthUserId.trim(),
      },
    );
  }

  static Future<List<RpcHealthCheckResult>> runEmployeeRpcHealthCheck({
    required String companyId,
  }) async {
    final results = <RpcHealthCheckResult>[];
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) {
      return const [
        RpcHealthCheckResult(
          name: 'input',
          ok: false,
          details: 'Invalid company id format.',
        ),
      ];
    }

    try {
      final emp = await _client
          .from('employees')
          .select('id')
          .eq('company_id', intCompanyId)
          .order('id')
          .limit(1)
          .maybeSingle();
      if (emp == null) {
        return const [
          RpcHealthCheckResult(
            name: 'seed-data',
            ok: false,
            details: 'No employees found in this company.',
          ),
        ];
      }
      final intEmployeeId = (emp['id'] as num).toInt();

      Future<void> check(String name, Future<void> Function() fn) async {
        try {
          await fn();
          results.add(
            RpcHealthCheckResult(name: name, ok: true, details: 'ok'),
          );
        } catch (e) {
          results.add(
            RpcHealthCheckResult(name: name, ok: false, details: e.toString()),
          );
        }
      }

      await check('employee_get_jobs_for_employee', () async {
        await _client.rpc(
          'employee_get_jobs_for_employee',
          params: {
            'p_company_id': intCompanyId,
            'p_employee_id': intEmployeeId,
          },
        );
      });

      await check('employee_get_incidents_for_employee', () async {
        await _client.rpc(
          'employee_get_incidents_for_employee',
          params: {
            'p_company_id': intCompanyId,
            'p_employee_id': intEmployeeId,
          },
        );
      });

      await check('employee_get_inventory_items', () async {
        await _client.rpc(
          'employee_get_inventory_items',
          params: {
            'p_company_id': intCompanyId,
            'p_employee_id': intEmployeeId,
          },
        );
      });

      final job = await _client
          .from('jobs')
          .select('id')
          .eq('company_id', intCompanyId)
          .contains('assigned_employee_ids', [intEmployeeId])
          .order('id')
          .limit(1)
          .maybeSingle();
      final intJobId = (job?['id'] as num?)?.toInt();

      if (intJobId == null) {
        results.add(
          const RpcHealthCheckResult(
            name: 'employee_get_job_card_for_job',
            ok: true,
            details: 'skipped (no assigned job found)',
          ),
        );
        results.add(
          const RpcHealthCheckResult(
            name: 'employee_get_inventory_usage_for_job',
            ok: true,
            details: 'skipped (no assigned job found)',
          ),
        );
      } else {
        await check('employee_get_job_card_for_job', () async {
          await _client.rpc(
            'employee_get_job_card_for_job',
            params: {
              'p_company_id': intCompanyId,
              'p_job_id': intJobId,
              'p_employee_id': intEmployeeId,
            },
          );
        });

        await check('employee_get_inventory_usage_for_job', () async {
          await _client.rpc(
            'employee_get_inventory_usage_for_job',
            params: {
              'p_company_id': intCompanyId,
              'p_job_id': intJobId,
              'p_employee_id': intEmployeeId,
            },
          );
        });
      }
    } catch (e) {
      results.add(
        RpcHealthCheckResult(
          name: 'health-check-bootstrap',
          ok: false,
          details: e.toString(),
        ),
      );
    }

    return results;
  }

  static Future<int> enqueueDailyOperationalReminders() async {
    final res = await _client.rpc('enqueue_daily_operational_reminders');
    if (res is int) return res;
    if (res is num) return res.toInt();
    return 0;
  }

  static Future<void> _insertEmployeeNotifications({
    required int companyId,
    required Set<String> employeeIds,
    required String type,
    required String title,
    required String body,
    String? refType,
    String? refId,
    String? dedupeKeyBase,
  }) async {
    if (employeeIds.isEmpty) return;
    final rows = <Map<String, dynamic>>[];
    for (final employeeId in employeeIds) {
      final intEmpId = int.tryParse(employeeId);
      if (intEmpId == null) continue;
      rows.add({
        'company_id': companyId,
        'audience': 'employee',
        'recipient_employee_id': intEmpId,
        'type': type,
        'title': title,
        'body': body,
        'ref_type': refType,
        'ref_id': refId,
        if (dedupeKeyBase != null) 'dedupe_key': '$dedupeKeyBase:$intEmpId',
      });
    }
    if (rows.isEmpty) return;
    final inserted = dedupeKeyBase == null
        ? await _client
              .from('app_notifications')
              .insert(rows)
              .select('id, recipient_employee_id')
        : await _client
              .from('app_notifications')
              .upsert(rows, onConflict: 'dedupe_key')
              .select('id, recipient_employee_id');
    if (!_externalNotificationChannelsEnabled) return;
    final notifRows =
        (inserted as List?)?.cast<Map<String, dynamic>>() ??
        const <Map<String, dynamic>>[];
    if (notifRows.isEmpty) return;
    final empRows = await _client
        .from('employees')
        .select('id, email')
        .eq('company_id', companyId)
        .inFilter(
          'id',
          notifRows
              .map((r) => r['recipient_employee_id'])
              .whereType<int>()
              .toList(),
        );
    final emailByEmp = <int, String?>{
      for (final e in (empRows as List).cast<Map<String, dynamic>>())
        (e['id'] as num).toInt(): e['email']?.toString(),
    };
    final deliveries = <Map<String, dynamic>>[];
    for (final n in notifRows) {
      final notificationId = n['id'] as int?;
      final employeeId = n['recipient_employee_id'] as int?;
      if (notificationId == null || employeeId == null) continue;
      deliveries.add({
        'company_id': companyId,
        'notification_id': notificationId,
        'channel': 'push',
        'recipient_employee_id': employeeId,
      });
      final email = emailByEmp[employeeId];
      if (email != null && email.trim().isNotEmpty) {
        deliveries.add({
          'company_id': companyId,
          'notification_id': notificationId,
          'channel': 'email',
          'recipient_employee_id': employeeId,
          'recipient_email': email.trim().toLowerCase(),
        });
      }
    }
    if (deliveries.isNotEmpty) {
      await _client.from('app_notification_deliveries').insert(deliveries);
    }
  }

  static Future<void> _insertHrNotification({
    required int companyId,
    required String type,
    required String title,
    required String body,
    String? refType,
    String? refId,
    String? dedupeKey,
  }) async {
    final hrRows = await _client
        .from('hr_users')
        .select('auth_user_id')
        .eq('company_id', companyId)
        .eq('is_active', true);
    final users = (hrRows as List).cast<Map<String, dynamic>>();
    if (users.isEmpty) return;
    final rows = <Map<String, dynamic>>[];
    for (final u in users) {
      final authId = u['auth_user_id']?.toString();
      if (authId == null || authId.isEmpty) continue;
      rows.add({
        'company_id': companyId,
        'audience': 'hr',
        'recipient_auth_user_id': authId,
        'type': type,
        'title': title,
        'body': body,
        'ref_type': refType,
        'ref_id': refId,
        if (dedupeKey != null) 'dedupe_key': '$dedupeKey:$authId',
      });
    }
    if (rows.isEmpty) return;
    final inserted = await _client
        .from('app_notifications')
        .upsert(rows, onConflict: 'dedupe_key')
        .select('id');
    if (!_externalNotificationChannelsEnabled) return;
    final notifRows =
        (inserted as List?)?.cast<Map<String, dynamic>>() ??
        const <Map<String, dynamic>>[];
    if (notifRows.isNotEmpty) {
      final deliveries = notifRows
          .map(
            (n) => {
              'company_id': companyId,
              'notification_id': n['id'],
              'channel': 'email',
              'status': 'pending',
            },
          )
          .toList();
      await _client.from('app_notification_deliveries').insert(deliveries);
    }
  }

  static Future<void> registerEmployeePushToken({
    required String companyId,
    required String employeeId,
    required String token,
    String? platform,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmployeeId = int.tryParse(employeeId);
    if (intCompanyId == null || intEmployeeId == null) return;
    final t = token.trim();
    if (t.isEmpty) return;
    await _client.from('employee_push_tokens').upsert({
      'company_id': intCompanyId,
      'employee_id': intEmployeeId,
      'token': t,
      'platform': platform,
      'is_active': true,
      'last_seen_at': DateTime.now().toIso8601String(),
    }, onConflict: 'company_id,employee_id,token');
  }

  static Future<void> dispatchNotificationDeliveries({
    required String companyId,
    int limit = 40,
  }) async {
    if (!_externalNotificationChannelsEnabled) return;
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return;
    try {
      await _client.functions.invoke(
        'notify_dispatch',
        body: {'company_id': intCompanyId, 'limit': limit},
      );
    } catch (_) {}
  }

  static Future<int> publishPendingRemindersAsNotifications({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return 0;
    final rows = await _client
        .from('app_reminders')
        .select('id, reminder_type, target_ref, payload')
        .eq('company_id', intCompanyId)
        .eq('status', 'pending')
        .lte('scheduled_for', DateTime.now().toIso8601String())
        .limit(50);
    final reminders = (rows as List).cast<Map<String, dynamic>>();
    if (reminders.isEmpty) return 0;
    var sent = 0;
    for (final r in reminders) {
      final rid = r['id']?.toString() ?? '';
      final type = (r['reminder_type']?.toString() ?? 'reminder');
      final targetRef = r['target_ref']?.toString();
      final payload =
          (r['payload'] as Map?)?.cast<String, dynamic>() ??
          <String, dynamic>{};
      final title = switch (type) {
        'missing_feedback' => 'Client feedback still missing',
        'pending_contractor_approvals' => 'Contractor approvals pending',
        'overdue_client_payment' => 'Client payment overdue',
        _ => 'Operational reminder',
      };
      final body = switch (type) {
        'missing_feedback' =>
          'A completed job still has no feedback request or response.',
        'pending_contractor_approvals' =>
          'Contractor payouts still require review.',
        'overdue_client_payment' => 'A client payment deadline has passed.',
        _ => 'Please review operational reminders.',
      };
      await _insertHrNotification(
        companyId: intCompanyId,
        type: type,
        title: title,
        body: body,
        refType: 'reminder',
        refId: targetRef ?? rid,
        dedupeKey: 'reminder:$rid',
      );
      await _client
          .from('app_reminders')
          .update({'status': 'sent'})
          .eq('company_id', intCompanyId)
          .eq('id', r['id']);
      await _client.from('app_notifications').insert({
        'company_id': intCompanyId,
        'audience': 'hr',
        'type': 'reminder_emitted',
        'title': 'Reminder emitted',
        'body': title,
        'ref_type': 'reminder',
        'ref_id': rid,
        'data': payload,
      });
      sent++;
    }
    return sent;
  }

  static Future<int> enqueuePaTaskNotifications({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return 0;
    final nowUtc = DateTime.now().toUtc();
    final dueSoonUtc = nowUtc.add(const Duration(minutes: 30));
    final rows =
        (await _client
                    .from('pa_tasks')
                    .select('id, title, due_at, remind_at, owner_employee_id')
                    .eq('company_id', intCompanyId)
                    .neq('status', 'done')
                    .or(
                      'and(remind_at.not.is.null,remind_at.lte.${nowUtc.toIso8601String()}),'
                      'and(due_at.not.is.null,due_at.lte.${dueSoonUtc.toIso8601String()})',
                    )
                    .limit(80)
                as List)
            .cast<Map<String, dynamic>>();
    if (rows.isEmpty) return 0;
    var emitted = 0;
    final dedupeWindow = DateFormat('yyyyMMddHH').format(DateTime.now());
    for (final r in rows) {
      final taskId = r['id']?.toString();
      if (taskId == null || taskId.isEmpty) continue;
      final taskTitle = r['title']?.toString().trim().isNotEmpty == true
          ? r['title'].toString().trim()
          : 'PA task';
      final remindAt = DateTime.tryParse(r['remind_at']?.toString() ?? '')
          ?.toUtc();
      final dueAt =
          DateTime.tryParse(r['due_at']?.toString() ?? '')?.toUtc();
      final remindHit =
          remindAt != null && !remindAt.isAfter(nowUtc);
      final dueHit = dueAt != null && !dueAt.isAfter(dueSoonUtc);
      final String notifType;
      final String title;
      final String body;
      if (remindHit && dueHit) {
        notifType = 'pa_task_remind_due';
        title = 'My PA — reminder & due soon';
        body =
            '$taskTitle: your reminder time has passed and the due time is approaching. Open My PA.';
      } else if (remindHit) {
        notifType = 'pa_task_remind';
        title = 'My PA reminder';
        body =
            '$taskTitle: scheduled reminder. Open My PA when you are ready.';
      } else {
        notifType = 'pa_task_due';
        title = 'My PA — due soon';
        body = '$taskTitle is due soon. Open My PA to review it.';
      }
      final ownerEmployeeId = r['owner_employee_id']?.toString();
      if (ownerEmployeeId != null && ownerEmployeeId.isNotEmpty) {
        await _insertEmployeeNotifications(
          companyId: intCompanyId,
          employeeIds: {ownerEmployeeId},
          type: notifType,
          title: title,
          body: body,
          refType: 'pa_task',
          refId: taskId,
          dedupeKeyBase: 'pa_task_nudge:$taskId:$dedupeWindow',
        );
      } else {
        await _insertHrNotification(
          companyId: intCompanyId,
          type: notifType,
          title: title,
          body: body,
          refType: 'pa_task',
          refId: taskId,
          dedupeKey: 'pa_task_nudge:$taskId:$dedupeWindow',
        );
      }
      emitted++;
    }
    return emitted;
  }

  static Future<int> emitSlaBreachNotifications({
    required String companyId,
    int limit = 60,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return 0;
    final now = DateTime.now();
    final todayKey = DateFormat('yyyyMMdd').format(now);
    final rows =
        (await _client
                    .from('jobs')
                    .select(
                      'id, title, status, opened_at, first_response_at, scheduled_end, closed_at',
                    )
                    .eq('company_id', intCompanyId)
                    .order('scheduled_end', ascending: true)
                    .limit(limit)
                as List)
            .cast<Map<String, dynamic>>();
    var emitted = 0;
    for (final row in rows) {
      final jobId = row['id']?.toString();
      if (jobId == null) continue;
      final title = (row['title']?.toString() ?? 'Untitled job').trim();
      final status = (row['status']?.toString() ?? '').toLowerCase();
      final openedAt = DateTime.tryParse(row['opened_at']?.toString() ?? '');
      final firstResponseAt = DateTime.tryParse(
        row['first_response_at']?.toString() ?? '',
      );
      final scheduledEnd = DateTime.tryParse(
        row['scheduled_end']?.toString() ?? '',
      );
      final closedAt = DateTime.tryParse(row['closed_at']?.toString() ?? '');
      final isOpen = status != 'completed' && status != 'cancelled';
      final responseBreached =
          openedAt != null &&
          firstResponseAt == null &&
          now.difference(openedAt).inHours > 2;
      final resolutionBreached =
          (isOpen && scheduledEnd != null && now.isAfter(scheduledEnd)) ||
          (!isOpen &&
              scheduledEnd != null &&
              closedAt != null &&
              closedAt.isAfter(scheduledEnd));

      if (responseBreached) {
        await _insertHrNotification(
          companyId: intCompanyId,
          type: 'sla_response_breach',
          title: 'SLA response breached',
          body: '$title has not received first response within 2 hours.',
          refType: 'job',
          refId: jobId,
          dedupeKey: 'sla_response:$jobId:$todayKey',
        );
        emitted++;
      }
      if (resolutionBreached) {
        await _insertHrNotification(
          companyId: intCompanyId,
          type: 'sla_resolution_breach',
          title: 'SLA resolution breached',
          body: '$title has missed its resolution target.',
          refType: 'job',
          refId: jobId,
          dedupeKey: 'sla_resolution:$jobId:$todayKey',
        );
        emitted++;
      }
    }
    return emitted;
  }

  static Future<List<Map<String, dynamic>>> getMyNotifications({
    required String companyId,
    String? employeeId,
    bool forHr = false,
    int limit = 80,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    dynamic data;
    if (forHr) {
      data = await _client
          .from('app_notifications')
          .select()
          .eq('company_id', intCompanyId)
          .or('audience.eq.hr,audience.eq.all')
          .order('created_at', ascending: false)
          .limit(limit);
    } else {
      final intEmpId = int.tryParse(employeeId ?? '');
      if (intEmpId == null) return const [];
      data = await _client
          .from('app_notifications')
          .select()
          .eq('company_id', intCompanyId)
          .eq('audience', 'employee')
          .eq('recipient_employee_id', intEmpId)
          .order('created_at', ascending: false)
          .limit(limit);
    }
    return (data as List).cast<Map<String, dynamic>>();
  }

  static Future<int> getUnreadNotificationsCount({
    required String companyId,
    String? employeeId,
    bool forHr = false,
  }) async {
    final rows = await getMyNotifications(
      companyId: companyId,
      employeeId: employeeId,
      forHr: forHr,
      limit: 200,
    );
    return rows.where((r) => r['is_read'] != true).length;
  }

  static Future<void> markNotificationRead(String notificationId) async {
    final intId = int.tryParse(notificationId);
    if (intId == null) return;
    await _client
        .from('app_notifications')
        .update({'is_read': true, 'read_at': DateTime.now().toIso8601String()})
        .eq('id', intId);
  }

  static Future<void> markAllMyNotificationsRead({
    required String companyId,
    String? employeeId,
    bool forHr = false,
  }) async {
    final rows = await getMyNotifications(
      companyId: companyId,
      employeeId: employeeId,
      forHr: forHr,
      limit: 200,
    );
    final ids = rows
        .where((r) => r['is_read'] != true)
        .map((r) => r['id'])
        .whereType<int>()
        .toList();
    if (ids.isEmpty) return;
    await _client
        .from('app_notifications')
        .update({'is_read': true, 'read_at': DateTime.now().toIso8601String()})
        .inFilter('id', ids);
  }

  // ---- Contractors (parent entity + members) -------------------------------

  static Future<List<Contractor>> getContractors({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final data = await _client
        .from('contractors')
        .select()
        .eq('company_id', intCompanyId)
        .order('display_name');
    final rows = (data as List).cast<Map<String, dynamic>>();
    return rows
        .map(
          (r) => Contractor(
            id: r['id'].toString(),
            companyId: r['company_id'].toString(),
            contractorType: r['contractor_type']?.toString() ?? 'individual',
            displayName: r['display_name']?.toString() ?? '',
            allowMembersViewAllJobs: r['allow_members_view_all_jobs'] == null
                ? true
                : r['allow_members_view_all_jobs'] == true,
            linkedCompanyId: r['linked_company_id']?.toString(),
            linkedCompanyStatus: r['linked_company_status']?.toString(),
            contactPerson: r['contact_person']?.toString(),
            email: r['email']?.toString(),
            phone: r['phone']?.toString(),
            status: r['status']?.toString() ?? 'active',
            notes: r['notes']?.toString(),
          ),
        )
        .toList();
  }

  static Future<Contractor?> getContractorById({
    required String companyId,
    required String contractorId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intContractorId = int.tryParse(contractorId);
    if (intCompanyId == null || intContractorId == null) return null;
    final row = await _client
        .from('contractors')
        .select()
        .eq('company_id', intCompanyId)
        .eq('id', intContractorId)
        .maybeSingle();
    if (row == null) return null;
    return Contractor(
      id: row['id'].toString(),
      companyId: row['company_id'].toString(),
      contractorType: row['contractor_type']?.toString() ?? 'individual',
      displayName: row['display_name']?.toString() ?? '',
      allowMembersViewAllJobs: row['allow_members_view_all_jobs'] == null
          ? true
          : row['allow_members_view_all_jobs'] == true,
      linkedCompanyId: row['linked_company_id']?.toString(),
      linkedCompanyStatus: row['linked_company_status']?.toString(),
      contactPerson: row['contact_person']?.toString(),
      email: row['email']?.toString(),
      phone: row['phone']?.toString(),
      status: row['status']?.toString() ?? 'active',
      notes: row['notes']?.toString(),
    );
  }

  static Future<String?> upsertContractor({
    required String companyId,
    String? id,
    required String contractorType,
    required String displayName,
    String? contactPerson,
    String? email,
    String? phone,
    bool allowMembersViewAllJobs = true,
    String? linkedCompanyId,
    String? linkedCompanyStatus,
    String status = 'active',
    String? notes,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intId = int.tryParse(id ?? '');
    if (intCompanyId == null) return null;
    final payload = <String, dynamic>{
      'company_id': intCompanyId,
      'contractor_type': contractorType,
      'display_name': displayName.trim(),
      'contact_person': contactPerson?.trim().isEmpty == true
          ? null
          : contactPerson?.trim(),
      'email': email?.trim().isEmpty == true
          ? null
          : email?.trim().toLowerCase(),
      'phone': phone?.trim().isEmpty == true ? null : phone?.trim(),
      'allow_members_view_all_jobs': allowMembersViewAllJobs,
      'linked_company_id': int.tryParse(linkedCompanyId ?? ''),
      'linked_company_status': linkedCompanyStatus ?? 'unlinked',
      'status': status,
      'notes': notes?.trim().isEmpty == true ? null : notes?.trim(),
      'updated_at': DateTime.now().toIso8601String(),
    };
    final row = intId == null
        ? await _client
              .from('contractors')
              .insert(payload)
              .select('id')
              .maybeSingle()
        : await _client
              .from('contractors')
              .upsert({'id': intId, ...payload})
              .select('id')
              .maybeSingle();
    return row?['id']?.toString();
  }

  static Future<void> setContractorMembers({
    required String companyId,
    required String contractorId,
    required List<String> employeeIds,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intContractorId = int.tryParse(contractorId);
    if (intCompanyId == null || intContractorId == null) return;
    await _client
        .from('contractor_members')
        .delete()
        .eq('company_id', intCompanyId)
        .eq('contractor_id', intContractorId);
    final rows = employeeIds
        .map((e) => int.tryParse(e))
        .whereType<int>()
        .map(
          (employeeId) => {
            'company_id': intCompanyId,
            'contractor_id': intContractorId,
            'employee_id': employeeId,
          },
        )
        .toList();
    if (rows.isNotEmpty) {
      await _client.from('contractor_members').insert(rows);
    }
  }

  static Future<void> setContractorMembersDetailed({
    required String companyId,
    required String contractorId,
    required List<ContractorMemberLink> members,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intContractorId = int.tryParse(contractorId);
    if (intCompanyId == null || intContractorId == null) return;
    await _client
        .from('contractor_members')
        .delete()
        .eq('company_id', intCompanyId)
        .eq('contractor_id', intContractorId);
    final rows = members
        .where((m) => m.contractorId == contractorId)
        .map(
          (m) => {
            'company_id': intCompanyId,
            'contractor_id': intContractorId,
            'employee_id': int.tryParse(m.employeeId),
            'role_label': m.roleLabel?.trim().isEmpty == true
                ? null
                : m.roleLabel?.trim(),
            'is_primary': m.isPrimary,
          },
        )
        .where((r) => r['employee_id'] != null)
        .toList();
    if (rows.isNotEmpty) {
      await _client.from('contractor_members').insert(rows);
    }
  }

  static Future<Map<String, List<String>>> getContractorMemberIdsByContractor({
    required String companyId,
  }) async {
    final detailed = await getContractorMembersByContractor(
      companyId: companyId,
    );
    final map = <String, List<String>>{};
    for (final entry in detailed.entries) {
      map[entry.key] = entry.value.map((m) => m.employeeId).toList();
    }
    return map;
  }

  static Future<Map<String, List<ContractorMemberLink>>>
  getContractorMembersByContractor({required String companyId}) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const {};
    final data = await _client
        .from('contractor_members')
        .select('contractor_id, employee_id, role_label, is_primary')
        .eq('company_id', intCompanyId);
    final rows = (data as List).cast<Map<String, dynamic>>();
    final map = <String, List<ContractorMemberLink>>{};
    for (final r in rows) {
      final contractorId = r['contractor_id']?.toString();
      final employeeId = r['employee_id']?.toString();
      if (contractorId == null || employeeId == null) continue;
      map
          .putIfAbsent(contractorId, () => <ContractorMemberLink>[])
          .add(
            ContractorMemberLink(
              contractorId: contractorId,
              employeeId: employeeId,
              roleLabel: r['role_label']?.toString(),
              isPrimary: r['is_primary'] == true,
            ),
          );
    }
    return map;
  }

  static Future<Map<String, dynamic>> linkContractorToRegisteredCompany({
    required String requesterCompanyId,
    required String contractorId,
    required String recipientCompanyCode,
    bool autoCreateClient = true,
  }) async {
    final intRequesterCompanyId = int.tryParse(requesterCompanyId);
    final intContractorId = int.tryParse(contractorId);
    if (intRequesterCompanyId == null || intContractorId == null) {
      return const {'ok': false, 'reason': 'invalid_ids'};
    }
    final result = await _client.rpc(
      'company_link_existing_contractor_company',
      params: {
        'p_requester_company_id': intRequesterCompanyId,
        'p_contractor_id': intContractorId,
        'p_recipient_company_code': recipientCompanyCode.trim(),
        'p_auto_create_client': autoCreateClient,
      },
    );
    if (result is Map<String, dynamic>) return result;
    if (result is Map) return result.cast<String, dynamic>();
    return const {'ok': false, 'reason': 'unexpected_response'};
  }

  static Future<Map<String, dynamic>> requestContractorCompanyLink({
    required String requesterCompanyId,
    required String contractorId,
    required String recipientCompanyCode,
  }) async {
    final intRequesterCompanyId = int.tryParse(requesterCompanyId);
    final intContractorId = int.tryParse(contractorId);
    if (intRequesterCompanyId == null || intContractorId == null) {
      return const {'ok': false, 'reason': 'invalid_ids'};
    }
    final result = await _client.rpc(
      'company_request_contractor_company_link',
      params: {
        'p_requester_company_id': intRequesterCompanyId,
        'p_contractor_id': intContractorId,
        'p_recipient_company_code': recipientCompanyCode.trim(),
      },
    );
    if (result is Map<String, dynamic>) return result;
    if (result is Map) return result.cast<String, dynamic>();
    return const {'ok': false, 'reason': 'unexpected_response'};
  }

  static Future<Map<String, dynamic>> decideCompanyRelationshipRequest({
    required String recipientCompanyId,
    required String relationshipId,
    required bool approve,
    bool autoCreateClient = true,
  }) async {
    final intRecipientCompanyId = int.tryParse(recipientCompanyId);
    final intRelationshipId = int.tryParse(relationshipId);
    if (intRecipientCompanyId == null || intRelationshipId == null) {
      return const {'ok': false, 'reason': 'invalid_ids'};
    }
    final result = await _client.rpc(
      'company_decide_relationship_request',
      params: {
        'p_recipient_company_id': intRecipientCompanyId,
        'p_relationship_id': intRelationshipId,
        'p_approve': approve,
        'p_auto_create_client': autoCreateClient,
      },
    );
    if (result is Map<String, dynamic>) return result;
    if (result is Map) return result.cast<String, dynamic>();
    return const {'ok': false, 'reason': 'unexpected_response'};
  }

  static Future<List<CompanyRelationship>> getCompanyRelationships({
    required String companyId,
    bool asRequester = true,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final query = _client.from('company_relationships').select();
    if (asRequester) {
      query.eq('requester_company_id', intCompanyId);
    } else {
      query.eq('recipient_company_id', intCompanyId);
    }
    final rows = (await query.order('updated_at', ascending: false) as List)
        .cast<Map<String, dynamic>>();
    return rows
        .map(
          (r) => CompanyRelationship(
            id: r['id'].toString(),
            requesterCompanyId: r['requester_company_id'].toString(),
            recipientCompanyId: r['recipient_company_id'].toString(),
            relationshipType:
                r['relationship_type']?.toString() ?? 'client_contractor',
            status: r['status']?.toString() ?? 'active',
            sourceContractorId: r['source_contractor_id']?.toString(),
          ),
        )
        .toList();
  }

  static Future<Map<String, dynamic>?> getMyContractorAdminContext({
    required String companyId,
    required String employeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmployeeId = int.tryParse(employeeId);
    if (intCompanyId == null || intEmployeeId == null) return null;
    final rows =
        (await _client
                    .from('contractor_members')
                    .select(
                      'contractor_id, role_label, is_primary, contractors(id, display_name, allow_members_view_all_jobs)',
                    )
                    .eq('company_id', intCompanyId)
                    .eq('employee_id', intEmployeeId)
                    .limit(1)
                as List)
            .cast<Map<String, dynamic>>();
    if (rows.isEmpty) return null;
    final row = rows.first;
    final contractor = row['contractors'] is Map<String, dynamic>
        ? Map<String, dynamic>.from(row['contractors'] as Map<String, dynamic>)
        : <String, dynamic>{};
    return {
      'contractor_id': row['contractor_id']?.toString(),
      'role_label': row['role_label']?.toString(),
      'is_primary': row['is_primary'] == true,
      'contractor_name': contractor['display_name']?.toString(),
      'allow_members_view_all_jobs':
          contractor['allow_members_view_all_jobs'] == null
          ? true
          : contractor['allow_members_view_all_jobs'] == true,
    };
  }

  static Future<void> updateContractorVisibility({
    required String companyId,
    required String contractorId,
    required bool allowMembersViewAllJobs,
  }) async {
    final contractor = await getContractorById(
      companyId: companyId,
      contractorId: contractorId,
    );
    if (contractor == null) return;
    await upsertContractor(
      companyId: companyId,
      id: contractor.id,
      contractorType: contractor.contractorType,
      displayName: contractor.displayName,
      contactPerson: contractor.contactPerson,
      email: contractor.email,
      phone: contractor.phone,
      allowMembersViewAllJobs: allowMembersViewAllJobs,
      linkedCompanyId: contractor.linkedCompanyId,
      linkedCompanyStatus: contractor.linkedCompanyStatus,
      status: contractor.status,
      notes: contractor.notes,
    );
  }

  static Future<void> insertContractorAdminEvent({
    required String companyId,
    required String contractorId,
    required String actorEmployeeId,
    required String eventType,
    Map<String, dynamic> details = const {},
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intContractorId = int.tryParse(contractorId);
    final intActorEmployeeId = int.tryParse(actorEmployeeId);
    if (intCompanyId == null || intContractorId == null) return;
    await _client.from('contractor_admin_events').insert({
      'company_id': intCompanyId,
      'contractor_id': intContractorId,
      'actor_employee_id': intActorEmployeeId,
      'event_type': eventType,
      'details': details,
    });
  }

  static Future<List<Map<String, dynamic>>> getContractorAdminEvents({
    required String companyId,
    required String contractorId,
    int limit = 50,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intContractorId = int.tryParse(contractorId);
    if (intCompanyId == null || intContractorId == null) return const [];
    final rows = await _client
        .from('contractor_admin_events')
        .select('id, actor_employee_id, event_type, details, created_at')
        .eq('company_id', intCompanyId)
        .eq('contractor_id', intContractorId)
        .order('created_at', ascending: false)
        .limit(limit);
    return (rows as List).cast<Map<String, dynamic>>();
  }

  static Future<List<Map<String, dynamic>>> getCompanyRelationshipsDetailed({
    required String companyId,
    bool asRequester = true,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final query = _client.from('company_relationships').select();
    if (asRequester) {
      query.eq('requester_company_id', intCompanyId);
    } else {
      query.eq('recipient_company_id', intCompanyId);
    }
    final rawRows = (await query.order('updated_at', ascending: false) as List)
        .cast<Map<String, dynamic>>();
    final rows = rawRows
        .map(
          (r) => CompanyRelationship(
            id: r['id'].toString(),
            requesterCompanyId: r['requester_company_id'].toString(),
            recipientCompanyId: r['recipient_company_id'].toString(),
            relationshipType:
                r['relationship_type']?.toString() ?? 'client_contractor',
            status: r['status']?.toString() ?? 'active',
            sourceContractorId: r['source_contractor_id']?.toString(),
          ),
        )
        .toList();
    final updatedAtById = <String, String?>{
      for (final r in rawRows)
        r['id']?.toString() ?? '': r['updated_at']?.toString(),
    };
    final ids = <String>{
      ...rows.map((r) => r.requesterCompanyId),
      ...rows.map((r) => r.recipientCompanyId),
    }.toList();
    final companyMeta = <String, Map<String, String?>>{};
    for (final id in ids) {
      final name = await getCompanyNameById(id);
      final code = await getCompanyCodeById(id);
      companyMeta[id] = {'name': name, 'code': code};
    }
    return rows
        .map(
          (r) => {
            'id': r.id,
            'requester_company_id': r.requesterCompanyId,
            'requester_company_name':
                companyMeta[r.requesterCompanyId]?['name'],
            'requester_company_code':
                companyMeta[r.requesterCompanyId]?['code'],
            'recipient_company_id': r.recipientCompanyId,
            'recipient_company_name':
                companyMeta[r.recipientCompanyId]?['name'],
            'recipient_company_code':
                companyMeta[r.recipientCompanyId]?['code'],
            'relationship_type': r.relationshipType,
            'status': r.status,
            'source_contractor_id': r.sourceContractorId,
            'updated_at': updatedAtById[r.id],
          },
        )
        .toList();
  }

  // ---- My PA tasks ----------------------------------------------------------

  static Future<List<PaTask>> getPaTasks({
    required String companyId,
    String? ownerEmployeeId,
    String status = 'all',
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final ownerTrim = ownerEmployeeId?.trim();
    final ownerParsed =
        ownerTrim != null && ownerTrim.isNotEmpty ? int.tryParse(ownerTrim) : null;

    if (_shouldUseEmployeePeerRpc(
      companyId: companyId,
      employeeIntId: ownerParsed,
    )) {
      final data = await _client.rpc(
        'employee_get_pa_tasks',
        params: {'p_company_id': intCompanyId, 'p_employee_id': ownerParsed!},
      );
      final rows =
          (data as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      var tasks = rows.map(PaTask.fromMap).toList();
      if (status != 'all') {
        tasks = tasks.where((t) => t.status == status).toList();
      }
      tasks.sort((a, b) {
        final ad = a.dueAt;
        final bd = b.dueAt;
        if (ad == null && bd == null) return b.createdAt.compareTo(a.createdAt);
        if (ad == null) return 1;
        if (bd == null) return -1;
        return ad.compareTo(bd);
      });
      return tasks;
    }

    final query = _client
        .from('pa_tasks')
        .select()
        .eq('company_id', intCompanyId);
    if (ownerParsed != null) {
      query.eq('owner_employee_id', ownerParsed);
    }
    if (status != 'all') {
      query.eq('status', status);
    }
    final rows = (await query.order('created_at', ascending: false) as List)
        .cast<Map<String, dynamic>>();
    final tasks = rows.map(PaTask.fromMap).toList();
    tasks.sort((a, b) {
      final ad = a.dueAt;
      final bd = b.dueAt;
      if (ad == null && bd == null) return b.createdAt.compareTo(a.createdAt);
      if (ad == null) return 1;
      if (bd == null) return -1;
      return ad.compareTo(bd);
    });
    return tasks;
  }

  static Future<void> createPaTask({
    required String companyId,
    required String title,
    String? notes,
    DateTime? dueAt,
    String priority = 'medium',
    DateTime? remindAt,
    String linkedType = 'none',
    String? linkedId,
    String? linkedLabel,
    String recurrencePattern = 'none',
    String? sourceType,
    String? sourceId,
    String? meetingWith,
    DateTime? meetingAt,
    String? ownerEmployeeId,
    String? meetingMinutes,
    String? meetingFollowUp,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null || title.trim().isEmpty) return;
    final ownerInt =
        ownerEmployeeId == null ? null : int.tryParse(ownerEmployeeId);
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      if (ownerInt == null) return;
      await _client.rpc(
        'employee_insert_pa_task',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': ownerInt,
          'p_title': title.trim(),
          'p_notes': notes?.trim(),
          'p_due_at': dueAt?.toUtc().toIso8601String(),
          'p_priority': priority,
          'p_remind_at': remindAt?.toUtc().toIso8601String(),
          'p_linked_type': linkedType,
          'p_linked_id': linkedId?.trim(),
          'p_linked_label': linkedLabel?.trim(),
          'p_recurrence_pattern': recurrencePattern,
          'p_source_type': sourceType?.trim(),
          'p_source_id': sourceId?.trim(),
          'p_meeting_with': meetingWith?.trim(),
          'p_meeting_at': meetingAt?.toUtc().toIso8601String(),
          'p_meeting_minutes': meetingMinutes?.trim(),
          'p_meeting_follow_up': meetingFollowUp?.trim(),
        },
      );
      return;
    }
    await _client.from('pa_tasks').insert({
      'company_id': intCompanyId,
      'title': title.trim(),
      'notes': notes?.trim().isEmpty == true ? null : notes?.trim(),
      'due_at': dueAt?.toUtc().toIso8601String(),
      'priority': priority,
      'status': 'todo',
      'remind_at': remindAt?.toUtc().toIso8601String(),
      'linked_type': linkedType,
      'linked_id': linkedId?.trim().isEmpty == true ? null : linkedId?.trim(),
      'linked_label': linkedLabel?.trim().isEmpty == true
          ? null
          : linkedLabel?.trim(),
      'recurrence_pattern': recurrencePattern,
      'source_type': sourceType?.trim().isEmpty == true
          ? null
          : sourceType?.trim(),
      'source_id': sourceId?.trim().isEmpty == true ? null : sourceId?.trim(),
      'meeting_with': meetingWith?.trim().isEmpty == true
          ? null
          : meetingWith?.trim(),
      'meeting_at': meetingAt?.toUtc().toIso8601String(),
      'meeting_minutes': meetingMinutes?.trim().isEmpty == true
          ? null
          : meetingMinutes?.trim(),
      'meeting_follow_up': meetingFollowUp?.trim().isEmpty == true
          ? null
          : meetingFollowUp?.trim(),
      'owner_employee_id': ownerInt,
      // Tasks owned by a specific employee should not also claim the HR owner slot.
      'owner_hr_user_id': ownerEmployeeId != null
          ? null
          : _client.auth.currentUser?.id,
    });
  }

  static Future<void> updatePaTask({
    required String companyId,
    required String taskId,
    String? title,
    String? notes,
    DateTime? dueAt,
    String? priority,
    DateTime? remindAt,
    String? linkedType,
    String? linkedId,
    String? linkedLabel,
    String? recurrencePattern,
    String? sourceType,
    String? sourceId,
    String? meetingWith,
    DateTime? meetingAt,
    String? meetingMinutes,
    String? meetingFollowUp,
    String? actingEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intTaskId = int.tryParse(taskId);
    if (intCompanyId == null || intTaskId == null) return;

    final rpcEmployee = _shouldUseEmployeeRpc(companyId: companyId) &&
        (actingEmployeeId?.trim().isNotEmpty ?? false);
    if (rpcEmployee) {
      final eid = int.tryParse(actingEmployeeId!.trim());
      if (eid == null) return;
      final rpcPatch = <String, dynamic>{
        'title': (title ?? '').trim(),
        'notes': (notes ?? '').trim(),
        'priority': priority ?? 'medium',
        'linked_type': linkedType ?? 'none',
        'linked_id': (linkedId ?? '').trim(),
        'linked_label': (linkedLabel ?? '').trim(),
        'recurrence_pattern': recurrencePattern ?? 'none',
        'source_type': (sourceType ?? '').trim(),
        'source_id': (sourceId ?? '').trim(),
        'meeting_with': (meetingWith ?? '').trim(),
        'due_at': dueAt?.toUtc().toIso8601String() ?? '',
        'remind_at': remindAt?.toUtc().toIso8601String() ?? '',
        'meeting_at': meetingAt?.toUtc().toIso8601String() ?? '',
        'meeting_minutes': (meetingMinutes ?? '').trim(),
        'meeting_follow_up': (meetingFollowUp ?? '').trim(),
      };
      await _client.rpc(
        'employee_update_pa_task',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': eid,
          'p_task_id': intTaskId,
          'p_patch': rpcPatch,
        },
      );
      return;
    }

    final patch = <String, dynamic>{
      if (title != null) 'title': title.trim(),
      if (notes != null) 'notes': notes.trim().isEmpty ? null : notes.trim(),
      if (priority != null) 'priority': priority,
      if (linkedType != null) 'linked_type': linkedType,
      if (linkedId != null)
        'linked_id': linkedId.trim().isEmpty ? null : linkedId.trim(),
      if (linkedLabel != null)
        'linked_label': linkedLabel.trim().isEmpty ? null : linkedLabel.trim(),
      if (recurrencePattern != null) 'recurrence_pattern': recurrencePattern,
      if (sourceType != null)
        'source_type': sourceType.trim().isEmpty ? null : sourceType.trim(),
      if (sourceId != null)
        'source_id': sourceId.trim().isEmpty ? null : sourceId.trim(),
      if (meetingWith != null)
        'meeting_with': meetingWith.trim().isEmpty ? null : meetingWith.trim(),
      if (meetingMinutes != null)
        'meeting_minutes':
            meetingMinutes.trim().isEmpty ? null : meetingMinutes.trim(),
      if (meetingFollowUp != null)
        'meeting_follow_up':
            meetingFollowUp.trim().isEmpty ? null : meetingFollowUp.trim(),
      'meeting_at': meetingAt?.toUtc().toIso8601String(),
      'due_at': dueAt?.toUtc().toIso8601String(),
      'remind_at': remindAt?.toUtc().toIso8601String(),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    };
    await _client
        .from('pa_tasks')
        .update(patch)
        .eq('company_id', intCompanyId)
        .eq('id', intTaskId);
  }

  static Future<void> updatePaTaskStatus({
    required String companyId,
    required String taskId,
    required String status,
    DateTime? snoozedUntil,
    String? actingEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intTaskId = int.tryParse(taskId);
    if (intCompanyId == null || intTaskId == null) return;

    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      final eid = int.tryParse(actingEmployeeId ?? '');
      if (eid == null) return;
      await _client.rpc(
        'employee_update_pa_task_status',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': eid,
          'p_task_id': intTaskId,
          'p_status': status,
          'p_snoozed_until': snoozedUntil?.toUtc().toIso8601String(),
        },
      );
      return;
    }

    Map<String, dynamic>? existing;
    if (status == 'done') {
      existing = await _client
          .from('pa_tasks')
          .select()
          .eq('company_id', intCompanyId)
          .eq('id', intTaskId)
          .maybeSingle();
    }
    await _client
        .from('pa_tasks')
        .update({
          'status': status,
          'snoozed_until': snoozedUntil?.toUtc().toIso8601String(),
          'completed_at': status == 'done'
              ? DateTime.now().toUtc().toIso8601String()
              : null,
          'updated_at': DateTime.now().toUtc().toIso8601String(),
        })
        .eq('company_id', intCompanyId)
        .eq('id', intTaskId);
    final recurrence = existing?['recurrence_pattern']?.toString() ?? 'none';
    if (status == 'done' && existing != null && recurrence != 'none') {
      final baseDue =
          DateTime.tryParse(existing['due_at']?.toString() ?? '') ??
          DateTime.now();
      final nextDue = switch (recurrence) {
        'daily' => baseDue.add(const Duration(days: 1)),
        'weekly' => baseDue.add(const Duration(days: 7)),
        'monthly' => DateTime(
          baseDue.year,
          baseDue.month + 1,
          baseDue.day,
          baseDue.hour,
          baseDue.minute,
        ),
        _ => baseDue,
      };
      await _client.from('pa_tasks').insert({
        'company_id': intCompanyId,
        'title': existing['title'],
        'notes': existing['notes'],
        'due_at': nextDue.toUtc().toIso8601String(),
        'priority': existing['priority'] ?? 'medium',
        'status': 'todo',
        'remind_at': null,
        'linked_type': existing['linked_type'] ?? 'none',
        'linked_id': existing['linked_id'],
        'linked_label': existing['linked_label'],
        'recurrence_pattern': recurrence,
        'source_type': existing['source_type'],
        'source_id': existing['source_id'],
        'meeting_with': existing['meeting_with'],
        'meeting_at': existing['meeting_at'],
        'owner_employee_id': existing['owner_employee_id'],
        'owner_hr_user_id': existing['owner_hr_user_id'],
        'meeting_minutes': null,
        'meeting_follow_up': null,
      });
    }
  }

  static Future<void> deletePaTask({
    required String companyId,
    required String taskId,
    String? actingEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intTaskId = int.tryParse(taskId);
    if (intCompanyId == null || intTaskId == null) return;
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      final eid = int.tryParse(actingEmployeeId ?? '');
      if (eid == null) return;
      await _client.rpc(
        'employee_delete_pa_task',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': eid,
          'p_task_id': intTaskId,
        },
      );
      return;
    }
    await _client
        .from('pa_tasks')
        .delete()
        .eq('company_id', intCompanyId)
        .eq('id', intTaskId);
  }

  static Future<List<PaLinkOption>> getPaLinkOptions({
    required String companyId,
    required String linkedType,
  }) async {
    switch (linkedType) {
      case 'client':
        final clients = await getClients(companyId: companyId);
        return clients
            .map(
              (c) => PaLinkOption(
                id: c.id,
                label: c.name.trim().isEmpty ? 'Client #${c.id}' : c.name,
              ),
            )
            .toList();
      case 'job':
        final jobs = await getJobs(companyId: companyId);
        return jobs
            .map(
              (j) => PaLinkOption(
                id: j.id,
                label: j.title.trim().isEmpty ? 'Job #${j.id}' : j.title,
              ),
            )
            .toList();
      case 'deal':
        final deals = await getCompanyClientDeals(companyId: companyId);
        return deals
            .map(
              (d) => PaLinkOption(
                id: d['id']?.toString() ?? '',
                label: d['title']?.toString().trim().isNotEmpty == true
                    ? d['title'].toString()
                    : WorkspaceTerms.projectHashId(d['id'] ?? ''),
              ),
            )
            .where((o) => o.id.isNotEmpty)
            .toList();
      case 'payment':
        final payments = await getCompanyClientPayments(companyId: companyId);
        return payments
            .map((p) {
              final id = p['id']?.toString() ?? '';
              final desc = p['description']?.toString().trim();
              final amount = (p['amount_due'] as num?)?.toDouble();
              final label = desc != null && desc.isNotEmpty
                  ? (amount == null
                        ? desc
                        : '$desc • R ${amount.toStringAsFixed(2)}')
                  : 'Payment #$id';
              return PaLinkOption(id: id, label: label);
            })
            .where((o) => o.id.isNotEmpty)
            .toList();
      default:
        return const [];
    }
  }

  static DateTime _paInitialDueFromRecurrence(String pattern) {
    final now = DateTime.now();
    final tomorrow = now.add(const Duration(days: 1));
    switch (pattern) {
      case 'daily':
        return DateTime(tomorrow.year, tomorrow.month, tomorrow.day, 9, 0);
      case 'weekly':
        final w = now.add(const Duration(days: 7));
        return DateTime(w.year, w.month, w.day, 9, 0);
      case 'monthly':
        return DateTime(now.year, now.month + 1, now.day, 9, 0);
      default:
        return DateTime(tomorrow.year, tomorrow.month, tomorrow.day, 9, 0);
    }
  }

  static Future<List<PaTaskTemplate>> getPaTaskTemplates({
    required String companyId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final rows =
        (await _client
                    .from('pa_task_templates')
                    .select()
                    .eq('company_id', intCompanyId)
                    .order('sort_order')
                    .order('title')
                as List)
            .cast<Map<String, dynamic>>();
    return rows.map(PaTaskTemplate.fromMap).toList();
  }

  /// Creates one task from a saved template (HR workspace).
  static Future<void> createPaTaskFromTemplate({
    required String companyId,
    required String templateId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intTemplateId = int.tryParse(templateId);
    if (intCompanyId == null || intTemplateId == null) return;
    final row = await _client
        .from('pa_task_templates')
        .select()
        .eq('company_id', intCompanyId)
        .eq('id', intTemplateId)
        .maybeSingle();
    if (row == null) return;
    final t = PaTaskTemplate.fromMap(Map<String, dynamic>.from(row));
    final due = _paInitialDueFromRecurrence(t.recurrencePattern);
    await createPaTask(
      companyId: companyId,
      title: t.title,
      notes: t.notes,
      dueAt: due,
      priority: t.priority,
      linkedType: t.linkedType,
      recurrencePattern: t.recurrencePattern,
      sourceType: 'template',
      sourceId: templateId,
    );
  }

  static Future<Map<String, int>> getPaOverview({
    required String companyId,
    String? ownerEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) {
      return const {'open': 0, 'overdue': 0, 'due_today': 0};
    }
    final ownerParsed =
        ownerEmployeeId != null && ownerEmployeeId.trim().isNotEmpty
        ? int.tryParse(ownerEmployeeId.trim())
        : null;

    final query = _client
        .from('pa_tasks')
        .select()
        .eq('company_id', intCompanyId);
    if (ownerParsed != null) {
      query.eq('owner_employee_id', ownerParsed);
    }
    final rows = (await query as List).cast<Map<String, dynamic>>();
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(const Duration(days: 1));
    var open = 0;
    var overdue = 0;
    var dueToday = 0;
    for (final r in rows) {
      final status = r['status']?.toString() ?? 'todo';
      if (status == 'done') continue;
      open++;
      final due = DateTime.tryParse(r['due_at']?.toString() ?? '')?.toLocal();
      if (due == null) continue;
      if (due.isBefore(now)) overdue++;
      if (!due.isBefore(start) && due.isBefore(end)) dueToday++;
    }
    return {'open': open, 'overdue': overdue, 'due_today': dueToday};
  }

  /// Client-side overview chips when tasks are already loaded (employee PA header).
  static Map<String, int> metricsFromPaTasks(List<PaTask> tasks) {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(const Duration(days: 1));
    var open = 0;
    var overdue = 0;
    var dueToday = 0;
    for (final t in tasks) {
      if (t.status == 'done') continue;
      open++;
      final due = t.dueAt;
      if (due == null) continue;
      if (due.isBefore(now)) overdue++;
      if (!due.isBefore(start) && due.isBefore(end)) dueToday++;
    }
    return {'open': open, 'overdue': overdue, 'due_today': dueToday};
  }

  static Future<int> syncOperationalPaTasks({required String companyId}) async {
    if (_shouldUseEmployeeRpc(companyId: companyId)) return 0;
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return 0;
    final now = DateTime.now();
    final lookback = now
        .subtract(const Duration(days: 14))
        .toUtc()
        .toIso8601String();
    final jobRows =
        (await _client
                    .from('jobs')
                    .select('id, title, status, closed_at')
                    .eq('company_id', intCompanyId)
                    .eq('status', 'completed')
                    .gte('closed_at', lookback)
                    .limit(80)
                as List)
            .cast<Map<String, dynamic>>();
    final dealRows =
        (await _client
                    .from('client_deals')
                    .select('id, title, status, expected_close_date')
                    .eq('company_id', intCompanyId)
                    .inFilter('status', [
                      'open',
                      'pending',
                      'offered',
                      'sent',
                      'negotiation',
                    ])
                    .limit(120)
                as List)
            .cast<Map<String, dynamic>>();
    final existingRows =
        (await _client
                    .from('pa_tasks')
                    .select('linked_type, linked_id, source_type, source_id')
                    .eq('company_id', intCompanyId)
                    .inFilter('source_type', [
                      'job_followup',
                      'deal_followup',
                      'job_sla_risk',
                    ])
                as List)
            .cast<Map<String, dynamic>>();
    final existing = <String>{
      for (final r in existingRows)
        '${r['source_type']}:${r['source_id']}:${r['linked_type']}:${r['linked_id']}',
    };
    final assignmentExistingRows =
        (await _client
                    .from('pa_tasks')
                    .select('source_id')
                    .eq('company_id', intCompanyId)
                    .eq('source_type', 'job_assignment')
                as List)
            .cast<Map<String, dynamic>>();
    final assignmentSourceIds = <String>{
      for (final r in assignmentExistingRows)
        r['source_id']?.toString() ?? '',
    }..remove('');
    var created = 0;
    for (final j in jobRows) {
      final jobId = j['id']?.toString();
      if (jobId == null || jobId.isEmpty) continue;
      final key = 'job_followup:$jobId:job:$jobId';
      if (existing.contains(key)) continue;
      await createPaTask(
        companyId: companyId,
        title:
            'Post-job follow-up: ${j['title']?.toString() ?? 'Completed job'}',
        notes:
            'Confirm completion quality, client sentiment, and any callback risk.',
        dueAt: now.add(const Duration(days: 1)),
        priority: 'medium',
        linkedType: 'job',
        linkedId: jobId,
        linkedLabel: j['title']?.toString(),
        sourceType: 'job_followup',
        sourceId: jobId,
      );
      existing.add(key);
      created++;
    }
    for (final d in dealRows) {
      final dealId = d['id']?.toString();
      if (dealId == null || dealId.isEmpty) continue;
      final expectedRaw = d['expected_close_date']?.toString();
      final expected = expectedRaw == null || expectedRaw.isEmpty
          ? null
          : DateTime.tryParse(expectedRaw);
      if (expected == null) continue;
      if (expected.isAfter(now.add(const Duration(days: 3)))) continue;
      final key = 'deal_followup:$dealId:deal:$dealId';
      if (existing.contains(key)) continue;
      await createPaTask(
        companyId: companyId,
        title:
            'Project follow-up: ${d['title']?.toString() ?? 'Client project'}',
        notes:
            'Reach out before expected close date and capture next decision step.',
        dueAt: DateTime(expected.year, expected.month, expected.day, 9, 0),
        priority: 'high',
        linkedType: 'deal',
        linkedId: dealId,
        linkedLabel: d['title']?.toString(),
        sourceType: 'deal_followup',
        sourceId: dealId,
      );
      existing.add(key);
      created++;
    }

    final slaCutoffUtc = now.toUtc().add(const Duration(hours: 48));
    final slaJobRows =
        (await _client
                    .from('jobs')
                    .select(
                      'id, title, status, scheduled_end, assignee_employee_id',
                    )
                    .eq('company_id', intCompanyId)
                    .inFilter('status', ['scheduled', 'in_progress'])
                    .limit(200)
                as List)
            .cast<Map<String, dynamic>>();
    for (final j in slaJobRows) {
      final jobId = j['id']?.toString();
      if (jobId == null || jobId.isEmpty) continue;
      final endUtc = DateTime.tryParse(j['scheduled_end']?.toString() ?? '');
      if (endUtc == null) continue;
      if (endUtc.isAfter(slaCutoffUtc)) continue;
      final key = 'job_sla_risk:$jobId:job:$jobId';
      if (existing.contains(key)) continue;
      final assignee = j['assignee_employee_id']?.toString();
      final endLocal = endUtc.toLocal();
      final overdue = endLocal.isBefore(now);
      await createPaTask(
        companyId: companyId,
        title: overdue
            ? 'Job SLA risk (overdue window): ${j['title']?.toString() ?? 'Open job'}'
            : 'Job SLA risk (ending soon): ${j['title']?.toString() ?? 'Open job'}',
        notes:
            'Scheduled end ${DateFormat('dd MMM yyyy • HH:mm').format(endLocal)}. Confirm status with assignee or reschedule.',
        dueAt: overdue ? now.add(const Duration(hours: 4)) : endLocal,
        priority: overdue ? 'high' : 'medium',
        linkedType: 'job',
        linkedId: jobId,
        linkedLabel: j['title']?.toString(),
        sourceType: 'job_sla_risk',
        sourceId: jobId,
        ownerEmployeeId:
            assignee != null && assignee.isNotEmpty && assignee != 'null'
            ? assignee
            : null,
      );
      existing.add(key);
      created++;
    }

    // Job roster → assignee PA todos (one task per job per assigned worker).
    final activeJobRows =
        (await _client
                    .from('jobs')
                    .select(
                      'id, title, status, assigned_employee_ids, assignee_employee_id, scheduled_end',
                    )
                    .eq('company_id', intCompanyId)
                    .limit(400)
                as List)
            .cast<Map<String, dynamic>>();
    for (final j in activeJobRows) {
      final status = (j['status']?.toString() ?? '').toLowerCase();
      if (status == 'completed' || status == 'cancelled') continue;
      final jobId = j['id']?.toString();
      if (jobId == null || jobId.isEmpty) continue;
      final title = j['title']?.toString().trim().isNotEmpty == true
          ? j['title'].toString().trim()
          : 'Job #$jobId';
      final empIds = <String>{};
      final rawAssigned = j['assigned_employee_ids'];
      if (rawAssigned is List) {
        for (final e in rawAssigned) {
          final s = e?.toString() ?? '';
          if (s.isNotEmpty) empIds.add(s);
        }
      }
      final assignee = j['assignee_employee_id']?.toString();
      if (assignee != null && assignee.isNotEmpty) empIds.add(assignee);
      final endUtc =
          DateTime.tryParse(j['scheduled_end']?.toString() ?? '')?.toLocal();
      final dueGuess = endUtc ?? now.add(const Duration(days: 1));
      for (final empId in empIds) {
        final sid = '${jobId}_$empId';
        if (assignmentSourceIds.contains(sid)) continue;
        await createPaTask(
          companyId: companyId,
          title: 'Job assigned: $title',
          notes:
              'You are assigned to this job. Track work in Jobs and tick this off when your part is done.',
          dueAt: dueGuess,
          priority: 'medium',
          linkedType: 'job',
          linkedId: jobId,
          linkedLabel: title,
          sourceType: 'job_assignment',
          sourceId: sid,
          ownerEmployeeId: empId,
        );
        assignmentSourceIds.add(sid);
        created++;
      }
    }

    return created;
  }

  // ---- Leave management -----------------------------------------------------

  static int _computeLeaveDays({
    required DateTime startDate,
    required DateTime endDate,
    required bool halfDayStart,
    required bool halfDayEnd,
  }) {
    final start = DateTime(startDate.year, startDate.month, startDate.day);
    final end = DateTime(endDate.year, endDate.month, endDate.day);
    if (end.isBefore(start)) return 1;
    final inclusiveDays = end.difference(start).inDays + 1;
    final deduction = (halfDayStart ? 0.5 : 0.0) + (halfDayEnd ? 0.5 : 0.0);
    final raw = inclusiveDays - deduction;
    return raw <= 0 ? 1 : raw.ceil();
  }

  static Future<List<LeaveRequest>> getLeaveRequests({
    required String companyId,
    String? employeeId,
    String? status,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final empParsed =
        employeeId != null && employeeId.trim().isNotEmpty
        ? int.tryParse(employeeId.trim())
        : null;

    if (_shouldUseEmployeeRpc(companyId: companyId) &&
        empParsed != null &&
        (status == null || status.trim().isEmpty || status == 'all')) {
      final raw = await _client.rpc(
        'employee_get_leave_requests',
        params: {'p_company_id': intCompanyId, 'p_employee_id': empParsed},
      );
      final rows =
          (raw as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      return rows.map(LeaveRequest.fromMap).toList();
    }

    final q = _client
        .from('leave_requests')
        .select()
        .eq('company_id', intCompanyId);
    if (empParsed != null) {
      q.eq('employee_id', empParsed);
    }
    if (status != null && status.trim().isNotEmpty && status != 'all') {
      q.eq('status', status.trim());
    }
    final rows = (await q.order('created_at', ascending: false) as List)
        .cast<Map<String, dynamic>>();
    return rows.map(LeaveRequest.fromMap).toList();
  }

  static Future<Map<String, int>> getLeaveOverview({
    required String companyId,
  }) async {
    final rows = await getLeaveRequests(companyId: companyId);
    var pending = 0;
    var approved = 0;
    var declined = 0;
    for (final r in rows) {
      switch (r.status) {
        case 'pending':
          pending++;
          break;
        case 'approved':
          approved++;
          break;
        case 'declined':
          declined++;
          break;
      }
    }
    return {'pending': pending, 'approved': approved, 'declined': declined};
  }

  static Future<void> _appendLeaveHistory({
    required int intCompanyId,
    required int intLeaveId,
    required String action,
    String? note,
  }) async {
    await _client.from('leave_request_history').insert({
      'company_id': intCompanyId,
      'leave_request_id': intLeaveId,
      'actor_hr_user_id': _client.auth.currentUser?.id,
      'action': action,
      'note': note?.trim().isEmpty == true ? null : note?.trim(),
    });
  }

  static Future<String?> submitLeaveRequest({
    required String companyId,
    required String employeeId,
    required String leaveType,
    required DateTime startDate,
    required DateTime endDate,
    bool halfDayStart = false,
    bool halfDayEnd = false,
    String? reason,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmployeeId = int.tryParse(employeeId);
    if (intCompanyId == null || intEmployeeId == null) return null;
    final start = DateTime(startDate.year, startDate.month, startDate.day);
    final end = DateTime(endDate.year, endDate.month, endDate.day);
    if (end.isBefore(start)) {
      throw Exception('End date cannot be before start date.');
    }
    final totalDays = _computeLeaveDays(
      startDate: start,
      endDate: end,
      halfDayStart: halfDayStart,
      halfDayEnd: halfDayEnd,
    );

    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      final raw = await _client.rpc(
        'employee_submit_leave_request',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': intEmployeeId,
          'p_leave_type': leaveType.trim().isEmpty ? 'annual' : leaveType.trim(),
          'p_start_date': DateFormat('yyyy-MM-dd').format(start),
          'p_end_date': DateFormat('yyyy-MM-dd').format(end),
          'p_half_day_start': halfDayStart,
          'p_half_day_end': halfDayEnd,
          'p_total_days': totalDays,
          'p_reason': reason?.trim(),
        },
      );
      return raw?.toString();
    }

    final overlap = await _client
        .from('leave_requests')
        .select('id')
        .eq('company_id', intCompanyId)
        .eq('employee_id', intEmployeeId)
        .inFilter('status', ['pending', 'approved'])
        .lte('start_date', DateFormat('yyyy-MM-dd').format(end))
        .gte('end_date', DateFormat('yyyy-MM-dd').format(start))
        .limit(1);
    if ((overlap as List).isNotEmpty) {
      throw Exception(
        'You already have a pending/approved leave request in this range.',
      );
    }
    final created = await _client
        .from('leave_requests')
        .insert({
          'company_id': intCompanyId,
          'employee_id': intEmployeeId,
          'leave_type': leaveType.trim().isEmpty ? 'annual' : leaveType.trim(),
          'start_date': DateFormat('yyyy-MM-dd').format(start),
          'end_date': DateFormat('yyyy-MM-dd').format(end),
          'half_day_start': halfDayStart,
          'half_day_end': halfDayEnd,
          'total_days': totalDays,
          'reason': reason?.trim().isEmpty == true ? null : reason?.trim(),
          'status': 'pending',
        })
        .select('id')
        .maybeSingle();
    final leaveId = created?['id']?.toString();
    if (leaveId == null) return null;
    final intLeaveId = int.tryParse(leaveId);
    if (intLeaveId != null) {
      await _appendLeaveHistory(
        intCompanyId: intCompanyId,
        intLeaveId: intLeaveId,
        action: 'submitted',
        note: reason,
      );
    }

    final emp = await _client
        .from('employees')
        .select('name, surname, manager_user_id')
        .eq('company_id', intCompanyId)
        .eq('id', intEmployeeId)
        .maybeSingle();
    final employeeName = emp == null
        ? 'Employee #$employeeId'
        : '${emp['name']?.toString() ?? ''} ${emp['surname']?.toString() ?? ''}'
              .trim();
    await _insertHrNotification(
      companyId: intCompanyId,
      type: 'leave_submitted',
      title: 'Leave request submitted',
      body:
          '$employeeName requested ${leaveType.toLowerCase()} leave (${DateFormat('dd MMM').format(start)} - ${DateFormat('dd MMM').format(end)}).',
      refType: 'leave_request',
      refId: leaveId,
      dedupeKey: 'leave_submitted:$leaveId',
    );
    return leaveId;
  }

  static Future<void> decideLeaveRequest({
    required String companyId,
    required String leaveRequestId,
    required String decision, // approved | declined
    String? decisionNote,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intLeaveId = int.tryParse(leaveRequestId);
    if (intCompanyId == null || intLeaveId == null) return;
    if (decision != 'approved' && decision != 'declined') return;
    final existing = await _client
        .from('leave_requests')
        .select('id, employee_id, leave_type, start_date, end_date, status')
        .eq('company_id', intCompanyId)
        .eq('id', intLeaveId)
        .maybeSingle();
    if (existing == null) return;
    if ((existing['status']?.toString() ?? '') != 'pending') return;
    final now = DateTime.now().toUtc().toIso8601String();
    await _client
        .from('leave_requests')
        .update({
          'status': decision,
          'decision_note': decisionNote?.trim().isEmpty == true
              ? null
              : decisionNote?.trim(),
          'approver_hr_user_id': _client.auth.currentUser?.id,
          'decided_at': now,
        })
        .eq('company_id', intCompanyId)
        .eq('id', intLeaveId);
    await _appendLeaveHistory(
      intCompanyId: intCompanyId,
      intLeaveId: intLeaveId,
      action: decision,
      note: decisionNote,
    );

    final intEmployeeId = (existing['employee_id'] as num?)?.toInt();
    if (intEmployeeId == null) return;
    final employeeRow = await _client
        .from('employees')
        .select('id, name, surname, email, manager_user_id')
        .eq('company_id', intCompanyId)
        .eq('id', intEmployeeId)
        .maybeSingle();
    final managerAuthId = employeeRow?['manager_user_id']?.toString();
    Map<String, dynamic>? managerEmployee;
    if (managerAuthId != null && managerAuthId.isNotEmpty) {
      managerEmployee = await _client
          .from('employees')
          .select('id, email')
          .eq('company_id', intCompanyId)
          .eq('profile_id', managerAuthId)
          .maybeSingle();
    }
    final start = DateTime.tryParse(existing['start_date']?.toString() ?? '');
    final end = DateTime.tryParse(existing['end_date']?.toString() ?? '');
    final leaveType = existing['leave_type']?.toString() ?? 'leave';
    final employeeName = employeeRow == null
        ? 'Employee #$intEmployeeId'
        : '${employeeRow['name']?.toString() ?? ''} ${employeeRow['surname']?.toString() ?? ''}'
              .trim();
    final statusLabel = decision == 'approved' ? 'approved' : 'declined';
    final body =
        'Your ${leaveType.toLowerCase()} leave (${start == null ? '-' : DateFormat('dd MMM').format(start)} - ${end == null ? '-' : DateFormat('dd MMM').format(end)}) was $statusLabel.';
    await _insertEmployeeNotifications(
      companyId: intCompanyId,
      employeeIds: {intEmployeeId.toString()},
      type: 'leave_decision',
      title: 'Leave request $statusLabel',
      body: body,
      refType: 'leave_request',
      refId: leaveRequestId,
      dedupeKeyBase: 'leave_decision:$leaveRequestId:$statusLabel',
    );
    await _insertHrNotification(
      companyId: intCompanyId,
      type: 'leave_decision',
      title: 'Leave request $statusLabel',
      body:
          '$employeeName leave request (${start == null ? '-' : DateFormat('dd MMM').format(start)} - ${end == null ? '-' : DateFormat('dd MMM').format(end)}) was $statusLabel.',
      refType: 'leave_request',
      refId: leaveRequestId,
      dedupeKey: 'leave_hr_decision:$leaveRequestId:$statusLabel',
    );

    if (_externalNotificationChannelsEnabled) {
      final notifRows =
          (await _client
                      .from('app_notifications')
                      .select('id, recipient_employee_id')
                      .eq('company_id', intCompanyId)
                      .eq('ref_type', 'leave_request')
                      .eq('ref_id', leaveRequestId)
                      .eq('type', 'leave_decision')
                      .order('id', ascending: false)
                      .limit(10)
                  as List)
              .cast<Map<String, dynamic>>();
      final deliveries = <Map<String, dynamic>>[];
      final employeeEmail = employeeRow?['email']?.toString();
      final managerEmail = managerEmployee?['email']?.toString();
      for (final n in notifRows) {
        final nid = n['id'];
        if (nid == null) continue;
        if (employeeEmail != null && employeeEmail.trim().isNotEmpty) {
          deliveries.add({
            'company_id': intCompanyId,
            'notification_id': nid,
            'channel': 'email',
            'recipient_employee_id': intEmployeeId,
            'recipient_email': employeeEmail.trim().toLowerCase(),
          });
        }
        final managerEmployeeId = (managerEmployee?['id'] as num?)?.toInt();
        if (managerEmail != null &&
            managerEmail.trim().isNotEmpty &&
            managerEmployeeId != null) {
          deliveries.add({
            'company_id': intCompanyId,
            'notification_id': nid,
            'channel': 'email',
            'recipient_employee_id': managerEmployeeId,
            'recipient_email': managerEmail.trim().toLowerCase(),
          });
        }
      }
      if (deliveries.isNotEmpty) {
        await _client.from('app_notification_deliveries').insert(deliveries);
      }
    }
  }

  static Future<void> cancelLeaveRequest({
    required String companyId,
    required String leaveRequestId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intLeaveId = int.tryParse(leaveRequestId);
    if (intCompanyId == null || intLeaveId == null) return;
    final existing = await _client
        .from('leave_requests')
        .select('status')
        .eq('company_id', intCompanyId)
        .eq('id', intLeaveId)
        .maybeSingle();
    if ((existing?['status']?.toString() ?? '') != 'pending') return;
    await _client
        .from('leave_requests')
        .update({'status': 'cancelled'})
        .eq('company_id', intCompanyId)
        .eq('id', intLeaveId);
    await _appendLeaveHistory(
      intCompanyId: intCompanyId,
      intLeaveId: intLeaveId,
      action: 'cancelled',
    );
  }

  static Future<List<Map<String, dynamic>>> getApprovedLeaveForPayroll({
    required String companyId,
    DateTime? from,
    DateTime? to,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final q = _client
        .from('v_payroll_leave_approved')
        .select()
        .eq('company_id', intCompanyId);
    if (from != null)
      q.gte('start_date', DateFormat('yyyy-MM-dd').format(from));
    if (to != null) q.lte('end_date', DateFormat('yyyy-MM-dd').format(to));
    final rows = (await q.order('start_date', ascending: false) as List)
        .cast<Map<String, dynamic>>();
    return rows;
  }

  static Future<void> markLeavePayrollSynced({
    required String companyId,
    required List<String> leaveRequestIds,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null || leaveRequestIds.isEmpty) return;
    final ids = leaveRequestIds.map(int.tryParse).whereType<int>().toList();
    if (ids.isEmpty) return;
    await _client
        .from('leave_requests')
        .update({'payroll_synced_at': DateTime.now().toUtc().toIso8601String()})
        .eq('company_id', intCompanyId)
        .inFilter('id', ids);
  }

  // ---- Manager bulk clock-in/out -------------------------------------------

  static Future<void> managerBulkPunch({
    required String companyId,
    required List<String> employeeIds,
    required bool isSignIn,
    String? notes,
    double? latitude,
    double? longitude,
    String? address,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null || employeeIds.isEmpty) return;
    final now = DateTime.now();
    final notesTrim =
        notes?.trim().isEmpty == true ? null : notes?.trim();
    for (final eid in employeeIds) {
      final intEmployeeId = int.tryParse(eid);
      if (intEmployeeId == null) continue;
      await _client.rpc(
        'employee_submit_punch',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': intEmployeeId,
          'p_is_sign_in': isSignIn,
          'p_ts': now.toIso8601String(),
          'p_lat': latitude,
          'p_lon': longitude,
          'p_location': address,
          'p_notes': notesTrim,
        },
      );
    }
  }

  /// Employees listed as members of a message thread (team channel).
  static Future<List<String>> getMessageThreadMemberEmployeeIds({
    required String companyId,
    required String threadId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intThreadId = int.tryParse(threadId);
    if (intCompanyId == null || intThreadId == null) return const [];
    final rows =
        (await _client
                    .from('app_message_thread_members')
                    .select('member_employee_id')
                    .eq('company_id', intCompanyId)
                    .eq('thread_id', intThreadId)
                as List)
            .cast<Map<String, dynamic>>();
    final out = <String>[];
    for (final r in rows) {
      final id = r['member_employee_id'];
      if (id != null) {
        out.add(id.toString());
      }
    }
    return out;
  }

  /// HR/manager user has an [employees] row with [profile_id] = auth uid (same as employee app login).
  static Future<Employee?> getEmployeeLinkedToCurrentAuthUser({
    required String companyId,
  }) async {
    final uid = _client.auth.currentUser?.id;
    final intCompanyId = int.tryParse(companyId);
    if (uid == null || intCompanyId == null) return null;
    final row = await _client
        .from('employees')
        .select()
        .eq('company_id', intCompanyId)
        .eq('profile_id', uid)
        .maybeSingle();
    if (row == null) return null;
    return Employee.fromMap(Map<String, dynamic>.from(row));
  }

  // ---- Job codes + labor time entries --------------------------------------

  static Future<List<JobCode>> getJobCodes({
    required String companyId,
    bool activeOnly = true,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final q = _client.from('job_codes').select().eq('company_id', intCompanyId);
    if (activeOnly) q.eq('is_active', true);
    final rows = (await q.order('code') as List).cast<Map<String, dynamic>>();
    return rows.map(JobCode.fromMap).toList();
  }

  static Future<void> upsertJobCode({
    required String companyId,
    String? jobCodeId,
    required String code,
    required String title,
    bool isActive = true,
    double? defaultHourlyRate,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null || code.trim().isEmpty || title.trim().isEmpty)
      return;
    final intJobCodeId = int.tryParse(jobCodeId ?? '');
    final payload = <String, dynamic>{
      'company_id': intCompanyId,
      'code': code.trim().toUpperCase(),
      'title': title.trim(),
      'is_active': isActive,
      'default_hourly_rate': defaultHourlyRate,
    };
    if (intJobCodeId == null) {
      await _client.from('job_codes').insert(payload);
    } else {
      await _client
          .from('job_codes')
          .update(payload)
          .eq('company_id', intCompanyId)
          .eq('id', intJobCodeId);
    }
  }

  static Future<void> addLaborEntry({
    required String companyId,
    required String employeeId,
    required String jobId,
    String? jobCodeId,
    required DateTime workDate,
    required double hours,
    double? hourlyRate,
    String sourceType = 'manual',
    String? sourceRef,
    String? notes,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmployeeId = int.tryParse(employeeId);
    final intJobId = int.tryParse(jobId);
    final intJobCodeId = int.tryParse(jobCodeId ?? '');
    if (intCompanyId == null ||
        intEmployeeId == null ||
        intJobId == null ||
        hours <= 0)
      return;
    await _client.from('labor_time_entries').insert({
      'company_id': intCompanyId,
      'employee_id': intEmployeeId,
      'job_id': intJobId,
      'job_code_id': intJobCodeId,
      'work_date': DateFormat('yyyy-MM-dd').format(workDate),
      'hours': hours,
      'hourly_rate': hourlyRate,
      'source_type': sourceType,
      'source_ref': sourceRef?.trim().isEmpty == true
          ? null
          : sourceRef?.trim(),
      'notes': notes?.trim().isEmpty == true ? null : notes?.trim(),
      'created_by_hr_user_id': _client.auth.currentUser?.id,
    });
  }

  static Future<List<LaborEntry>> getLaborEntriesForJob({
    required String companyId,
    required String jobId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intJobId = int.tryParse(jobId);
    if (intCompanyId == null || intJobId == null) return const [];
    final rows =
        (await _client
                    .from('labor_time_entries')
                    .select()
                    .eq('company_id', intCompanyId)
                    .eq('job_id', intJobId)
                    .order('work_date', ascending: false)
                    .order('created_at', ascending: false)
                as List)
            .cast<Map<String, dynamic>>();
    return rows.map(LaborEntry.fromMap).toList();
  }

  // ---- App messaging --------------------------------------------------------

  static Future<List<AppMessage>> getCompanyMessages({
    required String companyId,
    int limit = 120,
    String? actingEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    if (intCompanyId == null) return const [];
    final actId =
        actingEmployeeId != null ? int.tryParse(actingEmployeeId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      if (actId == null) return const [];
      final raw = await _client.rpc(
        'employee_get_company_messages_for_worker',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': actId,
          'p_limit': limit,
        },
      );
      final rows =
          (raw as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      return rows.map(AppMessage.fromMap).toList();
    }
    final rows =
        (await _client
                    .from('app_messages')
                    .select()
                    .eq('company_id', intCompanyId)
                    .isFilter('thread_id', null)
                    .order('created_at', ascending: false)
                    .limit(limit)
                as List)
            .cast<Map<String, dynamic>>();
    return rows.map(AppMessage.fromMap).toList();
  }

  static Future<void> sendCompanyMessage({
    required String companyId,
    required String body,
    String? senderEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intSenderEmployeeId = int.tryParse(senderEmployeeId ?? '');
    if (intCompanyId == null || body.trim().isEmpty) return;
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      final sid = int.tryParse(senderEmployeeId ?? '');
      if (sid == null) return;
      await _client.rpc(
        'employee_send_company_feed_message',
        params: {
          'p_company_id': intCompanyId,
          'p_sender_employee_id': sid,
          'p_body': body.trim(),
        },
      );
      return;
    }
    await _client.from('app_messages').insert({
      'company_id': intCompanyId,
      'thread_id': null,
      'sender_employee_id': intSenderEmployeeId,
      'sender_hr_user_id': intSenderEmployeeId == null
          ? _client.auth.currentUser?.id
          : null,
      'body': body.trim(),
    });
  }

  static Future<List<MessageThread>> getMessageThreads({
    required String companyId,
    String? currentEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intCurrentEmployeeId = int.tryParse(currentEmployeeId ?? '');
    if (intCompanyId == null) return const [];
    if (intCurrentEmployeeId != null &&
        _shouldUseEmployeeRpc(companyId: companyId)) {
      final raw = await _client.rpc(
        'employee_get_message_threads_for_worker',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': intCurrentEmployeeId,
        },
      );
      final rows =
          (raw as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      return rows.map(MessageThread.fromMap).toList();
    }
    if (intCurrentEmployeeId == null) {
      final rows =
          (await _client
                      .from('app_message_threads')
                      .select()
                      .eq('company_id', intCompanyId)
                      .order('created_at', ascending: false)
                  as List)
              .cast<Map<String, dynamic>>();
      return rows.map(MessageThread.fromMap).toList();
    }
    final memberRows =
        (await _client
                    .from('app_message_thread_members')
                    .select('thread_id')
                    .eq('company_id', intCompanyId)
                    .eq('member_employee_id', intCurrentEmployeeId)
                as List)
            .cast<Map<String, dynamic>>();
    final threadIds = memberRows
        .map((r) => r['thread_id'])
        .whereType<num>()
        .map((n) => n.toInt())
        .toSet()
        .toList();
    if (threadIds.isEmpty) return const [];
    final rows =
        (await _client
                    .from('app_message_threads')
                    .select()
                    .eq('company_id', intCompanyId)
                    .inFilter('id', threadIds)
                    .order('created_at', ascending: false)
                as List)
            .cast<Map<String, dynamic>>();
    return rows.map(MessageThread.fromMap).toList();
  }

  static Future<String?> createMessageThread({
    required String companyId,
    required String title,
    required String threadType,
    required List<String> memberEmployeeIds,
    String? creatorEmployeeId,
    String? jobId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intCreatorEmployeeId = int.tryParse(creatorEmployeeId ?? '');
    final intJobId = int.tryParse(jobId ?? '');
    final memberIds = memberEmployeeIds
        .map((e) => int.tryParse(e))
        .whereType<int>()
        .toSet()
        .toList();
    if (intCompanyId == null || title.trim().isEmpty) return null;
    final created = await _client
        .from('app_message_threads')
        .insert({
          'company_id': intCompanyId,
          'title': title.trim(),
          'thread_type': threadType,
          'created_by_employee_id': intCreatorEmployeeId,
          'created_by_hr_user_id': intCreatorEmployeeId == null
              ? _client.auth.currentUser?.id
              : null,
          if (intJobId != null) 'job_id': intJobId,
        })
        .select('id')
        .single();
    final threadId = created['id']?.toString();
    final intThreadId = int.tryParse(threadId ?? '');
    if (intThreadId == null) return null;
    final memberRows = <Map<String, dynamic>>[];
    if (intCreatorEmployeeId != null) {
      memberRows.add({
        'company_id': intCompanyId,
        'thread_id': intThreadId,
        'member_employee_id': intCreatorEmployeeId,
        'role': 'manager',
      });
    } else {
      memberRows.add({
        'company_id': intCompanyId,
        'thread_id': intThreadId,
        'member_hr_user_id': _client.auth.currentUser?.id,
        'role': 'manager',
      });
    }
    for (final id in memberIds) {
      memberRows.add({
        'company_id': intCompanyId,
        'thread_id': intThreadId,
        'member_employee_id': id,
        'role': 'member',
      });
    }
    await _client.from('app_message_thread_members').upsert(memberRows);
    return threadId;
  }

  /// Ensures a single group thread for [jobId], with members matching job
  /// assignees (HR dashboard → Job details).
  static Future<String?> ensureJobTeamMessageThread({
    required String companyId,
    required String jobId,
  }) async {
    final cid = int.tryParse(companyId);
    final jid = int.tryParse(jobId);
    if (cid == null || jid == null) return null;
    final raw = await _client.rpc(
      'ensure_job_team_message_thread',
      params: {
        'p_company_id': cid,
        'p_job_id': jid,
      },
    );
    return raw?.toString();
  }

  static Future<List<AppMessage>> getThreadMessages({
    required String companyId,
    required String threadId,
    int limit = 200,
    String? actingEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intThreadId = int.tryParse(threadId);
    if (intCompanyId == null || intThreadId == null) return const [];
    final actId =
        actingEmployeeId != null ? int.tryParse(actingEmployeeId) : null;
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      if (actId == null) return const [];
      final raw = await _client.rpc(
        'employee_get_thread_messages_for_worker',
        params: {
          'p_company_id': intCompanyId,
          'p_thread_id': intThreadId,
          'p_employee_id': actId,
          'p_limit': limit,
        },
      );
      final rows =
          (raw as List?)?.cast<Map<String, dynamic>>() ??
          <Map<String, dynamic>>[];
      return rows.map(AppMessage.fromMap).toList();
    }
    final rows =
        (await _client
                    .from('app_messages')
                    .select()
                    .eq('company_id', intCompanyId)
                    .eq('thread_id', intThreadId)
                    .order('created_at', ascending: false)
                    .limit(limit)
                as List)
            .cast<Map<String, dynamic>>();
    return rows.map(AppMessage.fromMap).toList();
  }

  static Future<void> sendThreadMessage({
    required String companyId,
    required String threadId,
    required String body,
    String? senderEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intThreadId = int.tryParse(threadId);
    final intSenderEmployeeId = int.tryParse(senderEmployeeId ?? '');
    if (intCompanyId == null || intThreadId == null || body.trim().isEmpty) {
      return;
    }
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      final sid = int.tryParse(senderEmployeeId ?? '');
      if (sid == null) return;
      await _client.rpc(
        'employee_send_thread_message',
        params: {
          'p_company_id': intCompanyId,
          'p_thread_id': intThreadId,
          'p_sender_employee_id': sid,
          'p_body': body.trim(),
        },
      );
      return;
    }
    await _client.from('app_messages').insert({
      'company_id': intCompanyId,
      'thread_id': intThreadId,
      'sender_employee_id': intSenderEmployeeId,
      'sender_hr_user_id': intSenderEmployeeId == null
          ? _client.auth.currentUser?.id
          : null,
      'body': body.trim(),
    });
  }

  /// Marks [threadId] as read up to now for this employee (WhatsApp-style unread).
  static Future<void> markMessageThreadRead({
    required String companyId,
    required String threadId,
    required String employeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intThreadId = int.tryParse(threadId);
    final intEmpId = int.tryParse(employeeId);
    if (intCompanyId == null || intThreadId == null || intEmpId == null) {
      return;
    }
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      await _client.rpc(
        'employee_mark_thread_read_for_worker',
        params: {
          'p_company_id': intCompanyId,
          'p_thread_id': intThreadId,
          'p_employee_id': intEmpId,
        },
      );
      return;
    }
    await _client.from('app_message_thread_reads').upsert({
      'company_id': intCompanyId,
      'thread_id': intThreadId,
      'employee_id': intEmpId,
      'last_read_at': DateTime.now().toUtc().toIso8601String(),
    }, onConflict: 'thread_id,employee_id');
  }

  /// Marks the company-wide announcement feed as read for this employee.
  static Future<void> markCompanyFeedRead({
    required String companyId,
    required String employeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmpId = int.tryParse(employeeId);
    if (intCompanyId == null || intEmpId == null) {
      return;
    }
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      await _client.rpc(
        'employee_mark_company_feed_read_for_worker',
        params: {
          'p_company_id': intCompanyId,
          'p_employee_id': intEmpId,
        },
      );
      return;
    }
    await _client.from('app_message_company_feed_reads').upsert({
      'company_id': intCompanyId,
      'employee_id': intEmpId,
      'last_read_at': DateTime.now().toUtc().toIso8601String(),
    }, onConflict: 'company_id,employee_id');
  }

  /// Returns unread counts keyed by thread id (only threads with count > 0 may appear).
  static Future<Map<String, int>> getMessageUnreadCountsForThreads({
    required String companyId,
    required String employeeId,
    required List<String> threadIds,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmpId = int.tryParse(employeeId);
    if (intCompanyId == null || intEmpId == null || threadIds.isEmpty) {
      return {};
    }
    final intThreadIds = threadIds
        .map(int.tryParse)
        .whereType<int>()
        .toList();
    if (intThreadIds.isEmpty) {
      return {};
    }
    final raw = await _client.rpc(
      'message_unread_counts_for_threads',
      params: <String, dynamic>{
        'p_company_id': intCompanyId,
        'p_employee_id': intEmpId,
        'p_thread_ids': intThreadIds,
      },
    );
    final out = <String, int>{};
    if (raw is List) {
      for (final row in raw) {
        if (row is Map) {
          final m = Map<String, dynamic>.from(row);
          final tid = m['thread_id']?.toString();
          final c = m['unread_count'];
          if (tid != null && c != null) {
            out[tid] = int.tryParse(c.toString()) ?? 0;
          }
        }
      }
    }
    return out;
  }

  static Future<int> getCompanyFeedUnreadCount({
    required String companyId,
    required String employeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intEmpId = int.tryParse(employeeId);
    if (intCompanyId == null || intEmpId == null) {
      return 0;
    }
    final raw = await _client.rpc(
      'message_company_feed_unread_count',
      params: <String, dynamic>{
        'p_company_id': intCompanyId,
        'p_employee_id': intEmpId,
      },
    );
    return int.tryParse(raw?.toString() ?? '0') ?? 0;
  }

  /// Existing peer↔peer direct thread id, or null if none yet (does not create).
  static Future<String?> findDirectThreadEmployeePeer({
    required String companyId,
    required String fromEmployeeId,
    required String toEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intFrom = int.tryParse(fromEmployeeId);
    final intTo = int.tryParse(toEmployeeId);
    if (intCompanyId == null ||
        intFrom == null ||
        intTo == null ||
        intFrom == intTo) {
      return null;
    }
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      final raw = await _client.rpc(
        'employee_find_direct_thread_peer',
        params: {
          'p_company_id': intCompanyId,
          'p_from_id': intFrom,
          'p_to_id': intTo,
        },
      );
      if (raw == null) return null;
      return raw.toString();
    }
    Future<Set<int>> threadIdsForEmployee(int empId) async {
      final rows =
          (await _client
                      .from('app_message_thread_members')
                      .select('thread_id')
                      .eq('company_id', intCompanyId)
                      .eq('member_employee_id', empId)
                  as List)
              .cast<Map<String, dynamic>>();
      return rows
          .map((r) => r['thread_id'])
          .whereType<num>()
          .map((n) => n.toInt())
          .toSet();
    }

    final fromIds = await threadIdsForEmployee(intFrom);
    final toIds = await threadIdsForEmployee(intTo);
    final candidates = fromIds.intersection(toIds).toList();
    if (candidates.isEmpty) {
      return null;
    }
    final threadRows =
        (await _client
                    .from('app_message_threads')
                    .select('id')
                    .eq('company_id', intCompanyId)
                    .eq('thread_type', 'direct')
                    .inFilter('id', candidates)
                as List)
            .cast<Map<String, dynamic>>();
    for (final row in threadRows) {
      final tid = row['id'];
      if (tid == null) {
        continue;
      }
      final members =
          (await _client
                      .from('app_message_thread_members')
                      .select('member_employee_id,member_hr_user_id')
                      .eq('thread_id', tid)
                      .eq('company_id', intCompanyId)
                  as List)
              .cast<Map<String, dynamic>>();
      final empMembers = members
          .map((m) => m['member_employee_id'])
          .whereType<num>()
          .map((n) => n.toInt())
          .toSet();
      final hasHr = members.any((m) => m['member_hr_user_id'] != null);
      if (!hasHr &&
          empMembers.length == 2 &&
          empMembers.contains(intFrom) &&
          empMembers.contains(intTo)) {
        return tid.toString();
      }
    }
    return null;
  }

  /// Maps each colleague employee id → existing direct thread id (peer chats only; skips HR threads).
  static Future<Map<String, String>> getDirectPeerToThreadMap({
    required String companyId,
    required String myEmployeeId,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intMe = int.tryParse(myEmployeeId);
    if (intCompanyId == null || intMe == null) {
      return {};
    }
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      final raw = await _client.rpc(
        'employee_get_direct_peer_thread_map',
        params: {'p_company_id': intCompanyId, 'p_my_employee_id': intMe},
      );
      final out = <String, String>{};
      if (raw is List) {
        for (final row in raw) {
          if (row is Map) {
            final m = Map<String, dynamic>.from(row);
            final peer = m['peer_employee_id']?.toString();
            final tid = m['thread_id']?.toString();
            if (peer != null && tid != null) {
              out[peer] = tid;
            }
          }
        }
      }
      return out;
    }
    final memberRows =
        (await _client
                    .from('app_message_thread_members')
                    .select('thread_id')
                    .eq('company_id', intCompanyId)
                    .eq('member_employee_id', intMe)
                as List)
            .cast<Map<String, dynamic>>();
    final threadIdNums = memberRows
        .map((r) => r['thread_id'])
        .whereType<num>()
        .map((n) => n.toInt())
        .toSet()
        .toList();
    if (threadIdNums.isEmpty) {
      return {};
    }
    final threadRows =
        (await _client
                    .from('app_message_threads')
                    .select('id')
                    .eq('company_id', intCompanyId)
                    .eq('thread_type', 'direct')
                    .inFilter('id', threadIdNums)
                as List)
            .cast<Map<String, dynamic>>();
    final out = <String, String>{};
    for (final row in threadRows) {
      final tid = row['id'];
      if (tid == null) {
        continue;
      }
      final members =
          (await _client
                      .from('app_message_thread_members')
                      .select('member_employee_id,member_hr_user_id')
                      .eq('thread_id', tid)
                      .eq('company_id', intCompanyId)
                  as List)
              .cast<Map<String, dynamic>>();
      final hasHr = members.any((m) => m['member_hr_user_id'] != null);
      final empMembers = members
          .map((m) => m['member_employee_id'])
          .whereType<num>()
          .map((n) => n.toInt())
          .toSet();
      if (hasHr || empMembers.length != 2 || !empMembers.contains(intMe)) {
        continue;
      }
      int? peerNum;
      for (final id in empMembers) {
        if (id != intMe) {
          peerNum = id;
          break;
        }
      }
      if (peerNum == null) {
        continue;
      }
      out[peerNum.toString()] = tid.toString();
    }
    return out;
  }

  /// Reuses an existing HR↔employee direct thread when possible.
  static Future<String?> getOrCreateDirectThreadHrToEmployee({
    required String companyId,
    required String targetEmployeeId,
    required String threadTitle,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intTarget = int.tryParse(targetEmployeeId);
    final uid = _client.auth.currentUser?.id;
    if (intCompanyId == null || intTarget == null || uid == null) {
      return null;
    }
    final targetRows =
        (await _client
                    .from('app_message_thread_members')
                    .select('thread_id')
                    .eq('company_id', intCompanyId)
                    .eq('member_employee_id', intTarget)
                as List)
            .cast<Map<String, dynamic>>();
    final hrRows =
        (await _client
                    .from('app_message_thread_members')
                    .select('thread_id')
                    .eq('company_id', intCompanyId)
                    .eq('member_hr_user_id', uid)
                as List)
            .cast<Map<String, dynamic>>();
    final targetIds = targetRows
        .map((r) => r['thread_id'])
        .whereType<num>()
        .map((n) => n.toInt())
        .toSet();
    final hrIds = hrRows
        .map((r) => r['thread_id'])
        .whereType<num>()
        .map((n) => n.toInt())
        .toSet();
    final candidates = targetIds.intersection(hrIds).toList();
    if (candidates.isNotEmpty) {
      final threadRows =
          (await _client
                      .from('app_message_threads')
                      .select('id')
                      .eq('company_id', intCompanyId)
                      .eq('thread_type', 'direct')
                      .inFilter('id', candidates)
                  as List)
              .cast<Map<String, dynamic>>();
      if (threadRows.isNotEmpty) {
        return threadRows.first['id']?.toString();
      }
    }
    return createMessageThread(
      companyId: companyId,
      title: threadTitle.trim(),
      threadType: 'direct',
      memberEmployeeIds: [targetEmployeeId],
    );
  }

  /// Reuses an existing peer direct thread between two employees when possible.
  static Future<String?> getOrCreateDirectThreadEmployeePeer({
    required String companyId,
    required String fromEmployeeId,
    required String toEmployeeId,
    required String threadTitle,
  }) async {
    final intCompanyId = int.tryParse(companyId);
    final intFrom = int.tryParse(fromEmployeeId);
    final intTo = int.tryParse(toEmployeeId);
    if (intCompanyId == null || intFrom == null || intTo == null) {
      return null;
    }
    if (_shouldUseEmployeeRpc(companyId: companyId)) {
      final raw = await _client.rpc(
        'employee_get_or_create_direct_thread_peer',
        params: {
          'p_company_id': intCompanyId,
          'p_creator_id': intFrom,
          'p_peer_id': intTo,
          'p_title': threadTitle.trim(),
        },
      );
      return raw?.toString();
    }
    final existing = await findDirectThreadEmployeePeer(
      companyId: companyId,
      fromEmployeeId: fromEmployeeId,
      toEmployeeId: toEmployeeId,
    );
    if (existing != null) {
      return existing;
    }
    return createMessageThread(
      companyId: companyId,
      title: threadTitle.trim(),
      threadType: 'direct',
      memberEmployeeIds: [toEmployeeId],
      creatorEmployeeId: fromEmployeeId,
    );
  }

  // ---- Employee email-based auth -------------------------------------------

  static Future<void> signUpEmployee({
    required String email,
    required String password,
  }) async {
    await _client.auth.signUp(
      email: email.trim().toLowerCase(),
      password: password,
    );
  }

  static Future<List<ResolvedEmployee>> signInEmployee({
    required String email,
    required String password,
  }) async {
    await _client.auth.signInWithPassword(
      email: email.trim().toLowerCase(),
      password: password,
    );
    return getEmployeeCompaniesForCurrentUser();
  }

  /// Sends a phone OTP (SMS) for employee sign-in.
  static Future<void> sendEmployeePhoneOtp({required String phone}) async {
    await _client.auth.signInWithOtp(phone: phone.trim());
  }

  /// Verifies the OTP sent to the employee phone and returns linked
  /// company contexts.
  static Future<List<ResolvedEmployee>> verifyEmployeePhoneOtp({
    required String phone,
    required String otp,
  }) async {
    await _client.auth.verifyOTP(
      type: OtpType.sms,
      phone: phone.trim(),
      token: otp.trim(),
    );
    return getEmployeeCompaniesForCurrentUser();
  }

  static Future<void> signOutEmployee() async {
    await _client.auth.signOut();
  }

  static Future<void> resetEmployeePassword(String email) async {
    await _client.auth.resetPasswordForEmail(email.trim().toLowerCase());
  }

  static Future<void> sendEmployeeEmailOtp({required String email}) async {
    await _client.auth.signInWithOtp(
      email: email.trim().toLowerCase(),
      shouldCreateUser: true,
    );
  }

  static Future<List<ResolvedEmployee>> verifyEmployeeEmailOtp({
    required String email,
    required String otp,
  }) async {
    final token = normalizeEmailOtpToken(otp);
    if (token.isEmpty) {
      throw AuthException('Enter the verification code from your email.');
    }
    await _client.auth.verifyOTP(
      type: OtpType.email,
      email: email.trim().toLowerCase(),
      token: token,
    );
    return getEmployeeCompaniesForCurrentUser();
  }

  /// Returns all company contexts for the currently signed-in employee.
  /// Calls the SECURITY DEFINER RPC so it works regardless of employees RLS.
  static Future<List<ResolvedEmployee>>
  getEmployeeCompaniesForCurrentUser() async {
    if (_client.auth.currentUser == null) return [];

    // Link profile_id to employees rows that match the auth email (no-op if already linked)
    try {
      await _client.rpc('link_employee_profile');
    } catch (_) {}

    final res = await _client.rpc('get_my_employee_companies');
    final rows =
        (res as List?)?.cast<Map<String, dynamic>>() ??
        <Map<String, dynamic>>[];

    return rows.map((row) {
      final employmentType = _parseEmploymentType(
        row['employment_type'] as String?,
      );
      final employmentDateRaw = row['employment_date'];
      final employmentDate =
          employmentDateRaw != null && (employmentDateRaw as String).isNotEmpty
          ? DateTime.tryParse(employmentDateRaw) ?? DateTime.now()
          : DateTime.now();

      return ResolvedEmployee(
        companyId: row['company_id'].toString(),
        companyName: row['company_name'] as String? ?? '',
        companyCode: row['company_code'] as String? ?? '',
        employee: Employee(
          id: row['employee_id'].toString(),
          employeeCode: row['employee_code'] as String? ?? '',
          name: row['emp_name'] as String? ?? '',
          surname: row['emp_surname'] as String? ?? '',
          employmentDate: employmentDate,
          employmentType: employmentType,
          employmentTypeLabel: row['employment_type_label'] as String?,
          position: row['emp_position'] as String? ?? '',
          monthlySalary: (row['monthly_salary'] as num?)?.toDouble() ?? 0.0,
          hourlyRate: (row['hourly_rate'] as num?)?.toDouble() ?? 0.0,
          workDaysWeekly: (row['work_days_weekly'] as num?)?.toDouble() ?? 5,
          dailyHours: (row['daily_hours'] as num?)?.toDouble() ?? 8,
          branch: row['branch'] as String? ?? '',
          managerUserId: row['manager_user_id']?.toString(),
          accessLevel: switch ((row['access_level'] as String? ?? 'employee')
              .toLowerCase()) {
            'manager' => EmployeeAccessLevel.manager,
            'hr_admin' => EmployeeAccessLevel.hrAdmin,
            _ => EmployeeAccessLevel.employee,
          },
          email: row['emp_email'] as String?,
          phone: row['emp_phone'] as String?,
          profileId: row['profile_id']?.toString(),
        ),
      );
    }).toList();
  }
}
