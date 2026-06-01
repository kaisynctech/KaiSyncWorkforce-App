# Workflows — End-to-End Flows

Each workflow is traced through the real code: ViewModel → `IStorageService` → RPC/PostgREST → table → realtime/telemetry. Legend: **VM** = ViewModel, **RPC** = security-definer function, **PG** = direct PostgREST.

---

## 1. Employee clock in/out (offline-tolerant)

```
EmployeeDashboardViewModel.GoToPunchAsync
  → BranchGeofenceService.GetStatusAsync (if EnforceBranchSignInRadius)   [geofence gate]
  → LocationService.GetCurrentLocationAsync                               [GPS]
  → IStorageService.InsertPunchAsync(TimePunch)
        ├─ code-login → RPC employee_insert_punch(p_company_id, p_employee_id, …)
        │     ├─ blocks if employee_is_on_leave_today OR daily_absences[current_date]
        │     └─ INSERT time_punches
        ├─ HR/JWT → PG From<TimePunch>().Insert (fallback)
        └─ on failure → OfflineQueueService.EnqueuePunchAsync (SecureStorage)
  → RealtimeService.NotifyPunchChanged()            [local echo]
  → TimesheetStateService.SetLastPunch              [optimistic]
  → AppTelemetry.LogEvent("punch_inserted")
```

**Realtime fan-out:** `time_punches` INSERT (filtered by `company_id`) → `PunchChanged` → HR/employee dashboards refresh.

**Offline path:** queued punch persists in `offline_punch_queue`; `Connectivity.ConnectivityChanged` → `ReplayQueueAsync` → reverse-geocode address → `InsertPunchAsync` → telemetry `offline_punch_replay`.

---

## 2. Attendance persistence → session aggregation

```
time_punches rows (in/out pairs, optional job_id, GPS, address)
  → PunchSession.Build(punches, shift template)
        ├─ pairs in/out
        ├─ applies template late/OT/break rules (BreakSlot)
        └─ synthesizes ForAbsentDay / ForLeaveDay rows
  → HrAttendanceViewModel (report) / payroll input
```

`daily_absences` and approved `leave_requests` feed the synthesized rows.

---

## 3. Payroll generation → approval → release

```
HrPaymentsViewModel.GeneratePayrollAsync
  → PayrollGenerationHelper.GenerateAsync
        ├─ load shift templates, punches, leave, absences, salary history
        ├─ PunchSession.Build → PayrollMapper.ToSnapshot (closed sessions)
        ├─ PayrollCalculator.Calculate(PayrollCalculationHelper.BuildInput(...))   [KaiFlow.Payroll]
        │     earnings (basis) → public holidays → overtime → bonus
        │     deductions: unpaid leave, attendance penalties, fixed, manual, statutory (UIF/PAYE)
        │     gross/net + YTD merge
        ├─ PayrollMapper.ApplyResult + StorePolicySnapshot + PayrollAuditHelper
        └─ CreatePaymentApprovalAsync → payment_approvals (status=pending)
  → HrPayslipDetailViewModel.RecalculateAsync (HR overrides: full salary, waive penalties, manual PAYE, bonus)
  → approve → UpdatePaymentStatusAsync("approved")
  → SharePayslipWithEmployeeAsync → shared_with_employee=true
        → DB trigger notify_payslip_released → app_notifications
  → employee: MyPayslipsViewModel.GetMyPayslipsAsync (RPC filters shared rows)
```

Guards: `payroll_period_locks` block recalc on locked periods; a unique index prevents duplicate active payslips per employee/period.

---

## 4. Incident reporting (standalone or job-linked, offline-tolerant)

```
IncidentReportViewModel (standalone: pick client→site, optional job, assignee
                         | job-linked: ?JobId=)
  → online → IStorageService.CreateIncidentAsync(incident, localPhotoPaths)
        ├─ upload photos → workforce-media → photo_urls[]
        └─ RPC employee_insert_incident(… p_job_id?, p_photo_urls)
              └─ if p_job_id: _employee_assigned_to_job gate
  → offline → OfflineQueueService.EnqueueIncidentAsync(PendingIncident)   [photos uploaded at replay]
  → RealtimeService.NotifyIncidentChanged()
HR side:
  HrIncidentsViewModel (list) → HrIncidentDetailsViewModel
     → assign, status transition (open→investigating→resolved/closed)
     → comments (incident_comments), history (incident_status_history)
```

Realtime: `incident_reports` (all events) → `IncidentChanged`.

---

## 5. Contractor onboarding & portal access

