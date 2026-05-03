import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Brand theme – different shades of blue, a bit of red, and white.
class AppTheme {
  // Base blues
  static const Color black = Color(0xFF020617); // near-black navy
  static const Color darkBlack = Color(0xFF0B1120); // app bar / top sections
  static const Color gray = Color(0xFF111827); // card background (dark blue-gray)
  static const Color grayLight = Color(0xFF1F2937); // dividers / subtle borders
  static const Color textGray = Color(0xFF9CA3AF); // secondary text

  // Blues & accents
  static const Color gold = Color(0xFF3B82F6); // primary blue
  static const Color goldLight = Color(0xFF60A5FA); // lighter blue
  static const Color goldDark = Color(0xFF1D4ED8); // darker blue
  static const Color white = Color(0xFFFFFFFF);
  static const Color accentRed = Color(0xFFEF4444); // error / attention

  static ThemeData get darkTheme {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      scaffoldBackgroundColor: Color(0xFFF3F5FB),
      primaryColor: gold,
      colorScheme: const ColorScheme.light(
        primary: gold,
        secondary: goldLight,
        surface: white,
        error: accentRed,
        onPrimary: white,
        onSecondary: white,
        onSurface: Color(0xFF111827),
        onError: white,
      ),
      textTheme: GoogleFonts.poppinsTextTheme(
        const TextTheme(
          headlineLarge: TextStyle(color: Color(0xFF111827), fontWeight: FontWeight.w700),
          headlineMedium: TextStyle(color: Color(0xFF111827), fontWeight: FontWeight.w600),
          titleLarge: TextStyle(color: Color(0xFF111827)),
          titleMedium: TextStyle(color: Color(0xFF374151)),
          bodyLarge: TextStyle(color: Color(0xFF111827)),
          bodyMedium: TextStyle(color: Color(0xFF4B5563)),
          labelLarge: TextStyle(color: Color(0xFF4B5563), fontWeight: FontWeight.w600),
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: white,
        foregroundColor: Color(0xFF111827),
        elevation: 0,
        titleTextStyle: GoogleFonts.poppins(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: Color(0xFF111827),
        ),
      ),
      cardTheme: CardThemeData(
        color: white,
        elevation: 4,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: Color(0xFFE5E7EB)),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: gold,
          foregroundColor: white,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(50)),
          textStyle: GoogleFonts.poppins(fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: gold,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(50)),
        ).copyWith(
          side: WidgetStateProperty.all(const BorderSide(color: gold)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: Color(0xFFD1D5DB)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: gold),
        ),
        labelStyle: const TextStyle(color: Color(0xFF6B7280)),
        hintStyle: const TextStyle(color: textGray),
      ),
      scrollbarTheme: ScrollbarThemeData(
        thumbVisibility: WidgetStateProperty.all(true),
        trackVisibility: WidgetStateProperty.all(true),
        thickness: WidgetStateProperty.all(10),
        radius: const Radius.circular(10),
        thumbColor: WidgetStateProperty.all(const Color(0xFF9CA3AF)),
        trackColor: WidgetStateProperty.all(const Color(0xFFE5E7EB)),
      ),
      dividerColor: const Color(0xFFE5E7EB),
    );
  }
}
