import 'package:flutter/foundation.dart';

/// Lightweight telemetry sink.
///
/// In development all events are printed to the debug console.
/// Replace the bodies of [logError] and [logInfo] with a real SDK
/// (e.g. Sentry, Firebase Crashlytics) when moving to production —
/// debugPrint is stripped from release builds and events will be lost.
class AppTelemetry {
  static String _ts() => DateTime.now().toIso8601String();

  static void logError({
    required String screen,
    required String action,
    Object? error,
    StackTrace? stackTrace,
  }) {
    if (!kDebugMode) return; // TODO: replace with remote SDK call for production
    debugPrint('[${_ts()}][ERROR] screen=$screen action=$action');
    if (error != null) debugPrint('  error: $error');
    if (stackTrace != null) {
      debugPrint('  stackTrace:\n${stackTrace.toString().split('\n').take(8).join('\n')}');
    }
  }

  static void logInfo({
    required String screen,
    required String action,
    String? details,
  }) {
    if (!kDebugMode) return;
    debugPrint('[${_ts()}][INFO] screen=$screen action=$action${details != null ? ' details=$details' : ''}');
  }

  static void logWarning({
    required String screen,
    required String action,
    String? details,
  }) {
    if (!kDebugMode) return;
    debugPrint('[${_ts()}][WARN] screen=$screen action=$action${details != null ? ' details=$details' : ''}');
  }
}
