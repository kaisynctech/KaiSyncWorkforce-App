// Unified Inventory & Services Catalogue types
// DB table: quote_catalogue_items (extended via migration 20260812000100)

export type ItemType = 'part' | 'service' | 'material' | 'labour'

export type AliasType =
  | 'part_number'
  | 'oem_number'
  | 'manufacturer_code'
  | 'barcode'
  | 'name'
  | 'superseded_number'

export interface CatalogueCondition {
  id: string
  company_id: string | null
  name: string
  is_standard: boolean
  sort_order: number
  is_active: boolean
}

export interface CatalogueItem {
  id: string
  company_id: string
  // Legacy identifier (pre-migration)
  code: string | null
  name: string
  description: string | null
  item_type: ItemType
  // New SKU column (migration 20260812000100)
  sku: string | null
  brand: string | null
  condition_id: string | null
  condition?: CatalogueCondition
  variant_group_id: string | null
  // New unit column; legacy items have 'unit'
  unit_of_measure: string
  unit: string | null
  cost_price: number
  sell_price: number
  // DB column: markup_percent
  markup_percent: number | null
  is_stockable: boolean
  qty_on_hand: number
  qty_on_order: number
  qty_reserved: number
  /** computed client-side: qty_on_hand - qty_reserved */
  qty_available?: number
  reorder_point: number | null
  reorder_qty: number | null
  bin_location: string | null
  branch_id: string | null
  is_active: boolean
  internal_notes: string | null
  ai_suggested: boolean
  usage_count: number
  created_at: string
  aliases?: CatalogueItemAlias[]
  suppliers?: CatalogueItemSupplier[]
}

export interface CatalogueItemAlias {
  id: string
  company_id: string
  catalogue_item_id: string
  alias_type: AliasType
  alias_value: string
  notes: string | null
  created_at: string
}

export interface CatalogueItemSupplier {
  id: string
  company_id: string
  catalogue_item_id: string
  supplier_id: string
  supplier?: { id: string; name: string }
  supplier_sku: string | null
  unit_cost: number | null
  lead_time_days: number | null
  min_order_qty: number | null
  is_preferred: boolean
  notes: string | null
  last_price_updated_at: string | null
  created_at: string
}

// ─── Stock Adjustments ────────────────────────────────────────────────────────

export type AdjustmentType =
  | 'received'
  | 'returned_by_customer'
  | 'count_correction'
  | 'damaged'
  | 'internal_use'
  | 'transferred_in'
  | 'transferred_out'
  | 'sold'
  | 'other'

export interface StockAdjustment {
  id: string
  company_id: string
  catalogue_item_id: string
  adjusted_by: string | null
  adjusted_by_name?: string       // from view
  adjustment_type: AdjustmentType
  qty_change: number              // signed: positive = added, negative = removed
  qty_before: number
  qty_after: number
  reference_type: string | null
  reference_id: string | null
  notes: string | null
  created_at: string
}

// Returned by record_stock_adjustment RPC
export interface AdjustmentResult {
  adjustment_id: string
  qty_before: number
  qty_after: number
  qty_change: number
}
