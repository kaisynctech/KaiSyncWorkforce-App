import 'package:flutter/foundation.dart';

@immutable
class WorkTeam {
  final String id;
  final String name;
  final String companyId;

  const WorkTeam({
    required this.id,
    required this.name,
    required this.companyId,
  });
}
