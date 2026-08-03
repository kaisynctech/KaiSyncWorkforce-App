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

/** Suggested purchase qty to bring stock back above reorder level. */
export function suggestedReorderQty(
  quantityOnHand: number | null | undefined,
  reorderLevel: number | null | undefined,
): number {
  const qty = Number(quantityOnHand ?? 0)
  const reorder = Number(reorderLevel ?? 0)
  const gap = reorder - qty
  if (gap > 0) return gap
  return inventoryNeedsReorder(qty, reorder) ? 1 : 0
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

const DAY_MS = 24 * 60 * 60 * 1000

export function isWarrantyExpired(warrantyExpires: string | null | undefined): boolean {
  if (!warrantyExpires) return false
  const end = new Date(warrantyExpires)
  end.setHours(23, 59, 59, 999)
  return end.getTime() < Date.now()
}

export function isWarrantyExpiringSoon(
  warrantyExpires: string | null | undefined,
  withinDays = 30,
): boolean {
  if (!warrantyExpires || isWarrantyExpired(warrantyExpires)) return false
  const end = new Date(warrantyExpires).getTime()
  const diff = end - Date.now()
  return diff >= 0 && diff <= withinDays * DAY_MS
}

/** Append a dated service note line to existing notes. */
export function appendAssetServiceNote(
  existing: string | null | undefined,
  note: string,
  actorName?: string | null,
): string {
  const text = note.trim()
  if (!text) return (existing ?? '').trim()
  const date = new Date().toISOString().slice(0, 10)
  const who = actorName?.trim() ? ` (${actorName.trim()})` : ''
  const line = `[${date}]${who} ${text}`
  const prev = (existing ?? '').trim()
  return prev ? `${prev}\n${line}` : line
}

export function extendWarrantyDate(
  current: string | null | undefined,
  days: number,
): string {
  const base = current && !Number.isNaN(Date.parse(current))
    ? new Date(current)
    : new Date()
  if (base.getTime() < Date.now()) {
    base.setTime(Date.now())
  }
  base.setDate(base.getDate() + days)
  return base.toISOString().slice(0, 10)
}
