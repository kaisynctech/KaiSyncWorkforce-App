import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Holds HR self-registration progress. Step 1 may save email only; company /
/// owner fields are filled on the verify screen (or restored here after a
/// partial failure). Lets sign-in complete `self_register_company` when needed.
class HrSelfRegisterDraft {
  static const _prefsKey = 'hr_self_register_draft_v1';

  final String email;
  final String companyName;
  final String ownerFirstName;
  final String ownerLastName;

  const HrSelfRegisterDraft({
    required this.email,
    required this.companyName,
    required this.ownerFirstName,
    required this.ownerLastName,
  });

  String get normalizedEmail => email.trim().toLowerCase();

  Map<String, dynamic> _toJson() => {
        'email': email.trim(),
        'company_name': companyName.trim(),
        'owner_first_name': ownerFirstName.trim(),
        'owner_last_name': ownerLastName.trim(),
      };

  static HrSelfRegisterDraft? _fromJson(Map<String, dynamic>? m) {
    if (m == null) return null;
    final e = (m['email'] as String?)?.trim();
    if (e == null || e.isEmpty) return null;
    return HrSelfRegisterDraft(
      email: e,
      companyName: (m['company_name'] as String?)?.trim() ?? '',
      ownerFirstName: (m['owner_first_name'] as String?)?.trim() ?? '',
      ownerLastName: (m['owner_last_name'] as String?)?.trim() ?? '',
    );
  }

  static Future<void> save(HrSelfRegisterDraft draft) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_prefsKey, jsonEncode(draft._toJson()));
  }

  static Future<HrSelfRegisterDraft?> load() async {
    final p = await SharedPreferences.getInstance();
    final raw = p.getString(_prefsKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final m = jsonDecode(raw);
      if (m is! Map<String, dynamic>) return null;
      return _fromJson(m);
    } catch (_) {
      return null;
    }
  }

  static Future<void> clear() async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_prefsKey);
  }
}
