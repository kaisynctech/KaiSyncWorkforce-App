'use client'

/**
 * Settings → Billing: choose Starter or Business, monthly or annual (10% off).
 * Each card shows what that plan would cost this company today, with its real counts.
 * During the trial the choice applies when the trial ends. After that: a bigger plan applies now and the
 * difference for the rest of the period is billed straight away; a smaller plan or a cycle change applies
 * from the next renewal (no refunds mid-year). Starter can't be chosen with more than 15 active employees.
 */

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  changePlan, formatZar, PLAN_LABEL, quotePlan,
  type BillingCycle, type BillingSummary, type PlanCode, type PlanQuote,
} from '@/lib/billing'

const PLANS: { code: PlanCode; blurb: string }[] = [
  { code: 'starter', blurb: 'Up to 15 employees, 5 contractor and 5 client portal seats. Every module.' },
  { code: 'kaiflow_standard', blurb: '25 employees, 15 contractor and 15 client portal seats. R49 per extra employee. Every module.' },
]

const day = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

export function PlanPicker({ companyId, summary, canManage, preselect, onChanged }: {
  companyId: string
  summary: BillingSummary
  canManage: boolean
  /** From ?plan= (the "Move to Business" button). */
  preselect?: PlanCode | null
  onChanged: () => void
}) {
  const trial = summary.status === 'trialing'
  const currentPlan = (summary.plan_code ?? 'kaiflow_standard') as PlanCode
  const currentCycle = (summary.billing_cycle ?? 'monthly') as BillingCycle
  const [cycle, setCycle] = useState<BillingCycle>(currentCycle)
  // The "Move to Business" button opens this tab with ?plan=kaiflow_standard.
  const [pick, setPick] = useState<PlanCode>(() => {
    const fromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('plan') : null
    return preselect ?? (fromUrl === 'starter' || fromUrl === 'kaiflow_standard' ? fromUrl : currentPlan)
  })
  const [quotes, setQuotes] = useState<Record<string, PlanQuote | null>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const counts = useMemo(() => ({
    employees: summary.employees.count, contractors: summary.contractors.count, clientPortals: summary.client_portals.count,
    properties: summary.properties.count, farms: summary.farms.count,
  }), [summary])

  useEffect(() => {
    let off = false
    const supabase = createClient()
    void Promise.all(PLANS.map(p => quotePlan(supabase, { planCode: p.code, cycle, ...counts }))).then(qs => {
      if (!off) setQuotes(Object.fromEntries(PLANS.map((p, i) => [p.code, qs[i]])))
    })
    return () => { off = true }
  }, [cycle, counts])

  const starterLimit = 15
  const tooManyForStarter = counts.employees > starterLimit
  const unchanged = pick === currentPlan && cycle === currentCycle && (!trial || summary.plan_chosen)
  const pickedQuote = quotes[pick]
  const bigger = !trial && pick === 'kaiflow_standard' && currentPlan === 'starter'
  const renewalDate = currentCycle === 'annual' && summary.annual_period_end
    ? day(new Date(new Date(`${summary.annual_period_end}T12:00:00`).getTime() + 86400000).toISOString())
    : day(summary.next_billing_date)

  const whenText = trial
    ? `From the end of your free trial${summary.trial_ends_at ? ` (${day(summary.trial_ends_at)})` : ''}. Nothing is charged now.`
    : bigger
      ? currentCycle === 'annual'
        ? 'Straight away. The unused part of your Starter year is credited, and you pay only the difference for the rest of the year.'
        : 'Straight away. You pay only the difference for the rest of this month.'
      : `From your next renewal${renewalDate ? ` on ${renewalDate}` : ''}. No refunds for the current period.`

  async function confirm() {
    setBusy(true); setResult(null)
    const r = await changePlan(createClient(), companyId, pick, cycle)
    setBusy(false)
    if (!r.ok) { setResult({ ok: false, text: r.message }); return }
    const label = `${PLAN_LABEL[pick]}, ${cycle === 'annual' ? 'annual' : 'monthly'}`
    setResult({
      ok: true,
      text: r.when === 'trial_end' ? `${label} is saved. It starts when your free trial ends.`
        : r.when === 'now' ? `You're now on ${label}.${r.amount ? ` ${formatZar(r.amount)} for the rest of the period has been added as a bill below.` : ''}`
        : `${label} starts at your next renewal${r.from ? ` on ${day(r.from)}` : ''}.`,
    })
    onChanged()
  }

  return (
    <div className="rounded-lg border border-border p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] text-text-secondary uppercase tracking-wide">Your plan</p>
          <p className="text-[16px] font-semibold text-text-primary mt-0.5">
            {trial && !summary.plan_chosen ? 'Free trial: choose your plan' : `${PLAN_LABEL[currentPlan] ?? summary.plan_name}, ${currentCycle === 'annual' ? 'paid annually' : 'paid monthly'}`}
          </p>
          {trial && !summary.plan_chosen && (
            <p className="text-[12.5px] text-text-secondary mt-0.5">If you don&apos;t choose, you&apos;ll go on the plan that fits your team ({PLAN_LABEL[currentPlan]}), paid monthly.</p>
          )}
          {summary.price_override != null && (
            <p className="text-[12.5px] text-emerald-800 mt-1">Your agreed price of {formatZar(Number(summary.price_override))} a month applies on any plan.</p>
          )}
          {summary.pending_plan_code || summary.pending_cycle ? (
            <p className="text-[12.5px] text-amber-800 mt-1">
              From your next renewal: {PLAN_LABEL[summary.pending_plan_code ?? currentPlan]}, {(summary.pending_cycle ?? currentCycle) === 'annual' ? 'annual' : 'monthly'}.
            </p>
          ) : null}
        </div>
        <div className="inline-flex rounded-lg border border-divider p-0.5 bg-surface-elevated" role="group" aria-label="Billing cycle">
          {(['monthly', 'annual'] as BillingCycle[]).map(c => (
            <button key={c} type="button" onClick={() => setCycle(c)} disabled={!canManage}
              className={`h-8 px-3 rounded-md text-[12.5px] font-medium ${cycle === c ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary'}`}>
              {c === 'monthly' ? 'Monthly' : 'Annual · 10% off'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {PLANS.map(p => {
          const q = quotes[p.code]
          const disabled = p.code === 'starter' && tooManyForStarter
          const isCurrent = p.code === currentPlan && (!trial || summary.plan_chosen)
          return (
            <button key={p.code} type="button" disabled={disabled || !canManage} onClick={() => setPick(p.code)}
              className={`text-left rounded-xl border p-4 flex flex-col gap-1.5 transition-colors disabled:opacity-60 ${pick === p.code ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-divider hover:bg-surface-elevated'}`}>
              <span className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold text-text-primary">{PLAN_LABEL[p.code]}</span>
                {isCurrent && <span className="text-[11px] font-semibold text-primary bg-primary/10 rounded-full px-2 py-0.5">Current</span>}
              </span>
              <span className="text-[13px] text-text-primary">
                {p.code === 'starter' ? 'R1,500' : 'R2,500'}/month{cycle === 'annual' ? ` · ${p.code === 'starter' ? 'R16,200' : 'R27,000'}/year` : ''}
              </span>
              <span className="text-[12px] text-text-secondary leading-snug">{p.blurb}</span>
              <span className="text-[12.5px] text-text-primary mt-1">
                {disabled ? `You have ${counts.employees} active employees; Starter is for up to 15.`
                  : q ? <>For your company today: <strong>{formatZar(q.total)}</strong>{cycle === 'annual' ? ' a year' : ' a month'}</> : 'Working it out…'}
              </span>
            </button>
          )
        })}
      </div>

      {pickedQuote && (
        <div className="rounded-lg bg-surface-elevated px-3 py-2.5 flex flex-col gap-1 text-[12.5px]">
          {pickedQuote.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-3"><span className="text-text-secondary">{l.description}{cycle === 'annual' ? ' × 12' : ''}</span><span className="text-text-primary shrink-0">{formatZar(Number(l.amount) * (cycle === 'annual' ? 12 : 1))}</span></div>
          ))}
          {pickedQuote.discount > 0 && (
            <div className="flex justify-between gap-3"><span className="text-emerald-700">{pickedQuote.discount_label}</span><span className="text-emerald-700 shrink-0">−{formatZar(pickedQuote.discount)}</span></div>
          )}
          {pickedQuote.vat > 0 && <div className="flex justify-between gap-3"><span className="text-text-secondary">VAT</span><span className="shrink-0">{formatZar(pickedQuote.vat)}</span></div>}
          <div className="flex justify-between gap-3 border-t border-divider pt-1 font-semibold text-text-primary">
            <span>Total {cycle === 'annual' ? 'per year' : 'per month'}</span><span>{formatZar(pickedQuote.total)}</span>
          </div>
        </div>
      )}

      {canManage && !unchanged && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12.5px] text-text-secondary flex-1 min-w-[220px]">{whenText}</p>
          <button type="button" disabled={busy || (pick === 'starter' && tooManyForStarter)} onClick={() => void confirm()}
            className="h-10 px-5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50">
            {busy ? 'Saving…' : `${trial ? 'Choose' : 'Switch to'} ${PLAN_LABEL[pick]}, ${cycle === 'annual' ? 'annual' : 'monthly'}`}
          </button>
        </div>
      )}
      {!canManage && <p className="text-[12px] text-text-secondary">Only the owner, HR and admins can change the plan.</p>}
      {result && <p className={`text-[13px] ${result.ok ? 'text-emerald-700' : 'text-error'}`}>{result.text}</p>}
    </div>
  )
}
