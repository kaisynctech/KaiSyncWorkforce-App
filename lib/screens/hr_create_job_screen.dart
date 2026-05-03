import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/client.dart';
import '../models/contractor.dart';
import '../models/employee.dart';
import '../models/site.dart';
import '../models/job.dart';
import '../models/unit.dart';
import '../models/resident.dart';
import '../models/inventory_item.dart';
import '../models/inventory_usage.dart';
import '../models/work_team.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../theme/responsive.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';
import '../strings/workspace_terms.dart';

class HrCreateJobScreen extends StatefulWidget {
  const HrCreateJobScreen({super.key});

  @override
  State<HrCreateJobScreen> createState() => _HrCreateJobScreenState();
}

class _HrCreateJobScreenState extends State<HrCreateJobScreen> {
  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _clientNameController = TextEditingController();
  final _clientAddressController = TextEditingController();
  final _estimatedCostController = TextEditingController();
  List<Client> _clients = [];
  String? _selectedClientId;
  bool _useNewClient = false;
  bool _loadingClients = false;

  DateTime? _scheduledStart;
  DateTime? _scheduledEnd;
  final Set<String> _assignedEmployeeIds = {};

  /// SLA priority. Defaults to none for non-maintenance jobs.
  JobPriority _priority = JobPriority.none;

  /// Property management — only used when property_management module is on.
  List<Unit> _units = const [];
  List<Resident> _residents = const [];
  String? _selectedUnitId;
  String? _selectedReporterResidentId;

  /// Deals for the currently-selected client. Populated alongside units.
  List<Map<String, dynamic>> _deals = const [];
  String? _selectedDealId;
  List<Contractor> _contractors = const [];
  Map<String, List<String>> _contractorMemberIdsByContractor = const {};
  String? _selectedContractorId;
  String? _selectedContractorMemberEmployeeId;
  List<Map<String, dynamic>> _dispatchSuggestions = const [];

  List<InventoryItem> _inventoryItems = const [];
  List<WorkTeam> _workTeams = const [];
  final List<({String? itemId, TextEditingController qty})> _jobInventoryRows = [];
  int _teamPickerKey = 0;

  bool _saving = false;
  /// One-shot: assign current user once employees are available (or give up if no match).
  bool _autoAssignSelfDone = false;

  String? _resolveMyAssignableEmployeeId(List<Employee> employees) {
    final currentUserId = Supabase.instance.client.auth.currentUser?.id;
    if (currentUserId == null || employees.isEmpty) return null;

    for (final e in employees) {
      if (e.id == currentUserId) return e.id;
    }
    for (final e in employees) {
      if (e.managerUserId == currentUserId && e.accessLevel == EmployeeAccessLevel.hrAdmin) {
        return e.id;
      }
    }
    for (final e in employees) {
      if (e.managerUserId == currentUserId && e.accessLevel == EmployeeAccessLevel.manager) {
        return e.id;
      }
    }
    for (final e in employees) {
      if (e.managerUserId == currentUserId) return e.id;
    }
    return null;
  }

