'use client'

/** My commission (board "The team side", 3): each order I sold, what the client has paid, what I've earned and been paid. */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getCodeSession } from '@/lib/auth/code-session'
import { formatCurrency } from '@/lib/currencies'
import { BASIS_LABEL, howWorkedOut, myCommission, totals, type CommissionRow, type CommissionBasis, type EarnedOn } from '@/lib/commission'
import { MONEY_TH, MONEY_TD } from '@/components/ui/StatusFilterTabs'

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
    <div className="h-full flex flex-col">
      <div className="px-4 py-2.5 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary leading-tight">My commission</h1>
        <p className="text-[11px] text-text-secondary mt-0.5">
          {settings ? `Worked out on ${BASIS_LABEL[settings.basis]} (excl. VAT), earned ${settings.earned_on === 'payment' ? 'as the client pays' : 'once the client has paid in full'}` : ' '}
          {rows && rows.length > 0 ? ` · earned ${R(t.earned)} · paid to you ${R(t.paid)} · still to come ${R(t.toPay)}` : ''}
        </p>
      </div>
      {error && <p className="text-[12.5px] text-error bg-error/10 px-4 py-2 border-b border-divider" role="alert">{error}</p>}

      <div className="flex-1 overflow-auto">
        {rows === null ? <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p> : (
          <table className="w-full" style={{ minWidth: 720 }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>Quote</th>
                <th className={`${MONEY_TH} text-left`}>Client</th>
                <th className={`${MONEY_TH} text-left`}>Worked out on</th>
                <th className={`${MONEY_TH} text-right`}>Commission</th>
                <th className={`${MONEY_TH} text-right`}>Client paid</th>
                <th className={`${MONEY_TH} text-right`}>Earned</th>
                <th className={`${MONEY_TH} text-right`}>Paid to you</th>
                <th className={`${MONEY_TH} text-right`}>Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-divider">
                  <td className={`${MONEY_TD} font-medium text-text-primary`}>{r.quote_number ?? '—'}</td>
                  <td className={MONEY_TD}>{r.client_name || r.quote_title || '—'}</td>
                  <td className={`${MONEY_TD} text-text-secondary`}>{howWorkedOut(r, R)}</td>
                  <td className={`${MONEY_TD} text-right font-medium`}>{R(r.commission_amount)}</td>
                  <td className={`${MONEY_TD} text-right`}>{pct(r.paid_share)}</td>
                  <td className={`${MONEY_TD} text-right`}>{R(r.earned)}</td>
                  <td className={`${MONEY_TD} text-right`}>{R(r.paid_amount)}</td>
                  <td className={`${MONEY_TD} text-right font-semibold ${r.to_pay > 0 || r.on_payslip ? 'text-emerald-700' : 'text-text-secondary'}`}>{r.on_payslip ? `${R(Number(r.payslip_amount ?? 0))} on your payslip` : R(r.to_pay)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="text-center text-[13px] text-text-secondary py-10">No commission yet. When a quote with you as the sales rep is accepted, it shows here.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {payments.length > 0 && (
          <>
            <p className="px-4 pt-4 pb-1 text-[12px] font-semibold text-text-primary">Payments to you</p>
            <table className="w-full" style={{ minWidth: 420 }}>
              <thead>
                <tr className="bg-surface-elevated border-y border-divider">
                  <th className={`${MONEY_TH} text-left`}>Date</th>
                  <th className={`${MONEY_TH} text-left`}>Reference</th>
                  <th className={`${MONEY_TH} text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={i} className="border-b border-divider">
                    <td className={`${MONEY_TD} text-text-secondary`}>{new Date(`${p.paid_on}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className={MONEY_TD}>{p.reference || '—'}</td>
                    <td className={`${MONEY_TD} text-right font-medium`}>{R(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
