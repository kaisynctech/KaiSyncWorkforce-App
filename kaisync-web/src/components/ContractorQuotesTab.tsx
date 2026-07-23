'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { quoteStatusLabel } from '@/lib/contractor-portal/quotes'

type QuoteRow = {
  id: string
  title: string | null
  quote_number: string | null
  status: string
  total_amount: number | null
  quote_type: string | null
  submitted_at: string | null
  created_at: string
  revision_comments: string | null
  hr_notes: string | null
  description: string | null
}

type QuoteItem = {
  id: string
  description: string | null
  quantity: number | null
  unit_price: number | null
  line_total: number | null
}

type QuoteAttachment = {
  id: string
  file_name: string | null
  storage_path: string | null
}

const fmtMoney = (n: number | null | undefined) =>
  `R ${Number(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`

function isReviewable(status: string) {
  return status === 'submitted' || status === 'under_review'
}

export function ContractorQuotesTab({
  companyId,
  contractorId,
}: {
  companyId: string
  contractorId: string
}) {
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [selected, setSelected] = useState<QuoteRow | null>(null)
  const [items, setItems] = useState<QuoteItem[]>([])
  const [attachments, setAttachments] = useState<QuoteAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [hrEmployeeId, setHrEmployeeId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (member) setHrEmployeeId(member.employeeId)

    const { data, error: qErr } = await supabase
      .from('contractor_quotes')
      .select('id, title, quote_number, status, total_amount, quote_type, submitted_at, created_at, revision_comments, hr_notes, description')
      .eq('company_id', companyId)
      .eq('contractor_id', contractorId)
      .order('created_at', { ascending: false })

    if (qErr) setError(qErr.message)
    setQuotes((data ?? []) as QuoteRow[])
    setLoading(false)
  }, [companyId, contractorId])

  useEffect(() => { void load() }, [load])

  async function openQuote(q: QuoteRow) {
    setSelected(q)
    setNote('')
    setError(null)
    const supabase = createClient()

    const [{ data: itemRows }, { data: attRows }] = await Promise.all([
      supabase.from('contractor_quote_items').select('id, description, quantity, unit_price, line_total').eq('quote_id', q.id),
      supabase.from('contractor_quote_attachments').select('id, file_name, storage_path').eq('quote_id', q.id),
    ])
    setItems((itemRows ?? []) as QuoteItem[])
    setAttachments((attRows ?? []) as QuoteAttachment[])

    if (q.status === 'submitted' && hrEmployeeId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('hr_start_quote_review', {
        p_company_id: companyId,
        p_hr_user_id: hrEmployeeId,
        p_quote_id: q.id,
      })
      const refreshed = { ...q, status: 'under_review' }
      setSelected(refreshed)
      setQuotes(prev => prev.map(x => x.id === q.id ? refreshed : x))
    }
  }

  async function runAction(kind: 'approve' | 'reject' | 'revise') {
    if (!selected || !hrEmployeeId) return
    if ((kind === 'reject' || kind === 'revise') && !note.trim()) {
      setError(kind === 'reject' ? 'Rejection reason is required.' : 'Revision comments are required.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)

    try {
      if (kind === 'approve') {
        const { error: e } = await rpc('hr_approve_contractor_quote', {
          p_company_id: companyId,
          p_hr_user_id: hrEmployeeId,
          p_quote_id: selected.id,
          p_hr_notes: note.trim() || null,
        })
        if (e) throw e
      } else if (kind === 'reject') {
        const { error: e } = await rpc('hr_reject_contractor_quote', {
          p_company_id: companyId,
          p_hr_user_id: hrEmployeeId,
          p_quote_id: selected.id,
          p_rejection_reason: note.trim(),
        })
        if (e) throw e
      } else {
        const { error: e } = await rpc('hr_request_quote_revision', {
          p_company_id: companyId,
          p_hr_user_id: hrEmployeeId,
          p_quote_id: selected.id,
          p_revision_comments: note.trim(),
        })
        if (e) throw e
      }
      setSelected(null)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Action failed.')
    }
    setBusy(false)
  }

  if (selected) {
    return (
      <div className="p-4 space-y-4 max-w-3xl">
        <button onClick={() => setSelected(null)} className="text-[13px] text-primary hover:opacity-70">
          ← Back to quotes
        </button>
        <div className="card p-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[16px] font-semibold text-text-primary">
                {selected.title || 'Quote'} {selected.quote_number ? `(${selected.quote_number})` : ''}
              </h3>
              <p className="text-[12px] text-text-secondary capitalize">{quoteStatusLabel(selected.status)} · {selected.quote_type || 'manual'}</p>
            </div>
            <p className="text-[16px] font-bold text-text-primary">{fmtMoney(selected.total_amount)}</p>
          </div>
          {selected.description && <p className="text-[13px] text-text-secondary">{selected.description}</p>}
          {selected.revision_comments && (
            <p className="text-[12px] text-warning">Revision: {selected.revision_comments}</p>
          )}
        </div>

        {items.length > 0 && (
          <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-surface-elevated border-b border-divider">
                  <th className="data-th text-left">Description</th>
                  <th className="data-th text-right">Qty</th>
                  <th className="data-th text-right">Unit</th>
                  <th className="data-th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.id} className="border-b border-divider last:border-0">
                    <td className="data-td">{i.description || '—'}</td>
                    <td className="data-td text-right">{i.quantity ?? '—'}</td>
                    <td className="data-td text-right">{fmtMoney(i.unit_price)}</td>
                    <td className="data-td text-right">{fmtMoney(i.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="card p-3 space-y-1">
            <p className="section-label">ATTACHMENTS</p>
            {attachments.map(a => (
              <p key={a.id} className="text-[13px] text-text-primary">{a.file_name || a.storage_path || 'File'}</p>
            ))}
          </div>
        )}

        {isReviewable(selected.status) && (
          <div className="card p-4 space-y-3">
            <p className="section-label">HR REVIEW</p>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Notes / rejection reason / revision comments"
              className="dark-entry w-full min-h-[80px]"
            />
            {error && <p className="text-[13px] text-error">{error}</p>}
            <div className="flex gap-2 flex-wrap">
              <button disabled={busy} onClick={() => runAction('approve')} className="btn-primary h-9 px-4 text-[13px]">
                Approve
              </button>
              <button disabled={busy} onClick={() => runAction('revise')} className="h-9 px-4 text-[13px] rounded-lg border border-warning text-warning">
                Request revision
              </button>
              <button disabled={busy} onClick={() => runAction('reject')} className="h-9 px-4 text-[13px] rounded-lg border border-error text-error">
                Reject
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-secondary">{quotes.length} quote{quotes.length === 1 ? '' : 's'}</p>
        <button onClick={load} className="text-[12px] text-primary hover:opacity-70">Refresh</button>
      </div>
      {error && <p className="text-[13px] text-error">{error}</p>}
      {loading ? (
        <p className="text-[13px] text-text-secondary py-8 text-center">Loading quotes…</p>
      ) : quotes.length === 0 ? (
        <p className="text-[13px] text-text-secondary py-8 text-center">No quotes from this contractor.</p>
      ) : (
        <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
          <table className="w-full text-[13px]" style={{ minWidth: 640 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">Status</th>
                <th className="data-th text-left">Title</th>
                <th className="data-th text-left">Type</th>
                <th className="data-th text-right">Total</th>
                <th className="data-th text-left">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map(q => (
                <tr
                  key={q.id}
                  className="border-b border-divider last:border-0 hover:bg-background cursor-pointer"
                  onClick={() => openQuote(q)}
                >
                  <td className="data-td capitalize">{quoteStatusLabel(q.status)}</td>
                  <td className="data-td text-primary font-medium">
                    {q.title || 'Untitled'}{q.quote_number ? ` · ${q.quote_number}` : ''}
                  </td>
                  <td className="data-td capitalize">{q.quote_type || '—'}</td>
                  <td className="data-td text-right">{fmtMoney(q.total_amount)}</td>
                  <td className="data-td text-text-secondary">
                    {q.submitted_at ? new Date(q.submitted_at).toLocaleDateString('en-ZA') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
