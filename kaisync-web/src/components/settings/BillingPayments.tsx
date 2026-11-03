'use client'

/**
 * Settings → Billing: paying KaiSync. Shows the trial, the saved card (kept by PayFast, never by us),
 * open bills with "Pay now", and the payment history. "Add card" and "Pay now" open PayFast's own
 * secure page; PayFast tells our server the result (payfast_itn), then this screen shows it.
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatZar } from '@/lib/billing'

type Overview = {
  billing_enabled: boolean
  locked_at: string | null
  lock_reason: string | null
  trial_ends_at: string | null
  subscription_status: string | null
  card: { added_at: string; added_by: string | null; mode: 'sandbox' | 'live' } | null
  open_bills: { id: string; number: string; amount: number; period_start: string; period_end: string; due_date: string; last_error: string | null; attempts: number }[]
  history: { id: string; number: string; amount: number; period_start: string; period_end: string; status: string; paid_at: string | null; paid_via: string | null; plan_name: string | null }[]
}

const day = (d: string | null | undefined) =>
  d ? new Date(d.length <= 10 ? `${d}T12:00:00` : d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const PAID_VIA: Record<string, string> = { saved_card: 'Card on file', pay_now: 'Pay now', manual: 'Recorded by KaiSync' }

/** Posts the signed fields to PayFast (a normal form post, so the browser leaves for PayFast's page). */
function goToPayFast(url: string, fields: Record<string, string>) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = url
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = k
    input.value = v
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
}

