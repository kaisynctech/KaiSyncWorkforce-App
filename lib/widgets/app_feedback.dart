import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

SnackBar _buildSnack(String message, Color color) {
  return SnackBar(
    content: Text(message, style: GoogleFonts.poppins()),
    backgroundColor: color,
    behavior: SnackBarBehavior.floating,
    margin: const EdgeInsets.fromLTRB(16, 8, 16, 16),
    duration: const Duration(seconds: 3),
  );
}

void _showSnack(BuildContext context, SnackBar snack) {
  // Dismiss any currently visible snack bar before showing the new one
  // so they don't stack into a tower on rapid operations.
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(snack);
}

void showErrorSnack(BuildContext context, String message) {
  _showSnack(context, _buildSnack(message, Colors.red));
}

void showSuccessSnack(BuildContext context, String message) {
  _showSnack(context, _buildSnack(message, const Color(0xFF059669)));
}

void showInfoSnack(BuildContext context, String message) {
  _showSnack(context, _buildSnack(message, const Color(0xFF2563EB)));
}
