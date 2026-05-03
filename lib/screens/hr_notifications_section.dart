import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/timesheet_provider.dart';
import '../widgets/notifications_center_panel.dart';

class HrNotificationsSection extends StatelessWidget {
  const HrNotificationsSection({super.key});

  @override
  Widget build(BuildContext context) {
    final companyId = context.watch<TimesheetProvider>().currentCompanyId;
    if (companyId == null) {
      return const Center(child: Text('No company selected.'));
    }
    return Padding(
      padding: const EdgeInsets.all(16),
      child: NotificationsCenterPanel(
        companyId: companyId,
        forHr: true,
      ),
    );
  }
}
