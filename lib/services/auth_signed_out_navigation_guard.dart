/// HR email verification calls [signOut] to drop a stale JWT before [verifyOTP].
/// [TimesheetApp] also listens for [AuthChangeEvent.signedOut] and resets nav to
/// [IdEntryScreen], which would dispose the registration flow. Increment during
/// that intentional sign-out so routing is not reset.
class AuthSignedOutNavigationGuard {
  AuthSignedOutNavigationGuard._();

  static int _depth = 0;

  static bool get suppressSignedOutNavigation => _depth > 0;

  static void enter() => _depth++;

  static void leave() {
    if (_depth > 0) _depth--;
  }
}
