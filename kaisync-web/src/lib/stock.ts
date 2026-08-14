import type { AdjustmentType } from '@/types/inventory'

export interface AdjustmentTypeConfig {
  value: AdjustmentType
  label: string
  direction: 'in' | 'out' | 'either'  // controls default sign of qty
  colour: string                        // Tailwind text colour class
  icon: string                          // Material Icon name
}

export const ADJUSTMENT_TYPES: AdjustmentTypeConfig[] = [
  { value: 'received',             label: 'Received stock',         direction: 'in',     colour: 'text-green-600',  icon: 'add_circle' },
  { value: 'returned_by_customer', label: 'Customer return',        direction: 'in',     colour: 'text-blue-600',   icon: 'keyboard_return' },
  { value: 'count_correction',     label: 'Stock count correction', direction: 'either', colour: 'text-amber-600',  icon: 'fact_check' },
  { value: 'damaged',              label: 'Damaged / write-off',    direction: 'out',    colour: 'text-red-600',    icon: 'broken_image' },
  { value: 'internal_use',         label: 'Internal use',           direction: 'out',    colour: 'text-orange-600', icon: 'build' },
  { value: 'transferred_in',       label: 'Transferred in',         direction: 'in',     colour: 'text-teal-600',   icon: 'move_to_inbox' },
  { value: 'transferred_out',      label: 'Transferred out',        direction: 'out',    colour: 'text-teal-600',   icon: 'outbox' },
  { value: 'other',                label: 'Other',                  direction: 'either', colour: 'text-gray-600',   icon: 'tune' },
]

export function getAdjustmentConfig(type: AdjustmentType): AdjustmentTypeConfig {
  return ADJUSTMENT_TYPES.find(t => t.value === type) ?? ADJUSTMENT_TYPES[ADJUSTMENT_TYPES.length - 1]
}

/** Format signed qty for display: +5 or -3 */
export function fmtQtyChange(qty: number): string {
  return qty > 0 ? `+${qty}` : `${qty}`
}
