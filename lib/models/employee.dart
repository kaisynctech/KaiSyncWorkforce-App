/// Employment type: part-time, contract, or student
enum EmploymentType { partTime, contract, permanent, student }
enum EmployeeAccessLevel { employee, manager, hrAdmin }

/// Whether the worker is on staff or third-party. Backed by
/// `employees.worker_type` (added by the worker_type_and_invites
/// migration). Drives permissions and reporting (contractor scorecard).
enum WorkerType { employee, contractor, subcontractor }

extension WorkerTypeX on WorkerType {
  String get wireValue {
    switch (this) {
      case WorkerType.employee:
        return 'employee';
      case WorkerType.contractor:
        return 'contractor';
      case WorkerType.subcontractor:
        return 'subcontractor';
    }
  }

  String get label {
    switch (this) {
      case WorkerType.employee:
        return 'Employee';
      case WorkerType.contractor:
        return 'Contractor';
      case WorkerType.subcontractor:
        return 'Subcontractor';
    }
  }
}

WorkerType workerTypeFromString(String? raw) {
  switch ((raw ?? '').toLowerCase()) {
    case 'contractor':
      return WorkerType.contractor;
    case 'subcontractor':
      return WorkerType.subcontractor;
    default:
      return WorkerType.employee;
  }
}

class Employee {
  final String name;
  final String surname;
  final String id;
  final String employeeCode;
  final DateTime employmentDate;
  final EmploymentType employmentType;
  final String position;
  final double monthlySalary;
  final double hourlyRate;
  final double weeklyRate;
  final double dailyRate;
  final double overtimeRate;
  final double doubleTimeRate;
  final double workDaysWeekly;
  final double dailyHours;
  final String branch;
  final String? managerUserId;
  final EmployeeAccessLevel accessLevel;
  final String? employmentTypeLabel;
  final String? email;
  final String? phone;
  final String? profileId;
  final WorkerType workerType;

  const Employee({
    required this.name,
    required this.surname,
    required this.id,
    this.employeeCode = '',
    required this.employmentDate,
    required this.employmentType,
    required this.position,
    this.monthlySalary = 0,
    this.hourlyRate = 0,
    this.weeklyRate = 0,
    this.dailyRate = 0,
    this.overtimeRate = 0,
    this.doubleTimeRate = 0,
    this.workDaysWeekly = 5,
    this.dailyHours = 8,
    this.branch = '',
    this.managerUserId,
    this.accessLevel = EmployeeAccessLevel.employee,
    this.employmentTypeLabel,
    this.email,
    this.phone,
    this.profileId,
    this.workerType = WorkerType.employee,
  });

  String get fullName => '$name $surname'.trim();
  String get displayName => fullName.isNotEmpty ? fullName : (employeeCode.isNotEmpty ? employeeCode : id);

  static const int standardHoursPerDay = 8;

  Map<String, dynamic> toMap() {
    return {
      'name': name,
      'surname': surname,
      'id': id,
      'employee_code': employeeCode,
      'employment_date': employmentDate.toIso8601String(),
      'employment_type': switch (employmentType) {
        EmploymentType.contract => 'contract',
        EmploymentType.student => 'student',
        _ => 'part-time',
      },
      'position': position,
      'monthly_salary': monthlySalary,
      'hourly_rate': hourlyRate,
      'weekly_rate': weeklyRate,
      'daily_rate': dailyRate,
      'Overtime_rate': overtimeRate,
      'double_time_rate': doubleTimeRate,
      'work_days_weekly': workDaysWeekly,
      'daily_hours': dailyHours,
      'branch': branch,
      'manager_user_id': managerUserId,
      'access_level': switch (accessLevel) {
        EmployeeAccessLevel.manager => 'manager',
        EmployeeAccessLevel.hrAdmin => 'hr_admin',
        _ => 'employee',
      },
      'employment_type_label': employmentTypeLabel,
      if (email != null && email!.isNotEmpty) 'email': email!.trim().toLowerCase(),
      if (phone != null && phone!.isNotEmpty) 'phone': phone!.trim(),
    };
  }

