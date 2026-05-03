import 'package:flutter/foundation.dart';

enum JobStatus { scheduled, inProgress, completed, cancelled }

/// Maintenance / SLA priority. Drives SLA target lookup and dashboard
/// charts. `none` = no priority assigned (legacy / non-maintenance jobs).
enum JobPriority { none, critical, high, medium, low }

@immutable
class Job {
  final String id;
  final String title;
  final String? description;
  final String clientId;
  final String? siteId;
  final DateTime? scheduledStart;
  final DateTime? scheduledEnd;
  final JobStatus status;
  final List<String> assignedEmployeeIds;

  // ── Property-management / SLA fields ──────────────────────────────
  final JobPriority priority;
  final String? issueCategoryId;
  final String? unitId;
  final String? reporterResidentId;

  /// When the job was reported / opened. Distinct from [scheduledStart]
  /// (when work was planned). SLA timers measure from here.
  final DateTime? openedAt;

  /// First time a technician acted on the job. Used for SLA response time.
  final DateTime? firstResponseAt;

  /// Job completion timestamp. Drives SLA resolution time and triggers
  /// the resident feedback flow.
  final DateTime? closedAt;

  final double? estimatedCost;
  final double? actualCost;
  final double? inventoryCost;
  final double? laborCost;
  final double? otherCost;

  /// Single-owner assignment (replaces array-based assignment for new
  /// flows). Maps to employees.id. Kept alongside [assignedEmployeeIds]
  /// for back-compat.
  final String? assigneeEmployeeId;

  /// External contractor (also stored in employees with worker_type =
  /// contractor). Same id space as [assigneeEmployeeId] for now.
  final String? contractorEmployeeId;
  final String? contractorId; // contractors.id (parent entity)

  final bool isCallback;
  final bool isPreventive;
  final String? parentJobId;
  final String? slaTargetId;

  /// Reference into an external system (e.g. PPSP's ticketing). Allows
  /// inbound webhooks to round-trip updates without dup creation.
  final String? externalRef;

  /// Optional FK to client_deals — lets a deal spawn many jobs and
  /// drives the References panel on the job detail screen.
  final String? dealId;

  const Job({
    required this.id,
    required this.title,
    required this.clientId,
    this.description,
    this.siteId,
    this.scheduledStart,
    this.scheduledEnd,
    this.status = JobStatus.scheduled,
    this.assignedEmployeeIds = const [],
    this.priority = JobPriority.none,
    this.issueCategoryId,
    this.unitId,
    this.reporterResidentId,
    this.openedAt,
    this.firstResponseAt,
    this.closedAt,
    this.estimatedCost,
    this.actualCost,
    this.inventoryCost,
    this.laborCost,
    this.otherCost,
    this.assigneeEmployeeId,
    this.contractorEmployeeId,
    this.contractorId,
    this.isCallback = false,
    this.isPreventive = false,
    this.parentJobId,
    this.slaTargetId,
    this.externalRef,
    this.dealId,
  });

  Job copyWith({
    String? id,
    String? title,
    String? description,
    String? clientId,
    String? siteId,
    DateTime? scheduledStart,
    DateTime? scheduledEnd,
    JobStatus? status,
    List<String>? assignedEmployeeIds,
    JobPriority? priority,
    String? issueCategoryId,
    String? unitId,
    String? reporterResidentId,
    DateTime? openedAt,
    DateTime? firstResponseAt,
    DateTime? closedAt,
    double? estimatedCost,
    double? actualCost,
    double? inventoryCost,
    double? laborCost,
    double? otherCost,
    String? assigneeEmployeeId,
    String? contractorEmployeeId,
    String? contractorId,
    bool? isCallback,
    bool? isPreventive,
    String? parentJobId,
    String? slaTargetId,
    String? externalRef,
    String? dealId,
  }) {
    return Job(
      id: id ?? this.id,
      title: title ?? this.title,
      description: description ?? this.description,
      clientId: clientId ?? this.clientId,
      siteId: siteId ?? this.siteId,
      scheduledStart: scheduledStart ?? this.scheduledStart,
      scheduledEnd: scheduledEnd ?? this.scheduledEnd,
      status: status ?? this.status,
      assignedEmployeeIds: assignedEmployeeIds ?? this.assignedEmployeeIds,
      priority: priority ?? this.priority,
      issueCategoryId: issueCategoryId ?? this.issueCategoryId,
      unitId: unitId ?? this.unitId,
      reporterResidentId: reporterResidentId ?? this.reporterResidentId,
      openedAt: openedAt ?? this.openedAt,
      firstResponseAt: firstResponseAt ?? this.firstResponseAt,
      closedAt: closedAt ?? this.closedAt,
      estimatedCost: estimatedCost ?? this.estimatedCost,
      actualCost: actualCost ?? this.actualCost,
      inventoryCost: inventoryCost ?? this.inventoryCost,
      laborCost: laborCost ?? this.laborCost,
      otherCost: otherCost ?? this.otherCost,
      assigneeEmployeeId: assigneeEmployeeId ?? this.assigneeEmployeeId,
      contractorEmployeeId: contractorEmployeeId ?? this.contractorEmployeeId,
      contractorId: contractorId ?? this.contractorId,
      isCallback: isCallback ?? this.isCallback,
      isPreventive: isPreventive ?? this.isPreventive,
      parentJobId: parentJobId ?? this.parentJobId,
      slaTargetId: slaTargetId ?? this.slaTargetId,
      externalRef: externalRef ?? this.externalRef,
      dealId: dealId ?? this.dealId,
    );
  }
}

extension JobPriorityX on JobPriority {
  /// Wire-format used in the Postgres `priority` column.
  String? get wireValue {
    switch (this) {
      case JobPriority.none:
        return null;
      case JobPriority.critical:
        return 'critical';
      case JobPriority.high:
        return 'high';
      case JobPriority.medium:
        return 'medium';
      case JobPriority.low:
        return 'low';
    }
  }

  String get label {
    switch (this) {
      case JobPriority.none:
        return 'No priority';
      case JobPriority.critical:
        return 'Critical';
      case JobPriority.high:
        return 'High';
      case JobPriority.medium:
        return 'Medium';
      case JobPriority.low:
        return 'Low';
    }
  }
}

JobPriority jobPriorityFromString(String? raw) {
  switch ((raw ?? '').toLowerCase()) {
    case 'critical':
      return JobPriority.critical;
    case 'high':
      return JobPriority.high;
    case 'medium':
      return JobPriority.medium;
    case 'low':
      return JobPriority.low;
    default:
      return JobPriority.none;
  }
}
