'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'

type CreditNoteDetail = {
  id: string
  credit_note_number: string | null
  status: string
  reason_code: string | null
  reason_notes: string | null
  total_amount: number
  subtotal: number
  vat_amount: number
  issue_date: string | null
  invoice_id: string | null
  clients: { name: string } | null
  finance_invoices: { invoice_number: string | null } | null
}

type CreditLine = {
  id: string
  description: string
  quantity: number
  unit_price: number
  vat_amount: number
  total_amount: number
}

const STATUS_BADGE: Record<string, string> = {
  draft:             'bg-slate-100 text-slate-700',
  pending_approval:  'bg-blue-100 text-blue-700',
  approved:          'bg-green-100 text-green-700',
  applied:           'bg-purple-100 text-purple-700',
  voided:            'bg-gray-100 text-gray-500',
}

export default function CreditNoteDetailPage() {
  return (
    <Suspense fallback={<p className="p-6 text-[13px] text-text-secondary">Loading…</p>}>
      <CreditNoteDetailInner />
    </Suspense>
  )
}

function CreditNoteDetailInner() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const openWhatsNext = searchParams.get('whats_next') === '1'

  const [cn, setCn] = useState<CreditNoteDetail | null>(null)
  const [lines, setLines] = useState<CreditLine[]>([])
  const [loading, setLoading] = useState(true)
  const [showWhatsNext, setShowWhatsNext] = useState(openWhatsNext)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    const [{ data }, { data: lineRows }] = await Promise.all([
      supabase
        .from('credit_notes')
        .select('id, credit_note_number, status, reason_code, reason_notes, total_amount, subtotal, vat_amount, issue_date, invoice_id, clients(name), finance_invoices(invoice_number)')
        .eq('id', id)
        .eq('company_id', member.companyId)
        .maybeSingle(),
      supabase
        .from('credit_note_lines')
        .select('id, description, quantity, unit_price, vat_amount, total_amount')
        .eq('credit_note_id', id)
        .order('created_at'),
    ])
    setCn(data as unknown as CreditNoteDetail | null)
    setLines((lineRows ?? []) as CreditLine[])
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (openWhatsNext) setShowWhatsNext(true)
  }, [openWhatsNext])

  if (loading) return <p className="p-6 text-[13px] text-text-secondary">Loading…</p>
  if (!cn) {
    return (
      <div className="p-6">
        <p className="text-[13px] text-text-secondary mb-3">Credit note not found.</p>
        <button onClick={() => router.push('/dashboard/money/credit-notes')} className="btn-primary h-9 px-4 text-[13px]">
          Back
        </button>
      </div>
    )
  }

  const badge = STATUS_BADGE[cn.status] ?? 'bg-gray-100 text-gray-500'

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 space-y-5 pb-10">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => router.push('/dashboard/money/credit-notes')}
            className="flex items-center gap-1 text-[13px] text-primary hover:underline"
          >
            <span className="material-icons text-[16px]">arrow_back</span>Credit notes
          </button>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium capitalize ${badge}`}>
            {cn.status.replace(/_/g, ' ')}
          </span>
        </div>

        <div className="bg-surface-card border border-divider rounded-xl p-4 space-y-1">
          <h1 className="text-[20px] font-semibold text-text-primary">
            {cn.credit_note_number || <span className="text-text-disabled italic">Draft credit note</span>}
          </h1>
          <p className="text-[13px] text-text-secondary">
            <span className="font-medium text-text-primary">{(cn.clients as { name: string } | null)?.name ?? '—'}</span>
            {cn.invoice_id && (
              <>
                {' · '}
                <Link href={`/dashboard/money/invoices/${cn.invoice_id}`} className="text-primary hover:underline">
                  Invoice {(cn.finance_invoices as { invoice_number: string | null } | null)?.invoice_number ?? 'linked'}
                </Link>
              </>
            )}
          </p>
          <p className="text-[12px] text-text-secondary pt-1">
            Issued: {cn.issue_date ?? '—'}
            {cn.reason_code ? ` · ${(cn.reason_code).replace(/_/g, ' ')}` : ''}
          </p>
          {cn.reason_notes && (
            <p className="text-[13px] text-text-secondary pt-2">{cn.reason_notes}</p>
          )}
        </div>

        {lines.length > 0 && (
          <div className="bg-surface-card border border-divider rounded-xl overflow-hidden">
            <p className="px-4 py-2.5 text-[12px] font-semibold text-text-secondary uppercase tracking-wide border-b border-divider">
              Lines
            </p>
            <table className="w-full" style={{ minWidth: 480 }}>
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left">Description</th>
                  <th className="data-th text-right">Qty</th>
                  <th className="data-th text-right">Unit</th>
                  <th className="data-th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(l => (
                  <tr key={l.id} className="border-b border-divider last:border-0">
                    <td className="data-td text-[13px]">{l.description}</td>
                    <td className="data-td text-[13px] text-right">{l.quantity}</td>
                    <td className="data-td text-[13px] text-right">{fmtMoney(l.unit_price)}</td>
                    <td className="data-td text-[13px] text-right font-medium">{fmtMoney(l.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-surface-card border border-divider rounded-xl p-4 space-y-2 text-[13px]">
          <div className="flex justify-between"><span className="text-text-secondary">Subtotal</span><span>{fmtMoney(cn.subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-text-secondary">VAT</span><span>{fmtMoney(cn.vat_amount)}</span></div>
          <div className="flex justify-between font-semibold border-t border-divider pt-2"><span>Total</span><span>{fmtMoney(cn.total_amount)}</span></div>
        </div>
      </div>

      {showWhatsNext && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="relative bg-surface rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h3 className="text-[15px] font-semibold text-text-primary mb-1">What&apos;s next?</h3>
            <p className="text-[13px] text-text-secondary mb-5">
              Credit note created as a draft. Return to the invoice or stay here.
            </p>
            <div className="flex flex-col gap-2">
              {cn.invoice_id && (
                <button
                  type="button"
                  onClick={() => router.push(`/dashboard/money/invoices/${cn.invoice_id}`)}
                  className="h-10 px-4 rounded-lg bg-primary text-white text-left text-[13px] font-medium hover:bg-primary/90 transition-colors"
                >
                  Back to invoice
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push('/dashboard/money/credit-notes')}
                className="h-10 px-4 rounded-lg border border-divider text-left text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors"
              >
                All credit notes
              </button>
              <button
                type="button"
                onClick={() => setShowWhatsNext(false)}
                className="h-10 px-4 rounded-lg text-[13px] text-text-secondary hover:bg-surface-elevated transition-colors"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
