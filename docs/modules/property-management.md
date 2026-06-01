# Module — Property Management (+ Asset Compliance)

> **Module keys:** `property_management` (legacy `properties`), `asset_compliance` · **Permissions:** none dedicated (module-gated) · **Maturity:** **Early-stage** (priority expansion area)

## Purpose

A property/site register: sites (properties), per-site units and residents, and compliance-expiry surfacing; plus a related **Asset Compliance** module for an equipment register with inspection/certificate tracking. The schema is rich; the UI is currently minimal (prompt-based forms).

## ViewModels & screens

| ViewModel | Screen | Notes |
|-----------|--------|-------|
| `HrPropertiesViewModel` | `HrPropertiesPage.xaml` | Site list + create via prompts; "expiring compliance" widget |
| `HrResidentsViewModel` | `HrResidentsPage.xaml` | Tabs: residents / units / compliance per site (prompt-driven) |
| `HrAssetsViewModel` | `HrAssetsPage.xaml` | Asset register (separate module key) |

## Models

`Site` (`sites`), `Unit` (`units`), `Resident` (`residents`), `ComplianceEntry` (`compliance_entries`), `Asset` (`assets`).

## Storage methods

`GetSitesAsync`/`CreateSiteAsync`/`UpdateSiteAsync`, `GetUnitsAsync`/`CreateUnitAsync`/`UpdateUnitAsync`, `GetResidentsAsync`/`CreateResidentAsync`/`UpdateResidentAsync`, `GetAssetsAsync`/`CreateAssetAsync`/`UpdateAssetAsync`, `GetComplianceEntriesAsync`/`CreateComplianceEntryAsync`/`UpdateComplianceEntryAsync`. **All direct PostgREST** — no property RPCs.

## Migrations

`..._module_flags_and_property_management.sql`, `..._client_types_and_cascading_units.sql`, `..._uuid_v2_batch2_sites_jobs.sql` (uuid sites/units/residents), `..._uuid_v2_batch5_inventory_assets_compliance.sql` (assets/compliance), `..._asset_register.sql`.

## Permissions / gating

No property-specific keys; nav gated by `CompanyModules.PropertyManagement` (`ShowPropertiesNav`) and `CompanyModules.AssetCompliance` (`ShowAssetsNav`). The `property_management` key falls back to legacy `properties`.

## Realtime / Offline / Telemetry

None.

## Navigation

HR dashboard → `HrPropertiesPage`, `HrAssetsPage`; Properties → `HrResidentsPage` with `{ siteId }`.

## Interoperability

- **↔ Clients:** sites can be client-linked.
- **↔ Incidents:** `incident_reports.site_id` exists (linkage not yet surfaced in the property UI).
- **Potential ↔ Jobs / My PA:** inspections could tie to jobs/tasks (future).

## Expansion potential (priority)

The schema already supports client-linked sites, geo fields, unit occupancy, compliance certificates, and asset warranties. Natural build-out:
- Unit↔resident linking (model has `unit_id` but the create flow doesn't set it).
- Compliance document upload + inspection scheduling (tie to `PaTask`/jobs/incidents).
- Lease workflows, per-unit reporting, property maps/geofencing.

## Risks & gaps

1. **`HrResidentsViewModel` lacks `[QueryProperty(SiteId)]`** — navigation passes `siteId` but the page never auto-selects the site (**functional gap**).
2. **No delete flows** for sites/units/residents.
3. **Compliance tab is read-only** — no create/edit in the ViewModel.
4. **Assets "delete" only soft-retires** via status.
5. **Early-stage maturity** — minimal forms; no maps/geofence (contrast with branch sign-in in Settings).
