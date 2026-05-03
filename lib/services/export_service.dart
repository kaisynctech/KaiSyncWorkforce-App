import 'dart:convert';
import 'dart:typed_data';

import 'package:file_saver/file_saver.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

enum ExportFormat { csv, excelCsv, pdf }

class ExportService {
  static Future<void> exportTable({
    required String fileBaseName,
    required List<String> headers,
    required List<List<String>> rows,
    required ExportFormat format,
  }) async {
    switch (format) {
      case ExportFormat.csv:
        await _saveCsv(
          fileBaseName: fileBaseName,
          headers: headers,
          rows: rows,
        );
        return;
      case ExportFormat.excelCsv:
        await _saveCsv(
          fileBaseName: fileBaseName,
          headers: headers,
          rows: rows,
        );
        return;
      case ExportFormat.pdf:
        await _savePdf(
          fileBaseName: fileBaseName,
          headers: headers,
          rows: rows,
        );
        return;
    }
  }

  static Future<void> _saveCsv({
    required String fileBaseName,
    required List<String> headers,
    required List<List<String>> rows,
  }) async {
    final lines = <String>[
      _csvLine(headers),
      ...rows.map(_csvLine),
    ];
    final csv = '\uFEFF${lines.join('\n')}';
    final bytes = Uint8List.fromList(utf8.encode(csv));
    await FileSaver.instance.saveFile(
      name: fileBaseName,
      bytes: bytes,
      fileExtension: 'csv',
      mimeType: MimeType.csv,
    );
  }

  static Future<void> _savePdf({
    required String fileBaseName,
    required List<String> headers,
    required List<List<String>> rows,
  }) async {
    final doc = pw.Document();
    doc.addPage(
      pw.MultiPage(
        pageFormat: PdfPageFormat.a4.landscape,
        build: (context) => [
          pw.Text(
            fileBaseName,
            style: pw.TextStyle(
              fontSize: 16,
              fontWeight: pw.FontWeight.bold,
            ),
          ),
          pw.SizedBox(height: 10),
          pw.TableHelper.fromTextArray(
            headers: headers,
            data: rows,
            headerStyle: pw.TextStyle(fontWeight: pw.FontWeight.bold),
            headerDecoration: const pw.BoxDecoration(color: PdfColors.grey300),
            cellStyle: const pw.TextStyle(fontSize: 9),
            cellAlignments: {for (var i = 0; i < headers.length; i++) i: pw.Alignment.centerLeft},
          ),
        ],
      ),
    );
    final bytes = Uint8List.fromList(await doc.save());
    await FileSaver.instance.saveFile(
      name: fileBaseName,
      bytes: bytes,
      fileExtension: 'pdf',
      mimeType: MimeType.pdf,
    );
  }

  static String _csvLine(List<String> cells) {
    return cells.map(_csvEscape).join(',');
  }

  static String _csvEscape(String value) {
    final escaped = value.replaceAll('"', '""');
    return '"$escaped"';
  }
}
