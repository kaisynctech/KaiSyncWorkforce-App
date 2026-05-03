import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'supabase_timesheet_storage.dart';

class AppUpdateDecision {
  final bool requiredUpdate;
  final String currentVersion;
  final String latestVersion;
  final String? minimumSupportedVersion;
  final String? updateUrl;

  const AppUpdateDecision({
    required this.requiredUpdate,
    required this.currentVersion,
    required this.latestVersion,
    required this.minimumSupportedVersion,
    required this.updateUrl,
  });
}

class AppUpdateService {
  /// Avoid showing the same prompt twice in quick succession (e.g. IdEntry then HR dashboard).
  static DateTime? _suppressDuplicatePromptUntil;

  static int _compareVersion(String a, String b) {
    List<int> parse(String v) {
      final clean = v.split('+').first.split('-').first.trim();
      return clean
          .split('.')
          .map((p) => int.tryParse(p) ?? 0)
          .toList(growable: false);
    }

    final av = parse(a);
    final bv = parse(b);
    final len = av.length > bv.length ? av.length : bv.length;
    for (var i = 0; i < len; i++) {
      final ai = i < av.length ? av[i] : 0;
      final bi = i < bv.length ? bv[i] : 0;
      if (ai != bi) return ai.compareTo(bi);
    }
    return 0;
  }

  static String? _urlForPlatform(AppReleaseConfig cfg) {
    if (kIsWeb) return cfg.updateUrlWeb;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return cfg.updateUrlAndroid;
      case TargetPlatform.iOS:
        return cfg.updateUrlIos;
      default:
        return cfg.updateUrlWeb ?? cfg.updateUrlAndroid ?? cfg.updateUrlIos;
    }
  }

  static Future<AppUpdateDecision?> checkForUpdate() async {
    final cfg = await SupabaseTimesheetStorage.getAppReleaseConfig();
    if (cfg == null || !cfg.isEnabled || cfg.latestVersion.trim().isEmpty) return null;

    final info = await PackageInfo.fromPlatform();
    final current = info.version.trim();
    final latest = cfg.latestVersion.trim();
    final minSupported = cfg.minimumSupportedVersion?.trim();

    final requiresByMin = minSupported != null &&
        minSupported.isNotEmpty &&
        _compareVersion(current, minSupported) < 0;
    final hasNewer = _compareVersion(current, latest) < 0;

    if (!hasNewer && !requiresByMin) return null;
    return AppUpdateDecision(
      requiredUpdate: cfg.forceUpdate || requiresByMin,
      currentVersion: current,
      latestVersion: latest,
      minimumSupportedVersion: minSupported,
      updateUrl: _urlForPlatform(cfg),
    );
  }

  static Future<void> maybePromptForUpdate(
    BuildContext context, {
    bool barrierDismissibleForOptional = true,
  }) async {
    final now = DateTime.now();
    if (_suppressDuplicatePromptUntil != null &&
        now.isBefore(_suppressDuplicatePromptUntil!)) {
      return;
    }

    final decision = await checkForUpdate();
    if (decision == null || !context.mounted) return;

    _suppressDuplicatePromptUntil = now.add(const Duration(minutes: 10));

    final actionText = decision.requiredUpdate ? 'Update now' : 'Update';
    await showDialog<void>(
      context: context,
      barrierDismissible: !decision.requiredUpdate && barrierDismissibleForOptional,
      builder: (dialogContext) => AlertDialog(
        title: Text(decision.requiredUpdate ? 'Update Required' : 'Update Available'),
        content: Text(
          'Current version: ${decision.currentVersion}\n'
          'Latest version: ${decision.latestVersion}'
          '${decision.minimumSupportedVersion != null && decision.minimumSupportedVersion!.isNotEmpty ? '\nMinimum supported: ${decision.minimumSupportedVersion}' : ''}',
        ),
        actions: [
          if (!decision.requiredUpdate)
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Later'),
            ),
          ElevatedButton(
            onPressed: () async {
              final url = decision.updateUrl;
              if (url != null && url.isNotEmpty) {
                final uri = Uri.tryParse(url);
                if (uri != null) {
                  await launchUrl(uri, mode: LaunchMode.externalApplication);
                }
              }
              if (!decision.requiredUpdate && dialogContext.mounted) {
                Navigator.of(dialogContext).pop();
              }
            },
            child: Text(actionText),
          ),
        ],
      ),
    );
  }
}

