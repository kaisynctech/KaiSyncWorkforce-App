import 'package:flutter_test/flutter_test.dart';
import 'package:timesheets/models/employee.dart';
import 'package:timesheets/models/punch_session.dart';
import 'package:timesheets/models/time_punch.dart';

void main() {
  group('PunchSession.fromPunches', () {
    test('pairs sign-in/sign-out and keeps separate in/out locations', () {
      final punches = [
        TimePunch(
          employeeId: '10',
          type: PunchType.signIn,
          dateTime: DateTime(2026, 3, 12, 8, 0),
          latitude: -26.0,
          longitude: 28.0,
          address: 'Office Gate',
        ),
        TimePunch(
          employeeId: '10',
          type: PunchType.signOut,
          dateTime: DateTime(2026, 3, 12, 18, 0),
          latitude: -26.1,
          longitude: 28.1,
          address: 'Client Site',
          notes: 'Completed shift',
        ),
      ];

      final employee = Employee(
        name: 'Kai',
        surname: 'Flow',
        id: '10',
        employeeCode: 'FN211956',
        employmentDate: DateTime(2025, 1, 1),
        employmentType: EmploymentType.contract,
        position: 'Technician',
        hourlyRate: 100,
      );

      final sessions = PunchSession.fromPunches(punches, {'10': employee});
      expect(sessions, hasLength(1));

      final s = sessions.first;
      expect(s.employeeId, 'FN211956');
      expect(s.signInLocation, 'Office Gate');
      expect(s.signOutLocation, 'Client Site');
      expect(s.timeIn, DateTime(2026, 3, 12, 8, 0));
      expect(s.timeOut, DateTime(2026, 3, 12, 18, 0));
      expect(s.regularHours, 8);
      expect(s.overtimeHours, 2);
      expect(s.totalHours, 10);
      expect(s.overtimePayment, 300); // 2 * 100 * 1.5
      expect(s.notes, 'Completed shift');
    });

    test('creates single sign-in session when no sign-out exists', () {
      final punches = [
        TimePunch(
          employeeId: '11',
          type: PunchType.signIn,
          dateTime: DateTime(2026, 3, 12, 9, 15),
          address: 'Warehouse',
        ),
      ];

      final sessions = PunchSession.fromPunches(punches, const {});
      expect(sessions, hasLength(1));
      expect(sessions.first.timeIn, DateTime(2026, 3, 12, 9, 15));
      expect(sessions.first.timeOut, isNull);
      expect(sessions.first.signInLocation, 'Warehouse');
      expect(sessions.first.signOutLocation, isNull);
      expect(sessions.first.totalHours, 0);
    });
  });
}
