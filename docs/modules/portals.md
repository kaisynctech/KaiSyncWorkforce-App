# Module — Client & Contractor Portals

> **Gated by:** `clients` / `contractors` modules · **Auth:** code-based anon (no JWT) · **Maturity:** Production

Both portals are **external-facing surfaces inside the same app**, reached from `IdEntryPage`. Neither uses Supabase Auth; both authenticate with **shared-secret codes** and operate entirely through `SECURITY DEFINER` RPCs granted to `anon`. See `security/01-authentication.md` for the auth model.

## Client portal

### Purpose
Lets a company's clients self-serve: view their projects, quotations, documents, photos, and payments, and exchange messages with HR.

### Surface
- Entry: `IdEntryViewModel.OpenClientPortalAsync()` → `client_resolve_by_code` → `ClientPortalSessionStore` → `//ClientPortalPage`. (A guest variant opens an external web URL `portal.kaiflow.co.za/client/{code}`.)
- ViewModels: `ClientPortalViewModel` (projects + message inbox), `ClientPortalProjectDetailViewModel`.
- Views: `Views/ClientPortal/ClientPortalPage.xaml`, `ClientPortalProjectDetailPage.xaml` (also a `Views/Client/ClientPortalPage.xaml`).
- Navigation helper: `ClientPortalNavigation` (`ExitToLoginAsync` sets `SuppressAutoLogin`).

### RPCs / migrations
`client_resolve_by_code`, `client_portal_list_projects`, `client_portal_get_project`, `client_portal_add_document_link`, `client_portal_send_message`, `client_portal_get_deal_messages`, `client_portal_list_message_inbox`. Migrations: `..._clients_portal_code.sql`, `..._client_portal_rpc.sql`, `..._client_portal_project_detail.sql`, `..._client_portal_enhancements.sql`, `..._client_portal_in_app_messaging.sql`, `..._client_message_inbox_and_hr_notify.sql`.

### Models / storage
`ClientPortalLogin`, `ClientPortalPhotoItem`, `ClientPortalMessageInboxItem`; storage wrappers `ResolveClientByCodeAsync`, `GetClientPortalProjectsAsync`, `GetClientPortalProjectAsync`, `GetClientPortalMessageInboxAsync`, `ClientPortalSendMessageAsync`, `ClientPortalRegisterDocumentAsync`, `ClientPortalUploadDocumentAsync` (bucket `workforce-media`). Session store tracks per-deal message read timestamps.

### Visibility
Portal RPCs exclude `client_deals.visibility = 'private'`. Inbound client messages trigger **HR notifications** (`client_message_inbox_and_hr_notify`).

### Interoperability
- **↔ Projects/Clients:** the portal is the external face of the Projects (CRM) + Clients modules.
- **↔ Messaging/Notifications:** client messages flow into HR's notification stream.

## Contractor portal

### Purpose
Lets external contractors see assigned jobs, sign in/out of sites (multi-job), file incidents, exchange job messages, and attach photos.

### Surface
- Entry: `IdEntryViewModel.OpenContractorPortalAsync()` → `contractor_resolve_by_code` → `ContractorPortalSessionStore` → `ContractorPortalPage`.
- ViewModels: `ContractorPortalViewModel` (job list, open visit), `ContractorPortalJobDetailViewModel` (visits, messages, incidents, photos).
- Views: `Views/ContractorPortal/ContractorPortalPage.xaml`, `ContractorPortalJobDetailPage.xaml`.

### RPCs / migrations
`contractor_resolve_by_code`, `contractor_portal_list_jobs`, `contractor_portal_open_visit`, `contractor_portal_site_sign_in`/`_sign_out`, `contractor_portal_visit_history`, `contractor_portal_create_incident`, `contractor_portal_append_job_photo`, `contractor_portal_get/send_job_message`. Migration: `..._multi_job_contractor_portal_site_visits.sql` (adds `contractors.contractor_code`, `job_site_visits`).

### Models / storage
`ContractorPortalLogin`, `JobSiteVisit`, `JobSiteSession`; storage wrappers `ResolveContractorByCodeAsync`, `GetContractorPortalJobsAsync`, `ContractorPortalOpenVisitAsync`, site sign-in/out, incident/message/photo ops. Session store in Preferences.

### Interoperability
- **↔ Contractors module:** HR manages contractors and codes (`modules/contractors.md`).
- **↔ Jobs:** contractor visits attach to jobs (`job_site_visits`).
- **↔ Incidents:** contractor-filed incidents (`contractor_id`).

## Shared security characteristics

| Aspect | Client portal | Contractor portal |
|--------|---------------|-------------------|
| Auth | `client_resolve_by_code` | `contractor_resolve_by_code` |
| Role | anon | anon |
| Data access | `client_portal_*` RPCs | `contractor_portal_*` RPCs |
| Server session table | none (Preferences only) | none (Preferences only) |
| Risk | code = shared secret; no rate limiting observed | same |

## Risks & gaps

1. **Codes are shared secrets** with no visible rate limiting — a hardening target (see roadmap).
2. **No server-side portal session** — local-only persistence; revocation relies on rotating codes.
3. **Client guest mode** leaves the app for a web URL — divergent experience from the in-app portal.
