/**
 * Supply & Assets helpers — web-first inventory/asset display logic.
 * Supplier records live in `contractors` with partner_kind supplier|both,
 * but product UX treats Suppliers as a distinct module from Contractors.
 */

export function inventoryNeedsReorder(
  quantityOnHand: number | null | undefined,
  reorderLevel: number | null | undefined,
): boolean {
  const qty = Number(quantityOnHand ?? 0)
  const reorder = Number(reorderLevel ?? 0)
  return qty <= reorder
}

export function inventoryStockValue(
  quantityOnHand: number | null | undefined,
  unitCost: number | null | undefined,
): number {
  return Number(quantityOnHand ?? 0) * Number(unitCost ?? 0)
}

export type StockMovementType = 'receive' | 'adjust' | 'return' | 'allocate'

export function stockMovementLabel(type: string | null | undefined): string {
  switch ((type ?? '').toLowerCase()) {
    case 'receive': return 'Receive'
    case 'adjust': return 'Adjust'
    case 'return': return 'Return'
    case 'allocate': return 'Allocate'
    default: return type || '—'
  }
}

export const ASSET_STATUSES = ['active', 'out_of_service', 'retired'] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]

export function isAssetStatus(value: string | null | undefined): value is AssetStatus {
  return ASSET_STATUSES.includes((value ?? '') as AssetStatus)
}

export function assetStatusLabel(status: string | null | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'active': return 'Active'
    case 'out_of_service': return 'Out of service'
    case 'retired': return 'Retired'
    default: return status || '—'
  }
}
