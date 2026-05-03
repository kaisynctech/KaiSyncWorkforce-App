class SchedulingRules {
  static const Map<String, Set<String>> _assignmentTransitions = {
    'offered': {'accepted', 'declined'},
    'accepted': {'completed', 'no_show'},
    'declined': {},
    'completed': {},
    'no_show': {},
  };

  static bool canTransitionAssignmentStatus(String from, String to) {
    final allowed = _assignmentTransitions[from];
    if (allowed == null) return false;
    return allowed.contains(to);
  }

  static List<Map<String, dynamic>> buildRecipientFanOut({
    required int companyId,
    required String source,
    required String title,
    required String body,
    required Map<String, dynamic> payload,
    required List<String> recipientUserIds,
  }) {
    return recipientUserIds.map((id) {
      return {
        'company_id': companyId,
        'recipient_user_id': id,
        'channel': 'in_app',
        'source': source,
        'title': title,
        'body': body,
        'payload': payload,
      };
    }).toList();
  }

  static ({bool allowed, String reason}) validateShiftWindowAndDistance({
    required bool hasActiveAcceptedShift,
    required double? distanceMeters,
    required double allowedRadiusMeters,
  }) {
    if (!hasActiveAcceptedShift) {
      return (allowed: false, reason: 'No accepted active shift for this time window.');
    }
    if (distanceMeters != null && distanceMeters > allowedRadiusMeters) {
      return (allowed: false, reason: 'You are outside the allowed shift site radius.');
    }
    return (allowed: true, reason: 'ok');
  }
}
