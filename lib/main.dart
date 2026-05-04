import 'dart:async';
import 'dart:ui';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_web_plugins/url_strategy.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'services/app_telemetry.dart';
import 'theme/app_theme.dart';
import 'providers/job_provider.dart';
import 'providers/timesheet_provider.dart';
import 'screens/id_entry_screen.dart';
import 'supabase_config.dart';

void main() {
  runZonedGuarded(
    () async {
      WidgetsFlutterBinding.ensureInitialized();
      if (kIsWeb) {
        usePathUrlStrategy();
      }
      FlutterError.onError = (details) {
        AppTelemetry.logError(
          screen: 'global',
          action: 'flutter_error',
          error: details.exception,
          stackTrace: details.stack,
        );
      };
      PlatformDispatcher.instance.onError = (error, stack) {
        AppTelemetry.logError(
          screen: 'global',
          action: 'platform_dispatcher_error',
          error: error,
          stackTrace: stack,
        );
        return true;
      };
      await Supabase.initialize(
        url: SupabaseConfig.url,
        anonKey: SupabaseConfig.anonKey,
        // PKCE + SharedPreferences on web often breaks email OTP on hosted origins;
        // implicit flow avoids code-verifier mismatch while OTP is still typed manually.
        authOptions: FlutterAuthClientOptions(
          authFlowType: kIsWeb ? AuthFlowType.implicit : AuthFlowType.pkce,
        ),
      );
      runApp(const TimesheetApp());
    },
    (error, stackTrace) {
      AppTelemetry.logError(
        screen: 'global',
        action: 'zoned_guarded_error',
        error: error,
        stackTrace: stackTrace,
      );
    },
  );
}

class TimesheetApp extends StatefulWidget {
  const TimesheetApp({super.key});

  @override
  State<TimesheetApp> createState() => _TimesheetAppState();
}

class _TimesheetAppState extends State<TimesheetApp> {
  final _navigatorKey = GlobalKey<NavigatorState>();
  late final StreamSubscription<AuthState> _authSubscription;

  @override
  void initState() {
    super.initState();
    // Listen for auth changes so explicit sign-out returns users to the entry screen.
    _authSubscription = Supabase.instance.client.auth.onAuthStateChange.listen(
      (data) {
        // Only treat explicit sign-out as “leave the dashboard”.
        // Token refresh must not reset navigation (would feel like data/session loss).
        if (data.event == AuthChangeEvent.signedOut) {
          _navigatorKey.currentState?.pushAndRemoveUntil(
            MaterialPageRoute(builder: (_) => const IdEntryScreen()),
            (route) => false,
          );
        }
      },
      onError: (error, stack) {
        AppTelemetry.logError(
          screen: 'auth',
          action: 'auth_state_change_error',
          error: error,
          stackTrace: stack,
        );
      },
    );
  }

  @override
  void dispose() {
    _authSubscription.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => TimesheetProvider()),
        ChangeNotifierProvider(create: (_) => JobProvider()),
      ],
      child: MaterialApp(
        title: 'KaiSync Workforce',
        debugShowCheckedModeBanner: false,
        navigatorKey: _navigatorKey,
        theme: AppTheme.darkTheme,
        scrollBehavior: const MaterialScrollBehavior().copyWith(
          dragDevices: {
            PointerDeviceKind.touch,
            PointerDeviceKind.mouse,
            PointerDeviceKind.stylus,
            PointerDeviceKind.invertedStylus,
            PointerDeviceKind.unknown,
          },
        ),
        home: const IdEntryScreen(),
      ),
    );
  }
}
