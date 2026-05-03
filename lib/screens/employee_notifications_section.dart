import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/timesheet_provider.dart';
import '../widgets/notifications_center_panel.dart';

class EmployeeNotificationsSection extends StatelessWidget {
  const EmployeeNotificationsSection({super.key});

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<TimesheetProvider>();
    final companyId = prov.currentCompanyId;
    final employeeId = prov.currentEmployee?.id;
    if (companyId == null || employeeId == null) {
      return const Center(child: Text('No company selected.'));
    }
    return Padding(
      padding: const EdgeInsets.all(16),
      child: NotificationsCenterPanel(
        companyId: companyId,
        employeeId: employeeId,
      ),
    );
  }
}