export function BillingPayments({ companyId }: { companyId: string }) {
  const [ov, setOv] = useState<Overview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null)
  const [mode, setMode] = useState<'sandbox' | 'live' | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await createClient().rpc('billing_overview', { p_company_id: companyId })
    if (error) { setMsg({ tone: 'error', text: 'Billing could not be loaded.' }); return null }
    setOv(data as Overview)
    return data as Overview
  }, [companyId])

  // Back from PayFast: PayFast tells our server separately, so wait a moment for it.
  useEffect(() => {
    let alive = true
    const p = new URLSearchParams(window.location.search)
    const back = p.get('payfast')
    void (async () => {
      const first = await load()
      if (!alive || !back) return
      if (back === 'cancelled') { setMsg({ tone: 'warn', text: 'Nothing was paid or saved — you cancelled on PayFast.' }); return }
      setMsg({ tone: 'ok', text: 'Thank you. Confirming with PayFast…' })
      const before = JSON.stringify([first?.card, first?.open_bills?.length])
      for (let i = 0; i < 10 && alive; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const now = await load()
        if (JSON.stringify([now?.card, now?.open_bills?.length]) !== before) {
          setMsg({ tone: 'ok', text: 'Done — PayFast confirmed it.' })
          break
        }
        if (i === 9) setMsg({ tone: 'warn', text: 'PayFast has not confirmed yet. This can take a few minutes; refresh in a moment.' })
      }
      const url = new URL(window.location.href)
      url.searchParams.delete('payfast'); url.searchParams.delete('ref')
      window.history.replaceState({}, '', url.toString())
    })()
    return () => { alive = false }
  }, [load])

  async function start(purpose: 'add_card' | 'pay_bill', billId?: string) {
    setBusy(billId ?? purpose)
    setMsg(null)
    const { data, error } = await createClient().functions.invoke('payfast_checkout', {
      body: { company_id: companyId, purpose, bill_id: billId, origin: window.location.origin },
    })
    const res = data as { url?: string; fields?: Record<string, string>; mode?: 'sandbox' | 'live'; message?: string } | null
    if (error || !res?.url || !res.fields) {
      let text = res?.message ?? 'Could not open PayFast. Try again.'
      try { const body = await (error as { context?: Response })?.context?.json?.(); if (body?.message) text = body.message } catch { /* keep default */ }
      setMsg({ tone: 'error', text })
      setBusy(null)
      return
    }
    setMode(res.mode ?? null)
    goToPayFast(res.url, res.fields)
  }

  if (!ov) return msg ? <Note tone={msg.tone} text={msg.text} /> : null
  if (!ov.billing_enabled) {
    return (
      <div className="rounded-lg border border-border p-4 text-[13px] text-text-secondary">
        Your subscription is billed by KaiSync directly. Contact KaiSync about payments.
      </div>
    )
  }

  const trialLeft = ov.trial_ends_at ? Math.ceil((new Date(ov.trial_ends_at).getTime() - Date.now()) / 86_400_000) : null
  const inTrial = ov.subscription_status === 'trialing' && trialLeft !== null && trialLeft > 0

  return (
    <div className="flex flex-col gap-4">
      {msg && <Note tone={msg.tone} text={msg.text} />}
      {ov.locked_at && (
        <Note tone="error" text={`Your account is read-only because a bill is more than 7 days late${ov.lock_reason ? ` (${ov.lock_reason.replace('Unpaid KaiSync bill ', '')})` : ''}. Pay below to open it again straight away.`} />
      )}

      {/* Open bills first: this is what needs doing. */}
      {ov.open_bills.map(b => (
        <div key={b.id} className="rounded-lg border-2 border-[#1E3A5F]/30 bg-[#1E3A5F]/[0.03] p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[12px] text-text-secondary uppercase tracking-wide">Due {day(b.due_date)} · {b.number}</p>
            <p className="text-[24px] font-semibold text-text-primary">{formatZar(Number(b.amount))}</p>
            <p className="text-[12.5px] text-text-secondary">For {day(b.period_start)} – {day(b.period_end)}</p>
            {b.last_error && <p className="text-[12.5px] text-error mt-1">The card on file did not go through: {b.last_error}</p>}
          </div>
          <button
            type="button"
            onClick={() => start('pay_bill', b.id)}
            disabled={busy !== null}
            className="h-10 px-5 rounded-md bg-[#1E3A5F] text-white text-[13.5px] font-semibold disabled:opacity-50"
          >
            {busy === b.id ? 'Opening PayFast…' : 'Pay now'}
          </button>
        </div>
      ))}

      <div className="rounded-lg border border-border p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="material-icons text-[22px] text-slate-500 mt-0.5">credit_card</span>
          <div>
            {ov.card ? (
              <>
                <p className="text-[14px] font-semibold text-text-primary">Card on file</p>
                <p className="text-[12.5px] text-text-secondary">
                  Saved {day(ov.card.added_at)}{ov.card.added_by ? ` by ${ov.card.added_by}` : ''}. Charged automatically each month. PayFast keeps the card details; KaiSync never sees them.
                </p>
              </>
            ) : (
              <>
                <p className="text-[14px] font-semibold text-text-primary">No card saved</p>
                <p className="text-[12.5px] text-text-secondary">
                  {inTrial
                    ? `Your free trial ends ${day(ov.trial_ends_at)} (${trialLeft} day${trialLeft === 1 ? '' : 's'} left). Save a card now so nothing stops when it ends — you are not charged until then.`
                    : 'Save a card and the subscription is paid automatically each month. Otherwise you will get a “Pay now” link by email.'}
                </p>
              </>
            )}
            {(ov.card?.mode === 'sandbox' || mode === 'sandbox') && (
              <p className="text-[11.5px] mt-1 inline-flex items-center gap-1 rounded bg-amber-100 text-amber-900 px-1.5 py-0.5">
                Test mode: PayFast sandbox, test cards only, no real money
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => start('add_card')}
          disabled={busy !== null}
          className="h-9 px-4 rounded-md border border-border text-[13px] font-semibold text-text-primary hover:bg-surface-elevated disabled:opacity-50"
        >
          {busy === 'add_card' ? 'Opening PayFast…' : ov.card ? 'Replace card' : 'Add a card'}
        </button>
      </div>

      {ov.history.length > 0 && (
        <div>
          <p className="text-[12px] text-text-secondary uppercase tracking-wide mb-2">Bills</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-elevated text-text-secondary">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Bill</th>
                  <th className="text-left px-3 py-2 font-medium">Period</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                  <th className="text-left px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {ov.history.map(h => (
                  <tr key={h.id} className="border-t border-divider">
                    <td className="px-3 py-2 whitespace-nowrap">{h.number}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{day(h.period_start)} – {day(h.period_end)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatZar(Number(h.amount))}</td>
                    <td className="px-3 py-2">
                      {h.status === 'paid'
                        ? <span className="text-success font-medium">Paid {day(h.paid_at)}{h.paid_via ? ` · ${PAID_VIA[h.paid_via] ?? h.paid_via}` : ''}</span>
                        : <span className="text-warning font-medium">Unpaid</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Note({ tone, text }: { tone: 'ok' | 'warn' | 'error'; text: string }) {
  const cls = tone === 'ok' ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
    : tone === 'warn' ? 'bg-amber-50 text-amber-900 border-amber-200'
      : 'bg-red-50 text-red-900 border-red-200'
  return <p className={`rounded-lg border px-3 py-2 text-[13px] ${cls}`}>{text}</p>
}
