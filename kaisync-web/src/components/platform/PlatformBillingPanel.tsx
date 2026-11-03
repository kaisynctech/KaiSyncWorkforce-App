'use client'

/** Platform admin: who pays through PayFast, who is in trial, who owes and who is read-only. */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Row = {
  id: string; name: string; billing_enabled: boolean; locked_at: string | null; subscription_status: string | null
  trial_ends_at: string | null; monthly_charge: number | null; has_card: boolean; owing: number; oldest_due: string | null; last_paid_at: string | null
}

const money = (n: number | null | undefined) => `R ${Number(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (d: string | null) => (d ? new Date(d.length <= 10 ? `${d}T12:00:00` : d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

export function PlatformBillingPanel() {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('platform_billing_overview')
    if (error) { setErr(error.message); return }
    setRows((data ?? []) as Row[])
  }, [])
  useEffect(() => { void load() }, [load])

  async function set(id: string, enabled: boolean | null, unlock = false) {
    setBusy(id)
    const { error } = await createClient().rpc('platform_set_company_billing', { p_company_id: id, p_enabled: enabled, p_unlock: unlock })
    if (error) setErr(error.message)
    await load()
    setBusy(null)
  }

  return (
    <div className="px-4 py-3 border-b border-divider">
      <p className="text-[14px] font-semibold text-text-primary">PayFast billing</p>
      <p className="text-[12px] text-text-secondary mb-2">
        Companies with automatic billing get a monthly bill after their trial; saved cards are charged, others get a “Pay now” email, and 7 days late makes the account read-only.
      </p>
      {err && <p className="text-[12.5px] text-error mb-2">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="text-text-secondary">
            <tr className="text-left">
              <th className="py-1.5 pr-3 font-medium">Company</th>
              <th className="py-1.5 pr-3 font-medium">Automatic billing</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 pr-3 font-medium">Card</th>
              <th className="py-1.5 pr-3 font-medium text-right">Monthly</th>
              <th className="py-1.5 pr-3 font-medium text-right">Owing</th>
              <th className="py-1.5 pr-3 font-medium">Last paid</th>
              <th className="py-1.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-divider">
                <td className="py-1.5 pr-3">{r.name}</td>
                <td className="py-1.5 pr-3">
                  <button type="button" disabled={busy === r.id} onClick={() => set(r.id, !r.billing_enabled)}
                    className={`h-7 px-2.5 rounded-md border text-[12px] font-medium ${r.billing_enabled ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'border-border text-text-secondary'}`}>
                    {r.billing_enabled ? 'On' : 'Off (billed by hand)'}
                  </button>
                </td>
                <td className="py-1.5 pr-3">
                  {r.locked_at ? <span className="text-error font-medium">Read-only since {day(r.locked_at)}</span>
                    : r.subscription_status === 'trialing' ? `Trial until ${day(r.trial_ends_at)}` : (r.subscription_status ?? '—')}
                </td>
                <td className="py-1.5 pr-3">{r.has_card ? 'Saved' : '—'}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{money(r.monthly_charge)}</td>
                <td className={`py-1.5 pr-3 text-right tabular-nums ${r.owing > 0 ? 'text-error font-medium' : ''}`}>{r.owing > 0 ? money(r.owing) : '—'}</td>
                <td className="py-1.5 pr-3">{day(r.last_paid_at)}</td>
                <td className="py-1.5">
                  {r.locked_at && (
                    <button type="button" disabled={busy === r.id} onClick={() => set(r.id, null, true)}
                      className="h-7 px-2.5 rounded-md border border-border text-[12px] font-medium">Lift read-only</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
