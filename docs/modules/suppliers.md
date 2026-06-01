# Module — Suppliers

> **Module key:** `suppliers` (falls back to `inventory`) · **Permissions:** `suppliers.view`, `suppliers.edit` (with `inventory.view` fallback) · **Maturity:** Production

## Purpose

A dedicated, **independently-navigable** supplier register. Per the enterprise design rule, Suppliers is its **own HR sidebar tab (index 21)** and is *not* buried inside Inventory — though the two interoperate for sourcing.

## Implementation: a filtered view of `contractors`

Suppliers are **not a separate entity**. They are `contractors` rows discriminated by `partner_kind IN ('supplier','both')` via `Helpers/PartnerKinds.cs`. This keeps one partner table while presenting two navigation identities.

## ViewModel & screen

`HrSuppliersViewModel` → `Views/Hr/HrSuppliersPage.xaml`. Create/edit reuses `HrContractorDetailsPage` in supplier mode (`?PartnerKind=supplier`).

## Storage methods

No supplier-specific API — reuses `GetContractorsAsync`, `CreateContractorAsync`, `UpdateContractorAsync`, `GenerateNextContractorCodeAsync` (code generation is **skipped for supplier-only** partners).

## Tables / migrations

`contractors` (`partner_kind`), `inventory_items.supplier_contractor_id` (uuid FK). Migration: `..._partners_inventory_supplier_uuid.sql`; profile fields in `..._contractors_partner_profile_fields.sql`.

## Module gating

```71:76:KaiFlow.Timesheets.Maui/Helpers/CompanyModules.cs
        if (key == Suppliers)
        {
            if (company.EnabledModules.TryGetValue(Suppliers, out var suppliers)) return suppliers;
            if (company.EnabledModules.TryGetValue(Inventory, out var inventory)) return inventory;
            return defaultVal;
        }
```

HR nav: `ShowSuppliersNav = CompanyModules.Suppliers && (SuppliersView || InventoryView)`.

## Permissions

`suppliers.view` / `suppliers.edit` defined in `PermissionKeys`. `CanViewSuppliers` accepts `inventory.view` as a fallback so existing inventory-enabled tenants keep access.

## Supplier ↔ Inventory interoperability

`HrInventoryDetailViewModel` loads suppliers (`GetContractorsAsync` filtered by `PartnerKinds.IsSupplierKind`), persists both a denormalized `supplier` text and the FK `supplier_contractor_id`, and offers an "add supplier" shortcut into contractor-details (supplier mode).

## Realtime / Offline / Telemetry

None.

## Risks & gaps

1. **Suppliers conflated with contractors** at the data layer — reporting/permissions are shared, not independent.
2. **`suppliers.edit` not seeded in `PermissionDefaults`** — edit access may be inconsistent for non-owner roles until the DB seed catches up.
3. **Supplier-only partners get no contractor code/portal** (correct by design, but portal sections are hidden).
4. **Dual supplier storage** (`supplier` text + FK) can drift if a partner is renamed.