  factory Employee.fromMap(Map<String, dynamic> map) {
    final typeStr = (map['employment_type'] as String? ?? '').toLowerCase();
    final type = typeStr.contains('contract')
        ? EmploymentType.contract
        : typeStr.contains('permanent')
            ? EmploymentType.permanent
        : typeStr.contains('student')
            ? EmploymentType.student
            : EmploymentType.partTime;
    return Employee(
      name: map['name'] as String? ?? '',
      surname: map['surname'] as String? ?? '',
      id: map['id']?.toString() ?? '',
      employeeCode: map['employee_code'] as String? ?? '',
      employmentDate: map['employment_date'] != null
          ? DateTime.tryParse(map['employment_date'] as String) ?? DateTime.now()
          : DateTime.now(),
      employmentType: type,
      position: map['position'] as String? ?? '',
      monthlySalary: (map['monthly_salary'] as num?)?.toDouble() ?? (map['monthly'] as num?)?.toDouble() ?? 0,
      hourlyRate: (map['hourly_rate'] as num?)?.toDouble() ?? (map['hourly'] as num?)?.toDouble() ?? 0,
      weeklyRate: (map['weekly_rate'] as num?)?.toDouble() ?? 0,
      dailyRate: (map['daily_rate'] as num?)?.toDouble() ?? 0,
      overtimeRate: (map['Overtime_rate'] as num?)?.toDouble() ?? 0,
      doubleTimeRate: (map['double_time_rate'] as num?)?.toDouble() ?? 0,
      workDaysWeekly: (map['work_days_weekly'] as num?)?.toDouble() ?? 5,
      dailyHours: (map['daily_hours'] as num?)?.toDouble() ?? 8,
      branch: map['branch'] as String? ?? '',
      managerUserId: map['manager_user_id']?.toString(),
      accessLevel: switch ((map['access_level'] as String? ?? 'employee').toLowerCase()) {
        'manager' => EmployeeAccessLevel.manager,
        'hr_admin' => EmployeeAccessLevel.hrAdmin,
        _ => EmployeeAccessLevel.employee,
      },
      employmentTypeLabel: map['employment_type_label'] as String?,
      email: map['email'] as String?,
      phone: map['phone'] as String?,
      profileId: map['profile_id']?.toString(),
    );
  }

  Employee copyWith({
    String? name,
    String? surname,
    String? id,
    String? employeeCode,
    DateTime? employmentDate,
    EmploymentType? employmentType,
    String? position,
    double? monthlySalary,
    double? hourlyRate,
    double? weeklyRate,
    double? dailyRate,
    double? overtimeRate,
    double? doubleTimeRate,
    double? workDaysWeekly,
    double? dailyHours,
    String? branch,
    String? managerUserId,
    EmployeeAccessLevel? accessLevel,
    String? employmentTypeLabel,
    String? email,
    String? phone,
    String? profileId,
    WorkerType? workerType,
  }) {
    return Employee(
      name: name ?? this.name,
      surname: surname ?? this.surname,
      id: id ?? this.id,
      employeeCode: employeeCode ?? this.employeeCode,
      employmentDate: employmentDate ?? this.employmentDate,
      employmentType: employmentType ?? this.employmentType,
      position: position ?? this.position,
      monthlySalary: monthlySalary ?? this.monthlySalary,
      hourlyRate: hourlyRate ?? this.hourlyRate,
      weeklyRate: weeklyRate ?? this.weeklyRate,
      dailyRate: dailyRate ?? this.dailyRate,
      overtimeRate: overtimeRate ?? this.overtimeRate,
      doubleTimeRate: doubleTimeRate ?? this.doubleTimeRate,
      workDaysWeekly: workDaysWeekly ?? this.workDaysWeekly,
      dailyHours: dailyHours ?? this.dailyHours,
      branch: branch ?? this.branch,
      managerUserId: managerUserId ?? this.managerUserId,
      accessLevel: accessLevel ?? this.accessLevel,
      employmentTypeLabel: employmentTypeLabel ?? this.employmentTypeLabel,
      email: email ?? this.email,
      phone: phone ?? this.phone,
      profileId: profileId ?? this.profileId,
      workerType: workerType ?? this.workerType,
    );
  }
}
