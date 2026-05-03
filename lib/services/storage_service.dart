import 'dart:typed_data';

import 'package:supabase_flutter/supabase_flutter.dart';

class StorageService {
  // NOTE: Create this bucket in Supabase Storage (public or with RLS policies).
  static const String bucket = 'workforce-media';

  static final _client = Supabase.instance.client;

  static Future<String> uploadBytes({
    required String folder,
    required String fileName,
    required Uint8List bytes,
    required String contentType,
  }) async {
    final path = '$folder/$fileName';
    await _client.storage.from(bucket).uploadBinary(
          path,
          bytes,
          fileOptions: FileOptions(
            contentType: contentType,
            upsert: true,
          ),
        );
    return _client.storage.from(bucket).getPublicUrl(path);
  }
}

