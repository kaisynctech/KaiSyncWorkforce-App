import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/workflow_form_submission.dart';
import '../models/workflow_form_template.dart';
import '../providers/timesheet_provider.dart';
import '../services/app_telemetry.dart';
import '../services/export_service.dart';
import '../services/supabase_timesheet_storage.dart';
import '../theme/app_theme.dart';
import '../widgets/app_feedback.dart';
import '../widgets/load_error_panel.dart';

class PaperlessOpsScreen extends StatefulWidget {
  const PaperlessOpsScreen({super.key});

  @override
  State<PaperlessOpsScreen> createState() => _PaperlessOpsScreenState();
}

class _PaperlessOpsScreenState extends State<PaperlessOpsScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 4, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<String?> _companyId() async {
    final id = context.read<TimesheetProvider>().currentCompanyId;
    return id;
  }

  Future<void> _addTemplate() async {
    final companyId = await _companyId();
    if (companyId == null || !mounted) return;
    final nameCtrl = TextEditingController();
    final typeCtrl = TextEditingController(text: 'overtime_request');
    final schemaCtrl = TextEditingController(text: '{"fields":[{"key":"reason","type":"text"}]}');
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New form template'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Template name')),
              const SizedBox(height: 8),
              TextField(controller: typeCtrl, decoration: const InputDecoration(labelText: 'Form type')),
              const SizedBox(height: 8),
              TextField(controller: schemaCtrl, minLines: 3, maxLines: 6, decoration: const InputDecoration(labelText: 'Schema JSON')),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(context, true), child: const Text('Save')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final schema = jsonDecode(schemaCtrl.text.trim()) as Map<String, dynamic>;
      await SupabaseTimesheetStorage.upsertFormTemplate(
        WorkflowFormTemplate(
          id: '',
          companyId: companyId,
          name: nameCtrl.text.trim(),
          formType: typeCtrl.text.trim(),
          schemaJson: schema,
          requiresEmployeeSignature: true,
          requiresSupervisorSignature: true,
        ),
        companyId: companyId,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Template saved.');
      setState(() {});
    } catch (e) {
      AppTelemetry.logError(screen: 'paperless_ops_screen', action: 'add_template', error: e);
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not save template.'));
    }
  }

  Future<void> _createSubmission(WorkflowFormTemplate t) async {
    final companyId = await _companyId();
    if (companyId == null || !mounted) return;
    final payloadCtrl = TextEditingController(text: '{"notes":"Submitted from HR paperless ops."}');
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Submit: ${t.name}'),
        content: TextField(
          controller: payloadCtrl,
          maxLines: 8,
          decoration: const InputDecoration(labelText: 'Payload JSON'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(context, true), child: const Text('Submit')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final payload = jsonDecode(payloadCtrl.text.trim()) as Map<String, dynamic>;
      await SupabaseTimesheetStorage.upsertFormSubmission(
        WorkflowFormSubmission(
          id: '',
          templateId: t.id,
          companyId: companyId,
          status: 'submitted',
          payloadJson: payload,
          createdAt: DateTime.now(),
        ),
        companyId: companyId,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Submission created.');
      setState(() {});
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not create submission.'));
    }
  }

  Future<void> _approveSubmission(WorkflowFormSubmission s, String status) async {
    final companyId = await _companyId();
    if (companyId == null || !mounted) return;
    try {
      await SupabaseTimesheetStorage.setFormSubmissionStatus(
        companyId: companyId,
        submissionId: s.id,
        status: status,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Submission marked $status.');
      setState(() {});
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not update submission.'));
    }
  }

  Future<void> _exportSignedPdf(WorkflowFormSubmission s) async {
    try {
      await ExportService.exportTable(
        fileBaseName: 'signed_form_${s.id}',
        headers: const ['Field', 'Value'],
        rows: [
          ['Submission ID', s.id],
          ['Template ID', s.templateId],
          ['Status', s.status],
          ['Created', DateFormat('yyyy-MM-dd HH:mm').format(s.createdAt)],
          ['Payload', jsonEncode(s.payloadJson)],
          ['Employee signature', s.employeeSignatureUrl ?? '—'],
          ['Supervisor signature', s.supervisorSignatureUrl ?? '—'],
          ['Client signature', s.clientSignatureUrl ?? '—'],
        ],
        format: ExportFormat.pdf,
      );
      if (!mounted) return;
      showSuccessSnack(context, 'Signed PDF exported.');
    } catch (e) {
      if (!mounted) return;
      showErrorSnack(context, friendlyErrorMessage(e, fallback: 'Could not export signed PDF.'));
    }
  }

  Future<void> _addSimpleRecord({
    required String title,
    required Future<void> Function(String name, String type) save,
    String defaultType = 'general',
  }) async {
    final nameCtrl = TextEditingController();
    final typeCtrl = TextEditingController(text: defaultType);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name')),
            const SizedBox(height: 8),
            TextField(controller: typeCtrl, decoration: const InputDecoration(labelText: 'Type / Category')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(context, true), child: const Text('Save')),
        ],
      ),
    );
    if (ok != true) return;
    await save(nameCtrl.text.trim(), typeCtrl.text.trim());
    if (!mounted) return;
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF3F5FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        title: Text('Paperless Ops', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabs: const [
            Tab(text: 'Forms & Approvals'),
            Tab(text: 'Documents'),
            Tab(text: 'Compliance & Handover'),
            Tab(text: 'Automation & Integrations'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          _buildFormsApprovals(),
          _buildDocuments(),
          _buildComplianceHandover(),
          _buildAutomationIntegrations(),
        ],
      ),
    );
  }

  Widget _buildFormsApprovals() {
    return FutureBuilder<List<dynamic>>(
      future: Future.wait([
        _companyId().then((id) => id == null ? <WorkflowFormTemplate>[] : SupabaseTimesheetStorage.getFormTemplates(companyId: id)),
        _companyId().then((id) => id == null ? <WorkflowFormSubmission>[] : SupabaseTimesheetStorage.getFormSubmissions(companyId: id)),
      ]),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load forms and approvals.'),
            onRetry: () => setState(() {}),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
        }
        final templates = snapshot.data![0] as List<WorkflowFormTemplate>;
        final submissions = snapshot.data![1] as List<WorkflowFormSubmission>;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Text('Templates', style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700)),
                const Spacer(),
                ElevatedButton.icon(
                  onPressed: _addTemplate,
                  icon: const Icon(Icons.add),
                  label: const Text('New template'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ...templates.map((t) => Card(
                  child: ListTile(
                    title: Text(t.name),
                    subtitle: Text('Type: ${t.formType}'),
                    trailing: TextButton(
                      onPressed: () => _createSubmission(t),
                      child: const Text('Submit form'),
                    ),
                  ),
                )),
            const SizedBox(height: 16),
            Text('Approval queue', style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            ...submissions.map((s) => Card(
                  child: ListTile(
                    title: Text('Submission #${s.id}'),
                    subtitle: Text('Status: ${s.status}'),
                    trailing: Wrap(
                      spacing: 4,
                      children: [
                        IconButton(
                          tooltip: 'Approve',
                          onPressed: () => _approveSubmission(s, 'approved'),
                          icon: const Icon(Icons.check_circle_outline, color: Color(0xFF059669)),
                        ),
                        IconButton(
                          tooltip: 'Reject',
                          onPressed: () => _approveSubmission(s, 'rejected'),
                          icon: const Icon(Icons.cancel_outlined, color: Color(0xFFB91C1C)),
                        ),
                        IconButton(
                          tooltip: 'Export signed PDF',
                          onPressed: () => _exportSignedPdf(s),
                          icon: const Icon(Icons.picture_as_pdf_outlined, color: AppTheme.gold),
                        ),
                      ],
                    ),
                  ),
                )),
          ],
        );
      },
    );
  }

  Widget _buildDocuments() {
    return FutureBuilder<List<Map<String, dynamic>>>(
      future: _companyId().then((id) => id == null ? <Map<String, dynamic>>[] : SupabaseTimesheetStorage.getDocumentFiles(companyId: id)),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load document vault.'),
            onRetry: () => setState(() {}),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
        }
        final docs = snapshot.data ?? const <Map<String, dynamic>>[];
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Text('Document Vault', style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700)),
                const Spacer(),
                ElevatedButton.icon(
                  onPressed: () async {
                    final companyId = await _companyId();
                    if (companyId == null) return;
                    await _addSimpleRecord(
                      title: 'New document metadata',
                      defaultType: 'contract',
                      save: (name, type) => SupabaseTimesheetStorage.upsertDocumentFile(
                        companyId: companyId,
                        category: type,
                        title: name,
                        fileUrl: 'https://example.com/document/$name',
                        tags: [type, 'paperless'],
                      ),
                    );
                  },
                  icon: const Icon(Icons.add),
                  label: const Text('Add metadata'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ...docs.map((d) => Card(
                  child: ListTile(
                    title: Text(d['title']?.toString() ?? 'Document'),
                    subtitle: Text('Category: ${d['category'] ?? '—'} | Version: ${d['version_no'] ?? 1}'),
                  ),
                )),
          ],
        );
      },
    );
  }

  Widget _buildComplianceHandover() {
    return FutureBuilder<List<dynamic>>(
      future: Future.wait([
        _companyId().then((id) => id == null ? <Map<String, dynamic>>[] : SupabaseTimesheetStorage.getEmployeeComplianceRecords(companyId: id)),
        _companyId().then((id) => id == null ? <Map<String, dynamic>>[] : SupabaseTimesheetStorage.getHandoverPacks(companyId: id)),
      ]),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load compliance and handover data.'),
            onRetry: () => setState(() {}),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
        }
        final compliance = snapshot.data![0] as List<Map<String, dynamic>>;
        final handovers = snapshot.data![1] as List<Map<String, dynamic>>;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Text('Compliance', style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700)),
                const Spacer(),
                ElevatedButton.icon(
                  onPressed: () async {
                    final pageContext = this.context;
                    final companyId = await _companyId();
                    if (companyId == null || !pageContext.mounted) return;
                    final employees = pageContext.read<TimesheetProvider>().employees;
                    if (employees.isEmpty) {
                      showInfoSnack(pageContext, 'Add employees first to create compliance records.');
                      return;
                    }
                    await SupabaseTimesheetStorage.upsertEmployeeComplianceRecord(
                      companyId: companyId,
                      employeeId: employees.first.id,
                      requirementId: '1',
                      status: 'expiring',
                      expiresOn: DateTime.now().add(const Duration(days: 30)),
                    );
                    if (!mounted) return;
                    setState(() {});
                  },
                  icon: const Icon(Icons.warning_amber_outlined),
                  label: const Text('Add sample record'),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ...compliance.map((c) => Card(
                  child: ListTile(
                    title: Text('Employee ${c['employee_id']} • ${c['status']}'),
                    subtitle: Text('Expires: ${c['expires_on'] ?? '—'}'),
                  ),
                )),
            const SizedBox(height: 16),
            Row(
              children: [
                Text('Client handover packs', style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 8),
            ...handovers.map((h) => Card(
                  child: ListTile(
                    title: Text('Job ${h['job_id']}'),
                    subtitle: Text('Shared: ${h['shared_at'] ?? 'No'}'),
                  ),
                )),
          ],
        );
      },
    );
  }

  Widget _buildAutomationIntegrations() {
    return FutureBuilder<List<dynamic>>(
      future: Future.wait([
        _companyId().then((id) => id == null ? <Map<String, dynamic>>[] : SupabaseTimesheetStorage.getAutomationRules(companyId: id)),
        _companyId().then((id) => id == null ? <Map<String, dynamic>>[] : SupabaseTimesheetStorage.getScheduledExports(companyId: id)),
        _companyId().then((id) => id == null ? <Map<String, dynamic>>[] : SupabaseTimesheetStorage.getIntegrationEndpoints(companyId: id)),
      ]),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return LoadErrorPanel(
            message: friendlyErrorMessage(snapshot.error, fallback: 'Could not load automations/integrations.'),
            onRetry: () => setState(() {}),
          );
        }
        if (snapshot.connectionState == ConnectionState.waiting && !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator(color: AppTheme.gold));
        }
        final rules = snapshot.data![0] as List<Map<String, dynamic>>;
        final exports = snapshot.data![1] as List<Map<String, dynamic>>;
        final endpoints = snapshot.data![2] as List<Map<String, dynamic>>;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Text('Automation rules', style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700)),
                const Spacer(),
                ElevatedButton.icon(
                  onPressed: () async {
                    final companyId = await _companyId();
                    if (companyId == null) return;
                    await SupabaseTimesheetStorage.upsertAutomationRule(
                      companyId: companyId,
                      name: 'High incident escalation',
                      triggerType: 'incident_created',
                      triggerConfig: {'severity': 'high'},
                      actionType: 'notify_role',
                      actionConfig: {'role': 'owner'},
                    );
                    if (!mounted) return;
                    setState(() {});
                  },
                  icon: const Icon(Icons.add_alert_outlined),
                  label: const Text('Add rule'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ...rules.map((r) => Card(
                  child: ListTile(
                    title: Text(r['name']?.toString() ?? 'Rule'),
                    subtitle: Text('${r['trigger_type']} -> ${r['action_type']}'),
                  ),
                )),
            const SizedBox(height: 16),
            Row(
              children: [
                Text('Scheduled exports', style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700)),
                const Spacer(),
                ElevatedButton.icon(
                  onPressed: () async {
                    final companyId = await _companyId();
                    if (companyId == null) return;
                    await SupabaseTimesheetStorage.upsertScheduledExport(
                      companyId: companyId,
                      exportType: 'payroll_pack',
                      format: 'csv',
                      cronExpr: '0 8 * * 1',
                      destinationEmail: 'payroll@example.com',
                    );
                    if (!mounted) return;
                    setState(() {});
                  },
                  icon: const Icon(Icons.schedule_send_outlined),
                  label: const Text('Schedule export'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ...exports.map((e) => Card(
                  child: ListTile(
                    title: Text('${e['export_type']} (${e['format']})'),
                    subtitle: Text('Cron: ${e['cron_expr']}'),
                  ),
                )),
            const SizedBox(height: 16),
            Row(
              children: [
                Text('Integration endpoints', style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700)),
                const Spacer(),
                ElevatedButton.icon(
                  onPressed: () async {
                    final companyId = await _companyId();
                    if (companyId == null) return;
                    await SupabaseTimesheetStorage.upsertIntegrationEndpoint(
                      companyId: companyId,
                      provider: 'payroll_api',
                      configJson: {
                        'base_url': 'https://api.example.com/payroll',
                        'mode': 'import_ready',
                      },
                    );
                    if (!mounted) return;
                    setState(() {});
                  },
                  icon: const Icon(Icons.add_link_outlined),
                  label: const Text('Add endpoint'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ...endpoints.map((e) => Card(
                  child: ListTile(
                    title: Text(e['provider']?.toString() ?? 'Endpoint'),
                    subtitle: Text((e['config_json'] ?? const {}).toString()),
                  ),
                )),
          ],
        );
      },
    );
  }
}
