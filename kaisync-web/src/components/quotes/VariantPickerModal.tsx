'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CatalogueItem } from '@/types/inventory'

interface Props {
  baseItem: CatalogueItem   // the item whose variant_group_id we query on
  companyId: string
  onSelect: (variant: CatalogueItem) => void
  onClose: () => void
}

export default function VariantPickerModal({ baseItem, companyId, onSelect, onClose }: Props) {
  const supabase = createClient()
  const [variants, setVariants] = useState<CatalogueItem[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!baseItem.variant_group_id) { onSelect(baseItem); return }
    supabase
      .from('quote_catalogue_items')
      .select('*, condition:catalogue_conditions(id,name)')
      .eq('variant_group_id', baseItem.variant_group_id)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('brand', { nullsFirst: true })
      .then(({ data }) => {
        setVariants((data ?? []) as CatalogueItem[])
        setLoading(false)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-6">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[80vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-divider shrink-0">
          <div>
            <h2 className="text-[15px] font-semibold text-text-primary">Select variant</h2>
            <p className="text-[12px] text-text-secondary mt-0.5">{baseItem.name}</p>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-text-secondary text-[13px] gap-2">
              <span className="material-icons animate-spin text-primary text-[18px]">refresh</span>
              Loading variants…
            </div>
          ) : variants.length === 0 ? (
            <div className="py-10 text-center text-[13px] text-text-secondary">No variants found.</div>
          ) : (
            <div className="divide-y divide-divider">
              {variants.map(v => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onSelect(v)}
                  className="w-full flex items-center justify-between px-6 py-3 hover:bg-surface-elevated transition-colors text-left"
                >
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">
                      {v.brand ?? 'No brand'} — {v.condition?.name ?? 'Any condition'}
                    </p>
                    <p className="text-[11px] text-text-secondary mt-0.5">
                      {v.sku ?? '—'} &middot; On hand: {v.qty_on_hand ?? 0}
                    </p>
                  </div>
                  <span className="material-icons text-[18px] text-text-secondary">chevron_right</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-divider shrink-0">
          <button
            type="button"
            onClick={() => onSelect(baseItem)}
            className="text-[12px] text-text-secondary hover:text-text-primary transition-colors"
          >
            Use base item (any variant)
          </button>
        </div>
      </div>
    </div>
  )
}
