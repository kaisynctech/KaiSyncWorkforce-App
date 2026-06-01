# 03 — Enterprise Navigation & Module Hierarchy

KaiFlow has **four navigation surfaces**, one per audience. All share the same Shell + route registry but present entirely different structures.

## Shell & routing

- `AppShell` (`AppShell.xaml` / `AppShell.xaml.cs`) is the MAUI `Shell` root. It registers every push-navigation route via `Routing.RegisterRoute(nameof(XPage), typeof(XPage))` (auth, employee drill-downs, HR drill-downs, contractor portal).
- Navigation is centralized in `Services/ShellNavigation.cs` (`GoToAsync`, `GoBackOrDashboardAsync`, `GoToMainDashboardAsync`) and `Services/AppRoutes.cs`.
- `NavigationChrome` attaches a consistent back-bar/chrome to pages whose binding context is a `BaseViewModel` (wired in the `AppShell.Navigated` handler).
- Audience routing after login is handled by `EmployeeAccountRouting`, `ClientPortalNavigation`, and the auth ViewModels.

## 1 — HR / Management navigation (sidebar shell)

The management experience is a **single dashboard page** (`Views/Hr/HrDashboardPage.xaml`, `HrDashboardViewModel`) with a **left sidebar** of module entries and a content area that swaps panels based on an integer `ActiveTab`. `Shell.NavBarIsVisible="False"` — the sidebar *is* the navigation.

### Tab index map

`HrDashboardViewModel` defines the canonical tab indices:

```
 0  Overview            10 Properties           20 Leave        (own tab)
 1  My Profile          11 Incidents            21 Suppliers    (own tab)
 2  Employees           12 Reports              22 My PA        (embedded module tab)
 3  Attendance          13 Scheduling
 4  Jobs                14 Work Teams
 5  Payroll             15 Notifications
 6  Contractors         16 Activity Log
 7  Clients             17 Messages
 8  Inventory           18 Settings
 9  Assets              19 Projects
```

Tabs 20–22 were added so that **Leave**, **Suppliers**, and **My PA** are first-class sidebar modules (rather than sub-tabs or link-outs). Selecting a tab runs `OnActiveTabChanged`, which:
1. raises the `IsXTab` notifications,
2. checks `IsTabAllowed(value)` (module + permission gate; falls back to Overview if not allowed),
3. lazy-loads that tab's data (`LoadTabDataAsync`, or specialized activation for Jobs/Projects/My PA).

### Sidebar grouping & module gating

The sidebar is grouped into sections, each shown only if it has at least one visible item:

| Section | Items (visibility flag) |
|---------|--------------------------|
| **(top)** | Overview, My Profile, Messages |
| **People & Work** | Employees (`ShowEmployeesNav`), Leave (`ShowLeaveNav`), Attendance (`ShowAttendanceNav`), Jobs (`ShowJobsNav`), Projects (`ShowProjectsNav`) |
| **Operations** | Payroll (`ShowPayrollNav`), Contractors (`ShowContractorsNav`), Clients (`ShowClientsNav`), Inventory (`ShowInventoryNav`), **Suppliers (`ShowSuppliersNav`)**, Assets (`ShowAssetsNav`), Properties (`ShowPropertiesNav`) |
| **Analytics** | Incidents (`ShowIncidentsNav`), Reports (`ShowReportsNav`), Scheduling (`ShowSchedulingNav`), My PA (`ShowMyPaNav`), Work Teams (`ShowWorkTeamsNav`) |
| **Comms** | (Notifications / Activity Log / Messages depending on role) |
| **Admin** | Settings (`ShowSettingsNav`, owner/admin + `settings.view`) |

Each `ShowXNav` flag combines a **company module toggle** with a **permission check**, computed in `RefreshModuleNavigation()`:

```571:587:KaiFlow.Timesheets.Maui/ViewModels/Hr/HrDashboardViewModel.cs
        ShowLeaveNav = CompanyModules.IsEnabled(company, CompanyModules.Leave) && CanSeeLeaveAdmin;
        ShowAttendanceNav = CompanyModules.IsEnabled(company, CompanyModules.Attendance)
            ...
        ShowInventoryNav = CompanyModules.IsEnabled(company, CompanyModules.Inventory)
            && _permissions.Can(PermissionKeys.InventoryView);
        ShowSuppliersNav = CompanyModules.IsEnabled(company, CompanyModules.Suppliers)
            && (_permissions.Can(PermissionKeys.SuppliersView) || _permissions.Can(PermissionKeys.InventoryView));
        ShowAssetsNav = CompanyModules.IsEnabled(company, CompanyModules.AssetCompliance);
        ShowPropertiesNav = CompanyModules.IsEnabled(company, CompanyModules.PropertyManagement);
        ShowIncidentsNav = CompanyModules.IsIncidentsEnabled(company);
```

### Notable structural decisions

