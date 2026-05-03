import 'dart:math' as math;

import 'package:flutter/widgets.dart';

class Responsive {
  static const double tinyPhoneMax = 390;
  static const double phoneMax = 599;
  static const double tabletMax = 1023;
  static const double desktopMaxContent = 1400;

  static bool isTinyPhone(BuildContext context) => MediaQuery.of(context).size.width <= tinyPhoneMax;
  static bool isPhone(BuildContext context) => MediaQuery.of(context).size.width <= phoneMax;
  static bool isTablet(BuildContext context) {
    final w = MediaQuery.of(context).size.width;
    return w > phoneMax && w <= tabletMax;
  }

  static bool isDesktop(BuildContext context) => MediaQuery.of(context).size.width > tabletMax;

  static double horizontalPadding(BuildContext context) {
    final w = MediaQuery.of(context).size.width;
    if (w <= tinyPhoneMax) return 10;
    if (w <= phoneMax) return 12;
    if (w <= tabletMax) return 16;
    return 24;
  }

  static double sidebarWidth(BuildContext context) {
    final w = MediaQuery.of(context).size.width;
    if (w <= 900) return 232;
    if (w <= 1280) return 248;
    return 268;
  }

  static double statCardWidth(BuildContext context) {
    final w = MediaQuery.of(context).size.width;
    if (w <= phoneMax) return 158;
    if (w <= tabletMax) return 170;
    return 190;
  }

  static double contentMaxWidth(BuildContext context) {
    final w = MediaQuery.of(context).size.width;
    return math.min(desktopMaxContent, w);
  }
}