  void _maybeAutoAssignSelf(List<Employee> employees) {
    if (_autoAssignSelfDone || employees.isEmpty) return;
    final myId = _resolveMyAssignableEmployeeId(employees);
    _autoAssignSelfDone = true;
    if (myId == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      setState(() => _assignedEmployeeIds.add(myId));
    });
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadClients();
      _loadContractors();
      _loadInventoryAndTeams();
    });
  }

  Future<void> _loadInventoryAndTeams() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      final items = await SupabaseTimesheetStorage.getInventoryItems(companyId: companyId);
      final teams = await SupabaseTimesheetStorage.getWorkTeams(companyId: companyId);
      if (!mounted) return;
      setState(() {
        _inventoryItems = items;
        _workTeams = teams;
      });
    } catch (_) {}
  }

  void _addJobInventoryRow() {
    setState(() {
      _jobInventoryRows.add((itemId: null, qty: TextEditingController()));
    });
  }

  void _removeJobInventoryRow(int index) {
    setState(() {
      final row = _jobInventoryRows.removeAt(index);
      row.qty.dispose();
    });
  }

  Iterable<Employee> _contractorMemberCandidates(List<Employee> employees) {
    if (_selectedContractorId == null) return const [];
    final linked = _contractorMemberIdsByContractor[_selectedContractorId!] ?? const <String>[];
    if (linked.isNotEmpty) {
      return employees.where((e) => linked.contains(e.id));
    }
    return employees.where(
      (e) =>
          e.workerType == WorkerType.contractor || e.workerType == WorkerType.subcontractor,
    );
  }

  Future<void> _addAssigneesFromTeam(String teamId) async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      final ids = await SupabaseTimesheetStorage.getWorkTeamMemberEmployeeIds(
        teamId: teamId,
        companyId: companyId,
      );
      if (!mounted) return;
      setState(() {
        for (final id in ids) {
          _assignedEmployeeIds.add(id);
        }
      });
      if (mounted) {
        showSuccessSnack(context, 'Added ${ids.length} team member(s) to assignees.');
      }
    } catch (e) {
      if (mounted) {
        showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not load team members.'));
      }
    }
  }

  Future<void> _loadContractors() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      final contractors = await SupabaseTimesheetStorage.getContractors(companyId: companyId);
      final membersByContractor =
          await SupabaseTimesheetStorage.getContractorMemberIdsByContractor(companyId: companyId);
      if (!mounted) return;
      setState(() {
        _contractors = contractors;
        _contractorMemberIdsByContractor = membersByContractor;
      });
    } catch (_) {}
  }

  Future<void> _refreshDispatchSuggestions() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    try {
      final suggestions = await SupabaseTimesheetStorage.getDispatchSuggestions(
        companyId: companyId,
        scheduledStart: _scheduledStart,
        scheduledEnd: _scheduledEnd,
      );
      if (!mounted) return;
      setState(() => _dispatchSuggestions = suggestions);
    } catch (_) {}
  }

  Future<void> _loadClients() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    if (companyId == null) return;
    setState(() => _loadingClients = true);
    try {
      final clients = await SupabaseTimesheetStorage.getClients(companyId: companyId);
      if (!mounted) return;
      setState(() {
        _clients = clients;
        _selectedClientId = clients.isNotEmpty ? clients.first.id : null;
        if (_selectedClientId != null) {
          final selected = clients.firstWhere((c) => c.id == _selectedClientId);
          _clientNameController.text = selected.name;
          _clientAddressController.text = selected.address ?? '';
        }
      });
      // Load units & residents for the initially-selected client.
      if (_selectedClientId != null) {
        await _refreshUnitsForSelectedClient();
      }
      await _refreshDispatchSuggestions();
    } catch (_) {
      if (!mounted) return;
      setState(() => _clients = []);
    } finally {
      if (mounted) setState(() => _loadingClients = false);
    }
  }

  /// Loads the units (and residents-for-those-units) for whichever client
  /// is currently selected. Cleared when no client is selected or the
  /// selected client is not a property type.
  Future<void> _refreshUnitsForSelectedClient() async {
    final companyId = context.read<TimesheetProvider>().currentCompanyId;
    final clientId = _selectedClientId;
    if (companyId == null || clientId == null) {
      setState(() {
        _units = const [];
        _residents = const [];
      });
      return;
    }
    final selected = _clients.firstWhere(
      (c) => c.id == clientId,
      orElse: () => Client(id: '', name: '', clientType: ClientType.company),
    );
    // Always refresh deals for the selected client (works for any client type).
    try {
      final deals = await SupabaseTimesheetStorage.getClientDeals(
        companyId: companyId,
        clientId: clientId,
      );
      if (!mounted) return;
      setState(() {
        _deals = deals;
        // Reset selected deal — let the user pick fresh per client.
        _selectedDealId = null;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _deals = const [];
          _selectedDealId = null;
        });
      }
    }
    if (selected.clientType != ClientType.property) {
      setState(() {
        _units = const [];
        _residents = const [];
        _selectedUnitId = null;
        _selectedReporterResidentId = null;
      });
      return;
    }
    try {
      final units = await SupabaseTimesheetStorage.getUnitsForClient(
        companyId: companyId,
        clientId: clientId,
      );
      // Residents in this client's units only.
      final allResidents = await SupabaseTimesheetStorage.getResidentsForCompany(companyId: companyId);
      final unitIds = units.map((u) => u.id).toSet();
      final scopedResidents = allResidents.where((r) => unitIds.contains(r.unitId)).toList();
      if (!mounted) return;
      setState(() {
        _units = units;
        _residents = scopedResidents;
        // If the previously-selected unit is no longer in scope, clear it.
        if (_selectedUnitId != null && !unitIds.contains(_selectedUnitId)) {
          _selectedUnitId = null;
          _selectedReporterResidentId = null;
        }
      });
    } catch (_) {
      // Non-fatal — leave whatever we had.
    }
  }

  @override
  void dispose() {
    for (final row in _jobInventoryRows) {
      row.qty.dispose();
    }
    _titleController.dispose();
    _descriptionController.dispose();
    _clientNameController.dispose();
    _clientAddressController.dispose();
    _estimatedCostController.dispose();
    super.dispose();
  }

  Future<DateTime?> _pickDateTime(DateTime? initial) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: initial ?? now,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 2),
    );
    if (date == null || !mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial ?? now),
    );
    if (time == null || !mounted) return null;
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    final manualClientName = _clientNameController.text.trim();
    final manualAddress = _clientAddressController.text.trim();

    if (title.isEmpty) {
      showInfoSnack(context, 'Please enter a job title.');
      return;
    }
    if (_useNewClient && manualClientName.isEmpty) {
      showInfoSnack(context, 'Please enter a client name.');
      return;
    }
    if (!_useNewClient && _selectedClientId == null) {
      showInfoSnack(context, 'Please select a client or add a new one.');
      return;
    }
    if (_assignedEmployeeIds.isEmpty) {
      showInfoSnack(context, 'Please assign at least one employee.');
      return;
    }

    setState(() => _saving = true);
    try {
      final companyId = context.read<TimesheetProvider>().currentCompanyId;
      Client? client;
      if (_useNewClient) {
        client = await SupabaseTimesheetStorage.findClientByName(
          manualClientName,
          companyId: companyId,
        );
        client ??= await SupabaseTimesheetStorage.createClientReturning(
          Client(id: '', name: manualClientName, address: manualAddress.isEmpty ? null : manualAddress),
          companyId: companyId,
        );
      } else {
        for (final c in _clients) {
          if (c.id == _selectedClientId) {
            client = c;
            break;
          }
        }
        if (client == null) {
          showInfoSnack(context, 'Selected client could not be resolved.');
          return;
        }
      }
      final effectiveAddress = (_useNewClient ? manualAddress : (client.address ?? manualAddress)).trim();

      // 2) Create a site for the address (optional address).
      Site? site;
      if (effectiveAddress.isNotEmpty) {
        site = await SupabaseTimesheetStorage.createSiteReturning(
          Site(
            id: '',
            clientId: client.id,
            name: client.name,
            address: effectiveAddress,
          ),
          companyId: companyId,
        );
      }

      // 3) Create job — opened_at is stamped by storage on insert.
      final estimatedCost = double.tryParse(_estimatedCostController.text.trim());
      final firstAssignee = _assignedEmployeeIds.isNotEmpty
          ? _assignedEmployeeIds.first
          : null;
      final job = Job(
        id: '',
        title: title,
        description: _descriptionController.text.trim().isEmpty ? null : _descriptionController.text.trim(),
        clientId: client.id,
        siteId: site?.id,
        scheduledStart: _scheduledStart,
        scheduledEnd: _scheduledEnd,
        status: JobStatus.scheduled,
        assignedEmployeeIds: _assignedEmployeeIds.toList(),
        priority: _priority,
        estimatedCost: estimatedCost,
        assigneeEmployeeId: firstAssignee,
        contractorId: _selectedContractorId,
        contractorEmployeeId: _selectedContractorMemberEmployeeId,
        unitId: _selectedUnitId,
        reporterResidentId: _selectedReporterResidentId,
        dealId: _selectedDealId,
      );
      final jobId = await SupabaseTimesheetStorage.createJobReturningId(job, companyId: companyId);
      if (jobId == null) {
        throw StateError('Job insert did not return an id.');
      }

      final inventoryUsages = <InventoryUsage>[];
      for (final row in _jobInventoryRows) {
        final itemId = row.itemId;
        if (itemId == null || itemId.isEmpty) continue;
        final q = double.tryParse(row.qty.text.trim().replaceAll(',', '.'));
        if (q == null || q <= 0) continue;
        inventoryUsages.add(
          InventoryUsage(
            id: '',
            jobId: jobId,
            inventoryItemId: itemId,
            quantity: q,
            employeeId: firstAssignee,
          ),
        );
      }
      if (inventoryUsages.isNotEmpty) {
        await SupabaseTimesheetStorage.setInventoryUsageForJob(
          jobId: jobId,
          companyId: companyId,
          employeeId: firstAssignee,
          usages: inventoryUsages,
        );
      }

      if (!mounted) return;
      showSuccessSnack(context, 'Job created.');
      AppTelemetry.logInfo(screen: 'hr_create_job_screen', action: 'job_created');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      AppTelemetry.logError(screen: 'hr_create_job_screen', action: 'create_job', error: e);
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Failed to create job.'));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final employees = context.watch<TimesheetProvider>().employees;
    _maybeAutoAssignSelf(employees);
    final horizontalPadding = Responsive.horizontalPadding(context);
    final isPhone = Responsive.isPhone(context);

    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        title: Text('Create Job', style: GoogleFonts.poppins(color: const Color(0xFF111827))),
        backgroundColor: Colors.white,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppTheme.gold),
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: Text(
              'Save',
              style: GoogleFonts.poppins(
                color: _saving ? const Color(0xFF9CA3AF) : AppTheme.gold,
                fontWeight: FontWeight.w600,
              ),
            ),
          )
        ],
      ),
      body: SingleChildScrollView(
        padding: EdgeInsets.all(horizontalPadding),
        child: Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: Responsive.contentMaxWidth(context).clamp(0, 980)),
            child: Card(
              color: Colors.white,
              elevation: 4,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: const BorderSide(color: Color(0xFFE5E7EB)),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Job details', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                const SizedBox(height: 10),
                TextField(
                  controller: _titleController,
                  decoration: const InputDecoration(labelText: 'Job title'),
                  enabled: !_saving,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _descriptionController,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Job description'),
                  enabled: !_saving,
                ),
                const SizedBox(height: 18),
                Text(
                  'Priority & cost',
                  style: GoogleFonts.poppins(
                    color: const Color(0xFF111827),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                Flex(
                  direction: isPhone ? Axis.vertical : Axis.horizontal,
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<JobPriority>(
                        initialValue: _priority,
                        items: const [
                          DropdownMenuItem(
                            value: JobPriority.none,
                            child: Text('No priority'),
                          ),
                          DropdownMenuItem(
                            value: JobPriority.critical,
                            child: Text('Critical — 4hr / 24hr'),
                          ),
                          DropdownMenuItem(
                            value: JobPriority.high,
                            child: Text('High — 24hr / 72hr'),
                          ),
                          DropdownMenuItem(
                            value: JobPriority.medium,
                            child: Text('Medium — 48hr / 7 days'),
                          ),
                          DropdownMenuItem(
                            value: JobPriority.low,
                            child: Text('Low — 72hr / 14 days'),
                          ),
                        ],
                        onChanged: _saving
                            ? null
                            : (v) {
                                if (v == null) return;
                                setState(() => _priority = v);
                              },
                        decoration: const InputDecoration(
                          labelText: 'Priority',
                          helperText: 'Drives SLA timer & dashboards',
                        ),
                      ),
                    ),
                    SizedBox(width: isPhone ? 0 : 10, height: isPhone ? 10 : 0),
                    Expanded(
                      child: TextField(
                        controller: _estimatedCostController,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(
                          labelText: 'Estimated cost',
                          helperText: 'Optional. Used for cost-variance tracking.',
                          prefixText: 'R ',
                        ),
                        enabled: !_saving,
                      ),
                    ),
                  ],
                ),
                // Project selector — visible when the client has pipeline rows (`client_deals`).
                Builder(
                  builder: (context) {
                    if (_deals.isEmpty) return const SizedBox.shrink();
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: 18),
                        Text(
                          WorkspaceTerms.project,
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF111827),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 8),
                        DropdownButtonFormField<String?>(
                          initialValue: _selectedDealId,
                          items: [
                            DropdownMenuItem<String?>(
                              value: null,
                              child: Text(WorkspaceTerms.notLinkedProject),
                            ),
                            ..._deals.map((d) {
                              final id = d['id']?.toString() ?? '';
                              final title = d['title']?.toString() ?? WorkspaceTerms.untitledProject;
                              final amount = (d['offer_amount'] as num?)?.toDouble() ?? 0;
                              final amountLabel = amount > 0
                                  ? ' · R ${amount.toStringAsFixed(2)}'
                                  : '';
                              return DropdownMenuItem<String?>(
                                value: id,
                                child: Text('$title$amountLabel', overflow: TextOverflow.ellipsis),
                              );
                            }),
                          ],
                          onChanged: _saving
                              ? null
                              : (v) => setState(() => _selectedDealId = v),
                          decoration: InputDecoration(
                            labelText: WorkspaceTerms.linkedProject,
                            helperText:
                                'Costs and payments can roll up to this ${WorkspaceTerms.project.toLowerCase()}.',
                          ),
                        ),
                      ],
                    );
                  },
                ),
                // Unit cascading — only when the selected client is a
                // property-type client. No module flag check; the data
                // model alone decides whether units are relevant.
                Builder(
                  builder: (context) {
                    final selectedClient = _selectedClientId == null
                        ? null
                        : _clients.firstWhere(
                            (c) => c.id == _selectedClientId,
                            orElse: () => Client(id: '', name: '', clientType: ClientType.company),
                          );
                    if (selectedClient == null ||
                        selectedClient.clientType != ClientType.property) {
                      return const SizedBox.shrink();
                    }
                    final residentsForUnit = _selectedUnitId == null
                        ? const <Resident>[]
                        : _residents.where((r) => r.unitId == _selectedUnitId).toList();
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: 18),
                        Text(
                          'Unit & resident',
                          style: GoogleFonts.poppins(
                            color: const Color(0xFF111827),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 8),
                        if (_units.isEmpty)
                          Text(
                            'No units yet for ${selectedClient.name}. Open the client and add a unit to link this job.',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF6B7280),
                              fontSize: 11,
                            ),
                          )
                        else ...[
                          DropdownButtonFormField<String?>(
                            initialValue: _selectedUnitId,
                            items: [
                              const DropdownMenuItem<String?>(
                                value: null,
                                child: Text('— No specific unit —'),
                              ),
                              ..._units.map((u) => DropdownMenuItem<String?>(
                                    value: u.id,
                                    child: Text('Unit ${u.unitNumber}', overflow: TextOverflow.ellipsis),
                                  )),
                            ],
                            onChanged: _saving
                                ? null
                                : (v) {
                                    setState(() {
                                      _selectedUnitId = v;
                                      _selectedReporterResidentId = null;
                                    });
                                  },
                            decoration: const InputDecoration(
                              labelText: 'Unit',
                              helperText: 'Drives per-unit reporting & repeat-issue detection.',
                            ),
                          ),
                          const SizedBox(height: 12),
                          DropdownButtonFormField<String?>(
                            initialValue: _selectedReporterResidentId,
                            items: [
                              const DropdownMenuItem<String?>(
                                value: null,
                                child: Text('— No resident reporter —'),
                              ),
                              ...residentsForUnit.map((r) => DropdownMenuItem<String?>(
                                    value: r.id,
                                    child: Text(r.fullName, overflow: TextOverflow.ellipsis),
                                  )),
                            ],
                            onChanged: _saving || _selectedUnitId == null
                                ? null
                                : (v) => setState(() => _selectedReporterResidentId = v),
                            decoration: InputDecoration(
                              labelText: 'Reporter (resident)',
                              helperText: _selectedUnitId == null
                                  ? 'Pick a unit first to see its residents.'
                                  : 'Used for the post-closure feedback flow.',
                            ),
                          ),
                        ],
                      ],
                    );
                  },
                ),
                const SizedBox(height: 18),
                Text('Client', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                const SizedBox(height: 10),
                if (_loadingClients)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: LinearProgressIndicator(color: AppTheme.gold),
                  ),
                SwitchListTile(
                  value: _useNewClient,
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Add new client'),
                  onChanged: _saving
                      ? null
                      : (v) {
                          setState(() {
                            _useNewClient = v;
                            if (!v && _selectedClientId != null) {
                              final selected = _clients.firstWhere((c) => c.id == _selectedClientId);
                              _clientNameController.text = selected.name;
                              _clientAddressController.text = selected.address ?? '';
                            }
                          });
                        },
                ),
                if (_useNewClient)
                  TextField(
                    controller: _clientNameController,
                    decoration: const InputDecoration(labelText: 'Client name'),
                    enabled: !_saving,
                  )
                else
                  DropdownButtonFormField<String>(
                    initialValue: _selectedClientId,
                    items: _clients
                        .map((c) => DropdownMenuItem<String>(
                              value: c.id,
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    c.clientType == ClientType.property
                                        ? Icons.apartment_outlined
                                        : c.clientType == ClientType.individual
                                            ? Icons.person_outline
                                            : Icons.business_outlined,
                                    size: 14,
                                    color: const Color(0xFF6B7280),
                                  ),
                                  const SizedBox(width: 6),
                                  Flexible(
                                    child: Text(c.name, overflow: TextOverflow.ellipsis),
                                  ),
                                ],
                              ),
                            ))
                        .toList(),
                    onChanged: _saving
                        ? null
                        : (v) async {
                            if (v == null) return;
                            final selected = _clients.firstWhere((c) => c.id == v);
                            setState(() {
                              _selectedClientId = v;
                              _clientNameController.text = selected.name;
                              _clientAddressController.text = selected.address ?? '';
                              // Reset unit/reporter selection when client switches.
                              _selectedUnitId = null;
                              _selectedReporterResidentId = null;
                            });
                            // Refresh the unit list scoped to the newly-selected client.
                            await _refreshUnitsForSelectedClient();
                          },
                    decoration: const InputDecoration(labelText: 'Select existing client'),
                  ),
                const SizedBox(height: 12),
                TextField(
                  controller: _clientAddressController,
                  decoration: InputDecoration(
                    labelText: _useNewClient ? 'Client address' : 'Client address (optional override)',
                  ),
                  enabled: !_saving,
                ),
                const SizedBox(height: 18),
                Text('Schedule', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                const SizedBox(height: 10),
                Flex(
                  direction: isPhone ? Axis.vertical : Axis.horizontal,
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _saving
                            ? null
                            : () async {
                                final dt = await _pickDateTime(_scheduledStart);
                                if (dt != null) {
                                  setState(() => _scheduledStart = dt);
                                  await _refreshDispatchSuggestions();
                                }
                              },
                        icon: const Icon(Icons.schedule, size: 18),
                        label: Text(
                          _scheduledStart == null ? 'Start' : _scheduledStart!.toString(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.poppins(fontSize: 12),
                        ),
                      ),
                    ),
                    SizedBox(width: isPhone ? 0 : 10, height: isPhone ? 10 : 0),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _saving
                            ? null
                            : () async {
                                final dt = await _pickDateTime(_scheduledEnd);
                                if (dt != null) {
                                  setState(() => _scheduledEnd = dt);
                                  await _refreshDispatchSuggestions();
                                }
                              },
                        icon: const Icon(Icons.schedule_send, size: 18),
                        label: Text(
                          _scheduledEnd == null ? 'End' : _scheduledEnd!.toString(),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: GoogleFonts.poppins(fontSize: 12),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Text('Assign employees', style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                if (_contractors.isNotEmpty) ...[
                  DropdownButtonFormField<String?>(
                    value: _selectedContractorId,
                    decoration: const InputDecoration(labelText: 'Contractor entity (optional)'),
                    items: [
                      const DropdownMenuItem<String?>(value: null, child: Text('No contractor entity')),
                      ..._contractors.map(
                        (c) => DropdownMenuItem<String?>(
                          value: c.id,
                          child: Text('${c.displayName} (${c.contractorType})'),
                        ),
                      ),
                    ],
                    onChanged: _saving
                        ? null
                        : (v) {
                            setState(() {
                              _selectedContractorId = v;
                              _selectedContractorMemberEmployeeId = null;
                            });
                          },
                  ),
                  const SizedBox(height: 10),
                ],
                if (_selectedContractorId != null) ...[
                  DropdownButtonFormField<String?>(
                    value: _selectedContractorMemberEmployeeId,
                    decoration: InputDecoration(
                      labelText: 'Contractor member (optional)',
                      helperText: (_contractorMemberIdsByContractor[_selectedContractorId!] ?? const <String>[]).isEmpty
                          ? 'No linked members in Contractors — showing contractor-type workers.'
                          : 'Linked under HR → Contractors.',
                    ),
                    items: [
                      const DropdownMenuItem<String?>(value: null, child: Text('No specific member')),
                      ..._contractorMemberCandidates(employees).map(
                        (e) => DropdownMenuItem<String?>(
                          value: e.id,
                          child: Text(e.fullName),
                        ),
                      ),
                    ],
                    onChanged: _saving ? null : (v) => setState(() => _selectedContractorMemberEmployeeId = v),
                  ),
                  const SizedBox(height: 12),
                ],
                if (_workTeams.isNotEmpty) ...[
                  DropdownButtonFormField<String?>(
                    key: ValueKey(_teamPickerKey),
                    value: null,
                    hint: const Text('Quick-add a whole team'),
                    items: [
                      ..._workTeams.map(
                        (t) => DropdownMenuItem<String?>(
                          value: t.id,
                          child: Text(t.name, overflow: TextOverflow.ellipsis),
                        ),
                      ),
                    ],
                    onChanged: _saving
                        ? null
                        : (teamId) async {
                            if (teamId == null) return;
                            await _addAssigneesFromTeam(teamId);
                            if (mounted) setState(() => _teamPickerKey++);
                          },
                    decoration: const InputDecoration(
                      labelText: 'Team quick-assign',
                      helperText: 'Adds every member of the team to assignees.',
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _saving
                          ? null
                          : () {
                              final myId = _resolveMyAssignableEmployeeId(employees);
                              if (myId == null) {
                                showInfoSnack(context, 'Could not find your employee profile to assign.');
                                return;
                              }
                              setState(() => _assignedEmployeeIds.add(myId));
                              showSuccessSnack(context, 'Assigned to you.');
                            },
                      icon: const Icon(Icons.person_add_alt_1, size: 16),
                      label: const Text('Assign myself'),
                    ),
                    OutlinedButton.icon(
                      onPressed: _saving ? null : () => setState(_assignedEmployeeIds.clear),
                      icon: const Icon(Icons.clear_all, size: 16),
                      label: const Text('Clear selection'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (_dispatchSuggestions.isNotEmpty) ...[
                  Card(
                    color: const Color(0xFFF8FAFC),
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                      side: const BorderSide(color: Color(0xFFE2E8F0)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Suggested assignees',
                            style: GoogleFonts.poppins(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: const Color(0xFF0F172A),
                            ),
                          ),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: _dispatchSuggestions.map((s) {
                              final id = (s['employee_id'] ?? '').toString();
                              final name = (s['full_name'] ?? 'Unknown').toString();
                              final score = (s['score'] as num?)?.toInt() ?? 0;
                              final load = (s['active_jobs'] as num?)?.toInt() ?? 0;
                              final conflicts = (s['schedule_conflicts'] as num?)?.toInt() ?? 0;
                              return ActionChip(
                                label: Text(
                                  '$name • score $score',
                                  style: GoogleFonts.poppins(fontSize: 11),
                                ),
                                tooltip: 'Active jobs: $load • Conflicts: $conflicts',
                                onPressed: _saving || id.isEmpty
                                    ? null
                                    : () => setState(() => _assignedEmployeeIds.add(id)),
                              );
                            }).toList(),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
                if (employees.isEmpty)
                  Text('No employees loaded.', style: GoogleFonts.poppins(color: const Color(0xFF6B7280)))
                else
                  ...employees.map((e) {
                    final selected = _assignedEmployeeIds.contains(e.id);
                    return CheckboxListTile(
                      value: selected,
                      onChanged: _saving
                          ? null
                          : (v) {
                              setState(() {
                                if (v == true) {
                                  _assignedEmployeeIds.add(e.id);
                                } else {
                                  _assignedEmployeeIds.remove(e.id);
                                }
                              });
                            },
                      title: Text(e.fullName, style: GoogleFonts.poppins(color: const Color(0xFF111827), fontSize: 13, fontWeight: FontWeight.w500)),
                      subtitle: Text(
                        'ID: ${e.employeeCode.isNotEmpty ? e.employeeCode : e.id}',
                        style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                      ),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                    );
                  }),
                const SizedBox(height: 18),
                Text(
                  'Job inventory (optional)',
                  style: GoogleFonts.poppins(color: const Color(0xFF111827), fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                Text(
                  'Materials consumed on this job. Stock is adjusted when the job is saved.',
                  style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                ),
                const SizedBox(height: 8),
                if (_inventoryItems.isEmpty)
                  Text(
                    'No inventory items yet — add them under HR → Inventory.',
                    style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 12),
                  )
                else ...[
                  for (var i = 0; i < _jobInventoryRows.length; i++)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            flex: 3,
                            child: DropdownButtonFormField<String?>(
                              value: _jobInventoryRows[i].itemId,
                              items: [
                                const DropdownMenuItem<String?>(value: null, child: Text('Select item')),
                                ..._inventoryItems.map(
                                  (it) => DropdownMenuItem<String?>(
                                    value: it.id,
                                    child: Text(it.name, overflow: TextOverflow.ellipsis),
                                  ),
                                ),
                              ],
                              onChanged: _saving
                                  ? null
                                  : (v) => setState(() {
                                        _jobInventoryRows[i] = (
                                          itemId: v,
                                          qty: _jobInventoryRows[i].qty,
                                        );
                                      }),
                              decoration: const InputDecoration(labelText: 'Item', isDense: true),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            flex: 2,
                            child: TextField(
                              controller: _jobInventoryRows[i].qty,
                              enabled: !_saving,
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: const InputDecoration(
                                labelText: 'Qty',
                                isDense: true,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: _saving ? null : () => _removeJobInventoryRow(i),
                            icon: const Icon(Icons.close, size: 20),
                            tooltip: 'Remove line',
                          ),
                        ],
                      ),
                    ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: _saving ? null : _addJobInventoryRow,
                      icon: const Icon(Icons.add_circle_outline, size: 18),
                      label: const Text('Add inventory line'),
                    ),
                  ),
                ],
                const SizedBox(height: 6),
                Text(
                  'Client ID is auto-generated by the system.',
                  style: GoogleFonts.poppins(color: const Color(0xFF6B7280), fontSize: 11),
                ),
              ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