```
HR: HrContractorDetailsViewModel.SaveAsync
  → CreateContractorAsync (partner_kind=contractor|both)
  → GenerateNextContractorCodeAsync (EntityCodeHelper.ContractorPrefix)
  → optionally CreateContractorMemberLinkAsync (link employee)
Contractor: IdEntryViewModel.OpenContractorPortalAsync
  → contractor_resolve_by_code(company_code, contractor_code)
  → ContractorPortalSessionStore.Save
  → ContractorPortalViewModel: contractor_portal_list_jobs
  → job detail: contractor_portal_site_sign_in/out (job_site_visits), messages, incidents, photos
```

Onboarding audit: `contractor_admin_events` records admin actions.

---

## 6. Inventory usage / supplier linkage

```
Supplier sourcing:
  HrInventoryDetailViewModel loads suppliers = GetContractorsAsync ∩ PartnerKinds.IsSupplierKind
  → item.supplier (text) + item.supplier_contractor_id (FK → contractors)
Usage allocation against a job:
  HR → AllocateToJobAsync → AllocateInventoryToJobAsync → RPC hr_allocate_inventory_to_job (atomic, row-locked)
  Worker → RPC employee_set_inventory_usage_for_job (quantity_on_hand, FOR UPDATE locking — C1 fixed)
```

---

## 7. Job creation (HR vs employee-created)

```
HR: HrCreateJobViewModel → CreateJobAsync (PG/RPC) → jobs (created_by null; assigned via hr_set_job_assignments)
Employee: EmployeeJobRequestViewModel → EmployeeCreateJobAsync
  → RPC employee_create_job (sets created_by_employee_id = me)
  → NotifyManagerJobCreatedAsync (manager notification)
Visibility:
  MyJobsViewModel.ApplyScope → Assigned (IsAssignedByOthers) | My Jobs (IsCreatedBy) | All (union)
```

---

## 8. Project (CRM) lifecycle

```
HrProjectDetailViewModel (client_deals)
  → quotation lines (project_quotation_lines) → ProjectQuotationBuilder
  → client payments (project_client_payments)
  → documents (project_documents)
  → pipeline stage moves (kanban; MoveProjectRequest)
  → LinkClientDealToJobAsync (deal_id ↔ job)
  → SyncClientDealFinancialsAsync (totals)
Client portal: client_portal_get_project surfaces non-private deals to the client
```

---

## 9. Leave application → approval → payroll/attendance effect

```
MyLeaveViewModel.SubmitAsync → CreateLeaveRequestAsync (RPC/PG) → status=pending (+ attachment)
HR → UpdateLeaveStatusAsync("approved"|"declined", note)
Realtime: leave_requests → LeaveChanged → HR list refresh
Effect:
  Attendance → employee_is_on_leave_today blocks clock-in
  Payroll → LeaveDayCalculator splits paid/unpaid days in PayrollCalculator
```

---

## 10. Messaging flows

```
Direct: EmployeeThreadChatViewModel → employee_get_or_create_direct_thread_peer → send/get thread messages
Company feed: GetOrCreateCompanyFeedAsync / employee_get_company_feed_thread → feed messages
Job thread: GetOrCreateJobThreadAsync (subject "Job:{id}") ← from job card
Client deal: client_portal_send_message → trg notify HR → app_notifications
Refresh: pull-only (no realtime for messages); unread via message_unread_counts_for_threads
```

---

## 11. Realtime update propagation (cross-cutting)

```
TimesheetStateService.StateChanged (company set)
  → RealtimeService.SubscribeAsync(companyId)
        company channels: time_punches(Inserts), leave_requests(All), incident_reports(All)
  → EnsureAccountSubscriptionAsync(auth.uid)
        account channels: employees(user_id)→MembershipChanged, app_notifications(recipient)→AccountNotificationChanged
  → AccountNotificationAlertService → Toast + unread count
```

`RealtimeService` now runs a reconnect supervisor (exponential backoff + jitter, cancellation-token guarded) triggered by subscribe failures and connectivity restoration, with `realtime_reconnect_*` telemetry; events are marshaled to the main thread (see `architecture/04-offline-and-realtime.md`).

---

## 12. App startup & session restore

```
App.xaml.cs.CreateWindow → AppShell (deferred RealtimeService) → IdEntryViewModel.InitializeAsync
  background: supabase.InitializeAsync()
  restore order:
    0 finish client-portal sign-out
    1 SuppressAutoLogin? → stay
    2 JWT session → employee → company picker / //HrDashboard
    3 client portal session → //ClientPortalPage
    4 contractor portal session → ContractorPortalPage
    5 code session → RefreshCodeSessionAsync → dashboard
    6 JWT w/o employee → EmployeeLinkCompanyPage
```

---

_These flows reference the module docs in `modules/` and the infrastructure docs in `architecture/`. For the auth specifics of each entry point, see `security/01-authentication.md`._
