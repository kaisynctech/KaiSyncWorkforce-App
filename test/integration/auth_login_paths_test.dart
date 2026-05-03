import 'package:flutter_test/flutter_test.dart';
import 'package:timesheets/services/supabase_timesheet_storage.dart';

void main() {
  group('Auth login paths', () {
    test('builds public feedback URL from token', () {
      const token = 'abc123token';
      final url = SupabaseTimesheetStorage.buildPublicFeedbackLink(token);
      expect(url, contains('job_feedback_public'));
      expect(url, contains('token=$token'));
      expect(url.startsWith('https://'), isTrue);
    });
  });
}
