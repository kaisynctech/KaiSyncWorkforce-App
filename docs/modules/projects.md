# Module — Projects (CRM)

> **Module key:** `ticketing` + `projects.*` permissions · **Maturity:** Production
>
> **Naming:** The UI says "Projects"; the database entity is **`client_deals`**. Always map UI "Project" → DB `client_deals` when reading SQL.

## Purpose

A CRM-style pipeline for longer client engagements: deal/project kanban + table, quotations, client payments, documents, job linking, and progress/financial sync. Projects can be client-linked or internal (no client).

## ViewModels & screens

| ViewModel | Screen | Role |
|-----------|--------|------|
| `HrProjectDetailViewModel` | `HrProjectDetailPage.xaml` | Full CRM detail: details, documents, quotation, pipeline, payments |
| `HrJobsViewModel` | `HrProjectsPage.xaml` (+ `HrProjectsTableView`) | Projects list/table (shared with Jobs VM via projects mode) |
| `ClientDetailViewModel` | `ClientDetailPage.xaml` | Client-scoped kanban (`KanbanColumns`) |

Kanban controls: `Views/Hr/Controls/ProjectKanbanColumnView.xaml`, `ProjectKanbanCardView.xaml`. Support types: `ProjectRowItem`, `ProjectKanbanColumn`, `MoveProjectRequest`, `PipelineStageChip`. Helpers: `ProjectPipeline`, `ProjectProgressHelper`, `ProjectQuotationBuilder`, `ProjectQuotationDisplay`, `HrProjectsTableLayout`.

## Models

`ClientDeal` (`client_deals`), `ProjectDocument`, `ProjectQuotationLine`, `ProjectClientPayment`, `JobCode`, `ClientDealUpdate`, `ClientDealMessage`.

## Storage methods

`GetClientDealsAsync`, `GetClientDealAsync`, `CreateClientDealAsync`, `UpdateClientDealAsync`, `DeleteClientDealAsync`, `LinkClientDealToJobAsync`, `GetJobsByDealIdAsync`, project document/quotation/payment CRUD, `SyncClientDealFinancialsAsync`, `GetClientDealUpdatesAsync`/`AddClientDealUpdateAsync`, `GenerateNextProjectCodeAsync`, plus client-portal read RPCs.

## Migrations

`..._client_deals_uuid_foundation.sql` (uuid rebuild + `jobs.deal_id`), `..._project_job_codes_crm.sql`, `..._project_crm_enhancements.sql`, `..._project_job_crm_links.sql` (`manager_employee_id`, quotation lines, job documents), `..._project_client_payments.sql`, `..._project_job_document_storage_rls.sql`, `..._optional_project_client.sql`, `..._projects_jobs_view_all_permissions.sql`, `..._rename_deal_template_labels_to_project.sql`.

## Tables

`client_deals`, `client_deal_updates`, `client_deal_messages`, `project_documents`, `project_quotation_lines`, `project_client_payments`, `job_codes`.

## Permissions

`projects.view`, `projects.view_all`, `projects.create`, `projects.edit`. HR nav: `ShowProjectsNav = ShowJobsNav && projects.view`.

## Realtime / Offline / Telemetry

None dedicated — all CRM writes are online PostgREST/RPC; no project-specific telemetry events.

## Interoperability

- **↔ Jobs:** a project (`client_deals`) links to jobs via `deal_id`; `HrProjectDetailViewModel.OpenProjectJobCommand` opens the linked job.
- **↔ Clients:** projects belong to a client; surfaced in the **client portal** (excluding `visibility='private'`).
- **↔ Payments/Quotations:** financial sync (`SyncClientDealFinancialsAsync`) aggregates quotation lines + client payments; `ProjectProgressHelper` reflects linked-job completion.
- **→ My PA:** projects/deals appear in the PA timeline.

## Risks & gaps

1. **UI "Project" vs DB `client_deals`** naming must be documented to avoid confusion.
2. **Financial sync** must stay consistent with payment sums and linked-job completion.
3. **Kanban lives on Client Detail**, not the global Projects page — an architectural split worth noting.
