# Module — Inventory

> **Module key:** `inventory` · **Permissions:** `inventory.view`, `inventory.edit` · **Maturity:** Production (with one known backend bug)

## Purpose

Company stock register — SKU, costs, selling price, reorder alerts, supplier linkage, and job usage allocation. HR-only (no employee-facing inventory surface).

## ViewModels & screens

| ViewModel | Screen |
|-----------|--------|
| `HrInventoryViewModel` | `HrInventoryPage.xaml` |
| `HrInventoryDetailViewModel` | `HrInventoryDetailPage.xaml` |

## Models

`InventoryItem` (`inventory_items`; `quantity_on_hand`, `unit_cost`, `selling_price`, `reorder_level`, `supplier`, `supplier_contractor_id`), `InventoryUsage` (`inventory_usage`), `InventoryAllocation` (**orphaned — table dropped in uuid v2**).

## Storage methods

`GetInventoryItemsAsync`, `GetInventoryItemAsync`, `CreateInventoryItemAsync`, `UpdateInventoryItemAsync`, `GetInventoryUsageAsync`, `CreateInventoryUsageAsync`.

## RPCs / migrations

`employee_get_inventory_items`, `employee_get_inventory_usage_for_job`, `employee_set_inventory_usage_for_job` (`..._uuid_rpc_parity_jobs_messaging_inventory.sql`). Schema/cost: `..._inventory_item_costs.sql`, `..._inventory_selling_price_work_teams.sql`, `..._inventory_item_supplier_link.sql`, `..._uuid_v2_batch5_inventory_assets_compliance.sql`. Legacy `inventory_allocations` dropped in `..._uuid_schema_v2_drop_legacy.sql`.

## Stock & allocation

- **HR create/edit:** direct PostgREST on `inventory_items`.
- **HR job allocation (`AllocateToJobAsync`):** creates `InventoryUsage` and **manually decrements `QuantityOnHand` in the ViewModel** — not transactional with the DB.
- **Worker/code-login:** `employee_set_inventory_usage_for_job` merges usage and adjusts stock in the RPC.

## Permissions

`inventory.view` / `inventory.edit`. HR nav: `ShowInventoryNav = CompanyModules.Inventory && Can(InventoryView)`.

## Realtime / Offline / Telemetry

None (no realtime channel, no offline queue). RPC failures logged via telemetry on code-login paths.

## Interoperability

- **↔ Suppliers:** `inventory_items.supplier_contractor_id` → a `Contractor` with supplier `partner_kind`; detail screen loads suppliers via `GetContractorsAsync` filtered by `PartnerKinds.IsSupplierKind`.
- **↔ Jobs:** usage allocated against a job.

## Risks & gaps

1. **Critical backend bug:** `employee_set_inventory_usage_for_job` references `stock_count` but the column is `quantity_on_hand` — worker-path stock deduction likely **broken** (HR manual path masks it). Fix before relying on field-side inventory deduction.
2. **HR allocation is non-transactional** — usage insert + manual decrement can diverge on partial failure.
3. **`InventoryAllocation` model is orphaned** (table dropped) — app uses `InventoryUsage`.
4. **No usage-history UI**, no employee-facing module, no stock-adjustment audit trail.
