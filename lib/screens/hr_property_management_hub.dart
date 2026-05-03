import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../providers/timesheet_provider.dart';
import 'hr_properties_section.dart';
import 'hr_residents_section.dart';
import 'hr_assets_section.dart';

/// Property management: Properties (sites + units + occupants), read-only
/// resident directory, and optional Assets.
class HrPropertyManagementHub extends StatefulWidget {
  const HrPropertyManagementHub({super.key});

  @override
  State<HrPropertyManagementHub> createState() => _HrPropertyManagementHubState();
}

class _HrPropertyManagementHubState extends State<HrPropertyManagementHub>
    with SingleTickerProviderStateMixin {
  TabController? _controller;
  int? _tabLength;

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final assetsOn =
        context.watch<TimesheetProvider>().enabledModules['asset_compliance'] ?? true;
    final len = assetsOn ? 3 : 2;

    if (_controller == null || _tabLength != len) {
      _controller?.dispose();
      _controller = TabController(length: len, vsync: this);
      _tabLength = len;
    }

    final tabs = <Tab>[
      const Tab(text: 'Properties', icon: Icon(Icons.apartment_outlined, size: 18)),
      const Tab(text: 'Residents', icon: Icon(Icons.group_outlined, size: 18)),
      if (assetsOn)
        const Tab(text: 'Assets', icon: Icon(Icons.precision_manufacturing_outlined, size: 18)),
    ];

    final views = <Widget>[
      const HrPropertiesSection(),
      const HrResidentsSection(),
      if (assetsOn) const HrAssetsSection(),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Material(
          color: Colors.white,
          child: TabBar(
            controller: _controller!,
            isScrollable: true,
            labelColor: AppTheme.gold,
            unselectedLabelColor: const Color(0xFF6B7280),
            indicatorColor: AppTheme.gold,
            labelStyle: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w600),
            tabs: tabs,
          ),
        ),
        Expanded(
          child: TabBarView(
            controller: _controller!,
            children: views,
          ),
        ),
      ],
    );
  }
}
