'use client'

/** My commission (board "The team side", 3): each order I sold, what the client has paid, what I've earned and been paid. */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getCodeSession } from '@/lib/auth/code-session'
import { formatCurrency } from '@/lib/currencies'
import { BASIS_LABEL, howWorkedOut, myCommission, totals, type CommissionRow, type CommissionBasis, type EarnedOn } from '@/lib/commission'
import { cn } from '@/lib/utils'

const R = (n: number) => formatCurrency(n, 'ZAR')
const pct = (n: number) => `${Math.round(n * 100)}%`

export default function MyCommissionPage() {
  const [rows, setRows] = useState<CommissionRow[] | null>(null)
  const [payments, setPayments] = useState<{ amount: number; paid_on: string; reference: string | null }[]>([])
  const [settings, setSettings] = useState<{ basis: CommissionBasis; earned_on: EarnedOn } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member?.employeeId) { if (live) { setError('Could not find your employee profile. Please sign in again.'); setRows([]) } return }
      const r = await myCommission(supabase, { companyId: member.companyId, employeeId: member.employeeId, sessionToken: getCodeSession()?.session_token ?? member.sessionToken ?? null })
      if (!live) return
      if (!r.ok) { setError(r.message); setRows([]); return }
      setRows(r.rows); setPayments(r.payments); setSettings(r.settings)
    })()
    return () => { live = false }
  }, [])

  const t = totals(rows ?? [])

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">My commission</h1>
          {settings && (
            <p className="text-[12.5px] text-text-secondary">
              Worked out on {BASIS_LABEL[settings.basis]} (excl. VAT), earned {settings.earned_on === 'payment' ? 'as the client pays' : 'once the client has paid in full'}.
            </p>
          )}
        </div>
        {error && <p className="text-[13px] text-error bg-error/10 rounded-lg px-3 py-2" role="alert">{error}</p>}

        {rows && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {[['Earned', t.earned], ['Paid to you', t.paid], ['Still to come', t.toPay]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border border-divider bg-surface px-3 py-2">
                <p className="text-[11.5px] text-text-secondary">{l}</p>
                <p className="text-[15px] font-semibold tabular-nums">{R(v as number)}</p>
              </div>
            ))}
          </div>
        )}

        {rows === null ? <p className="py-10 text-center text-[13px] text-text-secondary">Loading…</p> : rows.length === 0 ? (
          <div className="rounded-xl border border-divider bg-surface p-6 text-center">
            <span className="material-icons text-[36px] text-text-secondary">trending_up</span>
            <p className="text-[14px] font-semibold mt-1">No commission yet</p>
            <p className="text-[12.5px] text-text-secondary">When a quote with you as the sales rep is accepted, it shows here.</p>
          </div>
        ) : rows.map(r => (
          <section key={r.id} className="rounded-xl border border-divider bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[14px] font-semibold text-text-primary min-w-0">{[r.quote_number, r.client_name || r.quote_title].filter(Boolean).join(' · ')}</p>
              <b className="text-[14px] tabular-nums shrink-0">{R(r.commission_amount)}</b>
            </div>
            <p className="text-[12.5px] text-text-secondary">{howWorkedOut(r, R)}</p>
            <div className="mt-2 h-2 rounded-full bg-black/5 overflow-hidden" aria-label={`Client has paid ${pct(r.paid_share)}`}>
              <div className="h-full bg-emerald-500" style={{ width: pct(r.paid_share) }} />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[12.5px]">
              <span className="text-text-secondary">Client paid {pct(r.paid_share)}</span>
              <span>Earned <b className="tabular-nums">{R(r.earned)}</b></span>
              <span>Paid <b className="tabular-nums">{R(r.paid_amount)}</b></span>
              {r.to_pay > 0 && <span className={cn('font-semibold text-emerald-800')}>Due {R(r.to_pay)}</span>}
            </div>
          </section>
        ))}

        {payments.length > 0 && (
          <section className="rounded-xl border border-divider bg-surface p-3">
            <p className="text-[13px] font-semibold mb-1">Payments</p>
            {payments.map((p, i) => (
              <div key={i} className="flex justify-between text-[13px] py-1 border-t border-divider first:border-0">
                <span className="text-text-secondary">{new Date(`${p.paid_on}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}{p.reference ? ` · ${p.reference}` : ''}</span>
                <b className="tabular-nums">{R(p.amount)}</b>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