- **Leave** is its own sidebar tab (index 20) with its own approvals list — previously it was a sub-tab inside Employees. The Employees panel sub-tabs are now just Employees / Teams / Time Templates.
- **Suppliers** is its own sidebar tab (index 21). It is *also* reachable from the Inventory toolbar (interoperability shortcut) but is **not** buried inside Inventory. Supplier rows are `Contractor`s discriminated by `PartnerKinds`.
- **My PA** renders as an **embedded module tab** (index 22) by hosting the shared `Views/Shared/MyPaSectionView` bound to the injected `MyPaSectionViewModel` in HR mode — not a separate page navigation.
- **Drill-downs** (full management screens) are separate pages reached from the dashboard panels: `HrJobsPage`, `HrJobDetailsPage`, `HrCreateJobPage`, `HrProjectsPage`, `HrProjectDetailPage`, `HrContractorsPage`, `HrSuppliersPage`, `HrInventoryPage`, `HrAttendancePage`, `HrPaymentsPage`, `HrReportsPage`, `HrSettingsPage`, `HrPropertiesPage`, `HrResidentsPage`, `HrAssetsPage`, `HrSchedulingPage`, `HrWorkTeamsPage`, `HrNotificationsPage`, `HrActivityLogPage`, etc.

## 2 — Employee navigation (mobile-first)

The employee experience (`Views/Employee/EmployeeDashboardPage.xaml`, `EmployeeDashboardViewModel`) is a **bottom tab bar** + a **More** menu, designed for field use — *not* a copy of the HR sidebar.

### Bottom tab bar (5 slots)

| Slot | Destination | Visibility |
|------|-------------|------------|
| Home | Dashboard home tab | always |
| My Jobs | `MyJobsPage` | `ShowJobsModule` |
| Messages | `EmployeeThreadChatPage` | `ShowMessagingModule` |
| Notifs | `EmployeeNotificationsPage` | always |
| More | More tab | always |

### Home tab

Clock card (`ShowClockCard` = attendance enabled + workspace active), quick actions (Leave, My Shifts, Incidents — each module-gated), absence banners, and colleague-on-leave info.

### More menu (module-gated rows)

My PA, Leave, My Shifts, Forms (paperless), Jobs, Incidents, Contractor Profile, My Payslips, My Documents, My Profile. Each row is shown only if its module flag is on. The module flags are computed in `RefreshModuleNavigation()`:

```581:590:KaiFlow.Timesheets.Maui/ViewModels/Employee/EmployeeDashboardViewModel.cs
        ShowLeaveModule = CompanyModules.IsEnabled(company, CompanyModules.Leave);
        ShowJobsModule = CompanyModules.IsEnabled(company, CompanyModules.Ticketing);
        ShowSchedulingModule = CompanyModules.IsEnabled(company, CompanyModules.Scheduling);
        ShowIncidentsModule = CompanyModules.IsIncidentsEnabled(company);
        ShowPaModule = CompanyModules.IsEnabled(company, CompanyModules.MyPa);
        ...
```

> **Design rule:** employees see **relevant** modules only, not every company-enabled module. Admin domains (Suppliers, Clients, Reports, full Inventory, Property) are intentionally absent from the employee surface.

### Employee drill-downs

`PunchPage`, `MyJobsPage`, `JobCardPage`, `EmployeeJobRequestPage`, `MyIncidentsPage`, `IncidentReportPage`, `MyShiftsPage`, `MyLeavePage`, `MyPayslipsPage`, `MyDocumentsPage`, `MyProfilePage`, `MyPaSectionPage`, `MyPaTaskEditorPage`, `EmployeeThreadChatPage`, `EmployeeNotificationsPage`, `PaperlessPage`, `FormFillPage`, `EmployeeContractorAdminPage`.

### Jobs tab semantics (clarified)

`MyJobsViewModel.ApplyScope` defines three mutually-meaningful scopes:

- **Assigned** — jobs given to the employee by HR/managers (`IsAssignedByOthers` → assigned but not self-created).
- **My Jobs** — jobs the employee created (`IsCreatedBy`).
- **All** — union of the two (`IsInAllJobsScope`).

Ownership classification lives in `Helpers/JobOwnershipHelper.cs`.

## 3 — Contractor portal navigation

`Views/ContractorPortal/ContractorPortalPage.xaml` (`ContractorPortalViewModel`) + `ContractorPortalJobDetailPage` (`ContractorPortalJobDetailViewModel`). Contractors log in with a contractor code, see assigned jobs, and can record site visits/sessions. (See `modules/portals.md` and `security/01-authentication.md`.)

## 4 — Client portal navigation

`Views/ClientPortal/ClientPortalPage.xaml` + `ClientPortalProjectDetailPage` (and a `Views/Client/ClientPortalPage.xaml`). Clients log in with a portal code to view their projects, payments, photos, and exchange messages with HR. (See `modules/portals.md`.)

## Domain-oriented architecture summary

- **Independent identity:** each module has its own nav entry, ViewModels, storage methods, RPCs, tables, permission keys, and telemetry events.
- **Independent gating:** company `enabled_modules` toggle **AND** permission key both must pass for a management nav item to appear.
- **Shared contracts:** modules interoperate through `company_id` scoping and shared models (e.g. `Contractor` powers both Contractors and Suppliers; `Job` links to incidents, inventory usage, and the My PA timeline).
- **Per-audience surfaces:** the same module can appear differently per audience (e.g. My PA is a full sidebar tab for HR and a More-menu page for employees; Jobs is a management workbench for HR and a 3-scope list for employees).

---

_Next: `04-offline-and-realtime.md`, or jump to `backend/` and `security/`._
