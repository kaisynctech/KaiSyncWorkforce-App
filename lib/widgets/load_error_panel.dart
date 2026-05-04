import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:postgrest/postgrest.dart' show PostgrestException;
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;

String friendlyErrorMessage(Object? error, {required String fallback}) {
  if (error is PostgrestException) {
    final m = error.message.trim();
    final lower = m.toLowerCase();
    if (lower.contains('already mapped') && lower.contains('company')) {
      return 'This login is already linked to a company. Use “HR sign in” on the home screen — '
          'do not register again. If you forgot your company code, contact support.';
    }
    if (lower.contains('must be signed in') && lower.contains('register')) {
      return 'Your session expired before company setup finished. Sign in with HR, then try '
          '“Create company” again (your details may be saved from last time).';
    }
    if (lower.contains('company name is required')) {
      return 'Enter a company name.';
    }
    if (m.isNotEmpty) {
      return m;
    }
    return fallback;
  }

  if (error is AuthException) {
    final m = error.message.trim();
    if (m.isEmpty) return fallback;
    final lower = m.toLowerCase();
    if (lower.contains('rate limit')) {
      return '$m Wait a few minutes before requesting another code.';
    }
    // Email/SMS OTP from Supabase — users often see a terse "invalid token" style message.
    if (lower.contains('token') &&
        (lower.contains('invalid') ||
            lower.contains('expired') ||
            lower.contains('expire'))) {
      return 'That verification code is wrong or has expired. Tap “Resend code”, wait for the '
          'new email, and enter only that latest code within a few minutes. '
          'Use the digits from the message body (not an old code or a link).';
    }
    if (lower.contains('otp') &&
        (lower.contains('invalid') || lower.contains('expired'))) {
      return 'That verification code is wrong or has expired. Request a new code and try again '
          'with the newest one.';
    }
    if (lower.contains('sub claim') && lower.contains('jwt')) {
      return 'Your browser held an old or invalid login session. We cleared it — '
          'enter the verification code again (tap Resend code if needed).';
    }
    return m;
  }

  final raw = (error ?? '').toString();
  final msg = raw.toLowerCase();

  if (msg.contains('permission denied') ||
      msg.contains("code':'42501") ||
      msg.contains('code: 403')) {
    return '$fallback\nYou do not have permission for this data. Contact your administrator.';
  }
  if (msg.contains('jwt') ||
      msg.contains('invalid credentials') ||
      msg.contains('session_not_found') ||
      msg.contains('refresh_token_not_found')) {
    return '$fallback\nYour session has expired. Please sign in again.';
  }
  if (msg.contains('token') && msg.contains('auth')) {
    return '$fallback\nAuthentication error. Please sign in again.';
  }
  if (msg.contains('socket') ||
      msg.contains('network') ||
      msg.contains('timed out') ||
      msg.contains('timeout') ||
      msg.contains('failed host lookup') ||
      msg.contains('connection refused') ||
      msg.contains('no address associated')) {
    return '$fallback\nNetwork error. Check your internet connection and try again.';
  }
  if (msg.contains('rls') || msg.contains('row-level security')) {
    return '$fallback\nAccess policy blocked this request. Please verify your permissions.';
  }
  if (msg.contains('duplicate key') || msg.contains('23505') || msg.contains('unique')) {
    return '$fallback\nThis record already exists.';
  }
  if (msg.contains('foreign key') || msg.contains('23503')) {
    return '$fallback\nThis record is referenced by other data and cannot be removed.';
  }
  if (msg.contains('not found') || msg.contains('404') || msg.contains('pgrst116')) {
    return '$fallback\nThe requested record was not found.';
  }
  if (msg.contains('too large') || msg.contains('payload') || msg.contains('413')) {
    return '$fallback\nThe file or data is too large. Try a smaller file.';
  }
  if (msg.contains('storage') && (msg.contains('bucket') || msg.contains('object'))) {
    return '$fallback\nFile storage error. Please try again or contact support.';
  }

  return '$fallback\nPlease try again.';
}

class LoadErrorPanel extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  final EdgeInsetsGeometry padding;

  const LoadErrorPanel({
    super.key,
    required this.message,
    required this.onRetry,
    this.padding = const EdgeInsets.all(24),
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: padding,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              message,
              textAlign: TextAlign.center,
              style: GoogleFonts.poppins(color: const Color(0xFFB91C1C)),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
