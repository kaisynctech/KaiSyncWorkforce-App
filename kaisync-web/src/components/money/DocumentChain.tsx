'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { fmtMoney } from '@/lib/finance-calc'
import { cn } from '@/lib/utils'

/**
 * The chain at the top of a quotation, invoice or credit note:
 * Quotation → Order → POs → Invoice(s) → Payments → Credit notes. Tap a step to open it.
 * Read-only; shows nothing when the document stands alone.
 */

type Current = { kind: 'quote' | 'invoice' | 'credit_note'; id: string }
type Step = { key: string; label: string; href?: string; tone: 'done' | 'open' | 'muted'; current?: boolean }

const PAID = new Set(['paid'])
const DEAD = new Set(['voided', 'cancelled'])

export function DocumentChain({ current, companyId }: { current: Current; companyId: string | null }) {
  const [steps, setSteps] = useState<Step[] | null>(null)

  useEffect(() => {
    if (!companyId || !current.id) return
    let live = true
    void (async () => {
      try {
        const supabase = createClient()
        let quoteId: string | null = null
        let invoiceId: string | null = null
        if (current.kind === 'quote') quoteId = current.id
        if (current.kind === 'invoice') invoiceId = current.id
        if (current.kind === 'credit_note') {
          const { data: cn } = await supabase.from('credit_notes').select('invoice_id').eq('id', current.id).eq('company_id', companyId).maybeSingle()
          invoiceId = (cn as { invoice_id: string | null } | null)?.invoice_id ?? null
        }
        if (invoiceId && !quoteId) {
          const { data: inv } = await supabase.from('finance_invoices').select('quote_id').eq('id', invoiceId).eq('company_id', companyId).maybeSingle()
          quoteId = (inv as { quote_id: string | null } | null)?.quote_id ?? null
        }

        type Q = { id: string; quote_number: string | null; status: string | null }
        type I = { id: string; invoice_number: string | null; status: string | null; currency: string | null; balance_due: number | null }
        let quote: Q | null = null
        let invoices: I[] = []
        let poCount = 0
        if (quoteId) {
          const [qRes, iRes, poRes] = await Promise.all([
            supabase.from('commercial_quotes').select('id, quote_number, status').eq('id', quoteId).eq('company_id', companyId).maybeSingle(),
            supabase.from('finance_invoices').select('id, invoice_number, status, currency, balance_due').eq('quote_id', quoteId).eq('company_id', companyId).order('created_at'),
            supabase.from('purchase_orders').select('id', { count: 'exact', head: true }).eq('quote_id', quoteId).eq('company_id', companyId),
          ])
          quote = (qRes.data as Q | null) ?? null
          invoices = (iRes.data ?? []) as I[]
          poCount = poRes.count ?? 0
        } else if (invoiceId) {
          const { data } = await supabase.from('finance_invoices').select('id, invoice_number, status, currency, balance_due').eq('id', invoiceId).eq('company_id', companyId).maybeSingle()
          invoices = data ? [data as I] : []
        }
        const live_ = invoices.filter(i => !DEAD.has(String(i.status)))
        const ids = live_.map(i => i.id)
        let paidTotal = 0
        let payCount = 0
        let cns: { id: string; credit_note_number: string | null }[] = []
        if (ids.length) {
          const [txRes, cnRes] = await Promise.all([
            supabase.from('finance_transactions').select('amount').eq('company_id', companyId).eq('source_table', 'finance_invoices').eq('direction', 'incoming').in('source_id', ids),
            supabase.from('credit_notes').select('id, credit_note_number').eq('company_id', companyId).in('invoice_id', ids).order('created_at'),
          ])
          const tx = (txRes.data ?? []) as { amount: number | null }[]
          payCount = tx.length
          paidTotal = tx.reduce((s, t) => s + Number(t.amount ?? 0), 0)
          cns = (cnRes.data ?? []) as { id: string; credit_note_number: string | null }[]
        }

        const out: Step[] = []
        if (quote) {
          out.push({ key: 'q', label: `Quotation ${quote.quote_number ?? ''}`.trim(), href: `/dashboard/money/quotes/${quote.id}`,
            tone: quote.status === 'accepted' ? 'done' : 'open', current: current.kind === 'quote' })
          if (quote.status === 'accepted') out.push({ key: 'o', label: 'Order', href: `/dashboard/money/orders/${quote.id}`, tone: 'done' })
          if (poCount > 0) out.push({ key: 'po', label: `${poCount} PO${poCount === 1 ? '' : 's'}`, href: `/dashboard/money/orders/${quote.id}`, tone: 'done' })
        }
        for (const i of live_) {
          out.push({ key: `i:${i.id}`, label: `Invoice ${i.invoice_number ?? '(draft)'}`, href: `/dashboard/money/invoices/${i.id}`,
            tone: PAID.has(String(i.status)) ? 'done' : 'open', current: current.kind === 'invoice' && current.id === i.id })
        }
        if (live_.length) {
          const owed = live_.reduce((s, i) => s + Number(i.balance_due ?? 0), 0)
          const cur = live_[0]?.currency ?? null
          out.push({ key: 'pay',
            label: payCount === 0 ? 'Payment · waiting' : owed > 0.004 ? `Paid ${fmtMoney(paidTotal, cur)} · ${fmtMoney(owed, cur)} to go` : `Paid ${fmtMoney(paidTotal, cur)}`,
            tone: payCount === 0 ? 'muted' : owed > 0.004 ? 'open' : 'done' })
        }
        for (const c of cns) {
          out.push({ key: `cn:${c.id}`, label: `Credit note ${c.credit_note_number ?? ''}`.trim(), href: `/dashboard/money/credit-notes/${c.id}`,
            tone: 'done', current: current.kind === 'credit_note' && current.id === c.id })
        }
        if (live) setSteps(out)
      } catch (e) {
        console.error('document chain failed', e)
        if (live) setSteps([])
      }
    })()
    return () => { live = false }
  }, [companyId, current.kind, current.id])

  if (!steps || steps.length < 2) return null

  return (
    <nav aria-label="Where this document fits" className="flex flex-wrap items-center gap-1.5">
      {steps.map((s, i) => {
        const cls = cn('inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-semibold whitespace-nowrap border',
          s.current ? 'bg-primary border-primary text-white'
            : s.tone === 'done' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : s.tone === 'open' ? 'bg-blue-50 border-blue-200 text-blue-800'
                : 'bg-surface border-divider text-text-secondary')
        const body = <>{s.tone === 'done' && !s.current && <span className="material-icons text-[14px]">check</span>}{s.label}</>
        return (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="material-icons text-[16px] text-text-secondary/60" aria-hidden>chevron_right</span>}
            {s.href && !s.current
              ? <Link href={s.href} prefetch={false} className={cn(cls, 'hover:opacity-80')}>{body}</Link>
              : <span className={cls} aria-current={s.current ? 'page' : undefined}>{body}</span>}
          </span>
        )
      })}
    </nav>
  )
}
