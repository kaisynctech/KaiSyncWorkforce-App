import type { ItemType } from './inventory'

export type RfqStatus =
  | 'draft'
  | 'sent'
  | 'partially_responded'
  | 'responded'
  | 'expired'
  | 'cancelled'

export type QuoteLineSourceType =
  | 'inventory'
  | 'rfq'
  | 'catalogue'
  | 'manual'

export type ServiceDelivery = 'self' | 'outsourced'

export interface QuoteRfq {
  id: string
  company_id: string
  quote_id: string
  supplier_id: string
  supplier_name?: string        // joined
  rfq_number: string
  status: RfqStatus
  sent_via: 'manual' | 'email'
  sent_at: string | null
  responded_at: string | null
  notes: string | null
  response_document_path: string | null
  response_document_name: string | null
  created_by: string | null
  created_at: string
  lines?: QuoteRfqLine[]        // loaded separately
}

export interface QuoteRfqLine {
  id: string
  company_id: string
  rfq_id: string
  catalogue_item_id: string
  variant_id: string | null
  qty_requested: number
  // supplier response (null until filled in)
  supplier_price: number | null
  supplier_ref: string | null
  supplier_qty_available: number | null
  lead_time_days: number | null
  supplier_notes: string | null
  responded_at: string | null
  is_selected: boolean
  // joined
  item_name?: string
  item_sku?: string | null
}

export interface QuoteSourcingSummaryRow {
  line_id: string
  catalogue_item_id: string
  item_name: string
  item_sku: string | null
  item_type: string
  qty_requested: number
  service_delivery: ServiceDelivery | null
  qty_in_stock: number
  is_stockable: boolean
  source_type: QuoteLineSourceType | null
  rfq_count: number
  rfq_responded_count: number
  is_confirmed: boolean
}

export interface RfqComparisonRow {
  rfq_line_id: string
  rfq_id: string
  rfq_number: string
  supplier_id: string
  supplier_name: string
  rfq_status: RfqStatus
  supplier_price: number | null
  supplier_ref: string | null
  supplier_qty: number | null
  lead_time_days: number | null
  supplier_notes: string | null
  responded_at: string | null
  is_selected: boolean
}

// A requested line in the builder (before it becomes a commercial_quote_line)
export interface RequestLine {
  tempId: string          // client-side only
  catalogue_item_id: string | null
  variant_id: string | null
  item_name: string
  item_sku: string | null
  item_type: ItemType | null
  qty: number
  unit_of_measure: string
  service_delivery: ServiceDelivery | null  // only for service/labour
  notes: string | null
  cost_price: number      // from catalogue
  unit_sell_price: number // from catalogue or zero
}

// Loaded commercial_quote_line row
export interface QuoteLine {
  id: string
  company_id: string
  quote_id: string
  sort_order: number
  catalogue_item_id: string | null
  variant_id: string | null
  description: string
  unit: string
  quantity: number
  cost_price: number
  markup_percent: number
  unit_sell_price: number
  subtotal_cost: number
  subtotal_sell: number
  vat_rate: number
  vat_amount: number
  line_total: number
  source_type: QuoteLineSourceType | null
  rfq_line_id: string | null
  service_delivery: ServiceDelivery | null
  item_type: string
  is_optional: boolean
  is_excluded: boolean
}
