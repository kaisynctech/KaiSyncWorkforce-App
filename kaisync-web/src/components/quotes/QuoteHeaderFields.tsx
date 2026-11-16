'use client'

import { HEADER_LABEL, type QuoteTemplate } from '@/lib/quote-templates'
import type { HeaderField } from '@/lib/business-types'

const TYPE: Partial<Record<HeaderField, 'date' | 'text'>> = { event_date: 'date' }
const PLACEHOLDER: Partial<Record<HeaderField, string>> = {
  vehicle: 'e.g. Mercedes Actros 2645, reg. or VIN',
  client_order_no: 'Their PO or order number',
  site_address: 'Where the work happens',
  contract_term: 'e.g. 12 months from 1 Jan 2027',
}

/** The fields at the top of a template quotation (vehicle, event date, site address, …). */
export function QuoteHeaderFields({ template, values, onChange, readOnly }: {
  template: QuoteTemplate
  values: Record<string, string>
  onChange: (key: string, v: string) => void
  readOnly?: boolean
}) {
  if (!template.header_fields.length) return null
  return (
    <div className="rounded-xl border border-divider bg-surface px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2.5">
      {template.header_fields.map(h => (
        <label key={h} className="text-[10.5px] text-text-secondary uppercase tracking-wide">
          {HEADER_LABEL[h] ?? h}
          <input
            type={TYPE[h] ?? 'text'}
            value={values[h] ?? ''}
            disabled={readOnly}
            maxLength={200}
            placeholder={PLACEHOLDER[h]}
            onChange={e => onChange(h, e.target.value)}
            className="mt-1 w-full h-11 sm:h-9 rounded-lg border border-divider bg-surface px-2.5 text-[14px] sm:text-[13px] normal-case tracking-normal text-text-primary focus:outline-none focus:border-primary"
          />
        </label>
      ))}
    </div>
  )
}
