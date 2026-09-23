'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  billingPeriodFor,
  generateMonthlyRentInvoices,
  type BulkRentInvoiceResult,
} from '@/lib/lease-billing'

type Props = {
  companyId: string
  employeeId: string
  /** When set, only invoices leases on this property */
  siteId?: string | null
  siteName?: string | null
  onClose: () => void
  onDone: (result: BulkRentInvoiceResult) => void
}

function monthInputValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function parseMonthInput(v: string): Date {
  const [y, m] = v.split('-').map(Number)
  if (!y || !m) return new Date()
  return new Date(y, m - 1, 1)
}

export function GenerateRentInvoicesModal({
  companyId,
  employeeId,
  siteId,
  siteName,
  onClose,
  onDone,
}: Props) {
  const [month, setMonth] = useState(() => monthInputValue(new Date()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkRentInvoiceResult | null>(null)

  const period = useMemo(() => billingPeriodFor(parseMonthInput(month)), [month])
  const scopeLabel = siteId
    ? (siteName ? `property “${siteName}”` : 'this property')
    : 'all properties'

  async function run() {
    setBusy(true)
    setError(null)
    setResult(null)
    const supabase = createClient()
    const res = await generateMonthlyRentInvoices(supabase, {
      companyId,
      employeeId,
      siteId: siteId ?? null,
      periodDate: parseMonthInput(month),
      send: true,
      vatPercent: 0,
    })
    setBusy(false)

    if (res.failed.length === 1 && res.failed[0].leaseId === '' && res.created === 0) {
      setError(res.failed[0].message)
      return
    }

    setResult(res)
    onDone(res)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-[16px] font-semibold text-text-primary">Generate rent invoices</h2>
        <p className="text-[12px] text-text-secondary">
          Creates Money rent invoices for active <strong>monthly</strong> leases on {scopeLabel}
          for <strong>{period.label}</strong>. Already invoiced leases are skipped.
          Weekly / other frequencies stay on the unit or lease screen.
        </p>

        <label className="block text-[12px] text-text-secondary">
          Billing month
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            disabled={busy || !!result}
            className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background disabled:opacity-60"
          />
        </label>

        {error && <p className="text-[13px] text-error">{error}</p>}

        {result && (
          <div className="rounded-lg border border-divider bg-surface-elevated px-3 py-2 space-y-1">
            <p className="text-[13px] text-text-primary">
              {result.created} created · {result.skipped} skipped
              {result.failed.length > 0 ? ` · ${result.failed.length} failed` : ''}
            </p>
            {result.failed.length > 0 && (
              <ul className="text-[11px] text-error list-disc pl-4 max-h-28 overflow-y-auto">
                {result.failed.slice(0, 20).map((f, i) => (
                  <li key={`${f.leaseId}-${i}`}>
                    {f.tenant ?? (f.leaseId.slice(0, 8) || 'Batch')}: {f.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-outlined h-9 px-3 text-[13px]">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run()}
              className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50"
            >
              {busy ? 'Generating…' : `Generate ${period.label}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
