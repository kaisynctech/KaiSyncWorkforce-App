// ─── Inventory & Services — shared types ─────────────────────────────────────

export type AdjustmentType =
  | 'received'
  | 'returned_by_customer'
  | 'count_correction'
  | 'damaged'
  | 'internal_use'
  | 'transferred_in'
  | 'transferred_out'
  | 'other'

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
  name: string
  description: string | null
  item_type: ItemType
  // Legacy field (pre-migration column)
  code: string | null
  sku: string | null
  brand: string | null
  condition_id: string | null
  condition?: CatalogueCondition
  variant_group_id: string | null
  // Legacy unit field (pre-migration)
  unit: string | null
  unit_of_measure: string
  cost_price: number
  sell_price: number
  markup_percent: number | null
  // Alias for markup_percent used by some consumers
  markup: number | null
  gross_margin_percent: number | null
  is_stockable: boolean
  qty_on_hand: number
  qty_on_order: number
  qty_reserved: number
  /** Computed: qty_on_hand - qty_reserved */
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
