import 'package:flutter_test/flutter_test.dart';
import 'package:timesheets/services/scheduling_rules.dart';

void main() {
  group('SchedulingRules transitions', () {
    test('allows valid assignment transitions', () {
      expect(SchedulingRules.canTransitionAssignmentStatus('offered', 'accepted'), isTrue);
      expect(SchedulingRules.canTransitionAssignmentStatus('accepted', 'completed'), isTrue);
      expect(SchedulingRules.canTransitionAssignmentStatus('accepted', 'no_show'), isTrue);
    });

    test('rejects invalid assignment transitions', () {
      expect(SchedulingRules.canTransitionAssignmentStatus('declined', 'accepted'), isFalse);
      expect(SchedulingRules.canTransitionAssignmentStatus('completed', 'accepted'), isFalse);
      expect(SchedulingRules.canTransitionAssignmentStatus('unknown', 'accepted'), isFalse);
    });
  });

  group('SchedulingRules recipient fan-out', () {
    test('creates one notification payload per recipient', () {
      final rows = SchedulingRules.buildRecipientFanOut(
        companyId: 1,
        source: 'incident',
        title: 'New incident',
        body: 'Test',
        payload: {'submission_id': 44},
        recipientUserIds: const ['u1', 'u2', 'u3'],
      );
      expect(rows, hasLength(3));
      expect(rows.first['company_id'], 1);
      expect(rows[1]['recipient_user_id'], 'u2');
      expect(rows.last['payload'], {'submission_id': 44});
    });
  });

  group('SchedulingRules geofence/window decisions', () {
    test('blocks when no active shift', () {
      final result = SchedulingRules.validateShiftWindowAndDistance(
        hasActiveAcceptedShift: false,
        distanceMeters: 10,
        allowedRadiusMeters: 200,
      );
      expect(result.allowed, isFalse);
      expect(result.reason, contains('No accepted active shift'));
    });

    test('blocks when outside geofence radius', () {
      final result = SchedulingRules.validateShiftWindowAndDistance(
        hasActiveAcceptedShift: true,
        distanceMeters: 350,
        allowedRadiusMeters: 200,
      );
      expect(result.allowed, isFalse);
      expect(result.reason, contains('outside the allowed shift site radius'));
    });

    test('allows when in window and in radius', () {
      final result = SchedulingRules.validateShiftWindowAndDistance(
        hasActiveAcceptedShift: true,
        distanceMeters: 120,
        allowedRadiusMeters: 200,
      );
      expect(result.allowed, isTrue);
      expect(result.reason, 'ok');
    });
  });
}
