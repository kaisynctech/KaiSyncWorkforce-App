# Module — Contractors

> **Module key:** `contractors` · **Permissions:** `contractors.view`, `contractors.create`, `contractors.edit` · **Maturity:** Production (portal strong; member invite incomplete)

## Purpose

External-partner management: contractor/supplier hybrid register, member linking, portal codes, employee-scoped job visibility, and a multi-job **contractor portal** with site sign-in/out, job messaging, incidents, and photos.

## ViewModels & screens

| ViewModel | Screen | Role |
|-----------|--------|------|
| `HrContractorsViewModel` | `HrContractorsPage.xaml` | List contractor-kind partners |
| `HrContractorDetailsViewModel` | `HrContractorDetailsPage.xaml` | CRUD, member links, portal code, partner kind |
| `EmployeeContractorAdminViewModel` | `EmployeeContractorAdminPage.xaml` | Read-only linked-contractor profile for member employees |
| `ContractorPortalViewModel` | `ContractorPortalPage.xaml` | Code-based portal login + job list |
| `ContractorPortalJobDetailViewModel` | `ContractorPortalJobDetailPage.xaml` | Job detail, visits, messages |

## Models

`Contractor` (`contractors`), `ContractorMemberLink` (`contractor_member_links`), `JobSiteVisit` (`job_site_visits`), `JobSiteSession` (client-side aggregate of visits), `ContractorPortalLogin`.

## Code generation

`EntityCodeHelper.ContractorPrefix(company.Code)` + `GenerateNextContractorCodeAsync`; auto-generated on create when `PartnerKinds.IsContractorKind`. `ContractorCodeHelper` builds portal login hints. DB unique index `uq_contractors_company_contractor_code`.

## Storage methods

`GetContractorsAsync`, `GetLinkedContractorsForEmployeeAsync`, `CreateContractorAsync`/`UpdateContractorAsync`, `GetContractorMemberLinksAsync`/`CreateContractorMemberLinkAsync`, `GenerateNextContractorCodeAsync`, `ResolveContractorByCodeAsync`, `GetJobSiteVisitsAsync`, `EmployeeJobSite*` (sign-in/out/switch/open), `ContractorPortal*` (jobs, visits, incidents, messages, photos).

## RPCs / migrations

`contractor_resolve_by_code`, `contractor_portal_list_jobs`, `contractor_portal_open_visit`, `contractor_portal_site_sign_in/out`, `contractor_portal_visit_history`, `contractor_portal_create_incident`, `contractor_portal_append_job_photo`, `contractor_portal_get/send_job_message`, `employee_get_linked_contractors`. Migrations: `..._contractors_parent_and_members.sql`, `..._employee_contractor_scope_jobs.sql`, `..._contractor_visibility_and_member_scope.sql`, `..._contractor_admin_invite_and_members_rpc.sql`, `..._multi_job_contractor_portal_site_visits.sql`, `..._contractor_admin_events.sql`.

## Tables

`contractors`, `contractor_member_links`, `job_site_visits`, `contractor_admin_events`; jobs link via `jobs.contractor_id` / `contractor_employee_id`.

## Permissions

`contractors.view/create/edit`. HR nav: `ShowContractorsNav = CompanyModules.Contractors && ContractorsView`.

## Realtime / Offline

None in the contractors module; `ContractorPortalSessionStore` persists the portal session locally.

## Interoperability

- **↔ Suppliers:** same `contractors` table, `partner_kind` discriminator (`both` appears in both lists).
- **↔ Jobs:** contractors are assignable to jobs; portal records `job_site_visits`.
- **↔ Incidents:** contractors can file incidents from the portal.
- **↔ Employees:** member employees see a read-only linked-contractor profile.

## Risks & gaps

1. **Member invite (`InviteMemberAsync`) sends OTP but doesn't auto-link** the member to the contractor.
2. **`EmployeeContractorAdminViewModel` is read-only** — no self-service edit.
3. **Site-visit UX lives on job detail/portal**, not centralized in the contractors module.
4. **`JobSiteSession` is UI-only** (no separate persistence).
5. See `modules/portals.md` for the contractor-portal auth/security model.
