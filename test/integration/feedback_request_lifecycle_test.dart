import 'package:flutter_test/flutter_test.dart';
import 'package:timesheets/models/payment_approval.dart';

void main() {
  group('Feedback/payment lifecycle guardrails', () {
    test('payment approval defaults remain pending', () {
      final approval = PaymentApproval(
        employeeId: '10',
        periodStart: DateTime(2026, 4, 1),
        approved: false,
      );
      expect(approval.status, 'pending');
      expect(approval.approved, isFalse);
    });
  });
}
