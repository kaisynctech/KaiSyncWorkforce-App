import 'package:flutter_test/flutter_test.dart';
import 'package:timesheets/widgets/load_error_panel.dart';

void main() {
  group('friendlyErrorMessage', () {
    test('maps permission errors', () {
      final msg = friendlyErrorMessage(
        Exception('permission denied for table hr_users'),
        fallback: 'Load failed.',
      );

      expect(msg, contains('Load failed.'));
      expect(msg, contains('do not have permission'));
    });

    test('maps auth errors', () {
      final msg = friendlyErrorMessage(
        Exception('invalid credentials'),
        fallback: 'Sign in failed.',
      );

      expect(msg, contains('Sign in failed.'));
      expect(msg, contains('sign in again'));
    });

    test('maps network errors', () {
      final msg = friendlyErrorMessage(
        Exception('SocketException: Failed host lookup'),
        fallback: 'Request failed.',
      );

      expect(msg, contains('Request failed.'));
      expect(msg, contains('Network error'));
    });

    test('falls back for unknown errors', () {
      final msg = friendlyErrorMessage(
        Exception('something unusual'),
        fallback: 'Action failed.',
      );

      expect(msg, equals('Action failed.\nPlease try again.'));
    });
  });
}
