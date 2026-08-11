'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { Rfq, RfqStatus } from '@/types/commercial'

const STATUS_COLOURS: Record<RfqStatus, string> = {
  draft: 'bg-surface-elevated text-text-secondary',
  sent: 'bg-blue-100 text-blue-700',
  responses_received: 'bg-amber-100 text-amber-700',
  closed: 'bg-success/10 text-success',
  cancelled: 'bg-error/10 text-error',
}

const STATUS_LABELS: Record<RfqStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  responses_received: 'Responses received',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

interface RfqRow {
  id: string
  rfq_number: string | null
  title: string
  status: RfqStatus
  response_deadline: string | null
  created_at: string
  deal?: { title: string } | null
  deal_id?: string | null
}

export default function RfqListPage() {
  const router = useRouter()
  const [rfqs, setRfqs] = useState<RfqRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Not linked to a company'); setLoading(false); return }

    const { data, error: err } = await supabase
      .from('rfqs')
      .select('*, deal:client_deals(title)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })

    if (err) { setError(err.message); setLoading(false); return }
    setRfqs((data ?? []) as RfqRow[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = rfqs.filter(r => statusFilter === 'all' || r.status === statusFilter)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">Requests for Quotation</h1>
          <p className="text-[12px] text-text-secondary">{filtered.length} RFQ{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => router.push('/dashboard/supply/rfqs/new')}
          className="btn-primary h-9 px-4 text-[13px] flex items-center gap-1">
          <span className="material-icons text-[18px]">add</span>
          New RFQ
        </button>
      </div>

      {error && <div className="mx-4 mt-3 p-2 rounded bg-error/10 text-error text-[12px]">{error}</div>}

      {/* Status filter */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0 flex-wrap">
        {(['all', 'draft', 'sent', 'responses_received', 'closed', 'cancelled'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 h-7 rounded-full text-[12px] font-medium transition-colors ${statusFilter === s ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'}`}>
            {s === 'all' ? 'All' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-4">
        {loading ? (
          <p className="text-[13px] text-text-secondary py-8 text-center">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <span className="material-icons text-[48px] text-text-secondary opacity-30">request_quote</span>
            <p className="text-[13px] text-text-secondary mt-3">No RFQs yet. Create your first request for quotation.</p>
          </div>
        ) : (
          <table className="w-full" style={{ minWidth: 640 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className="data-th text-left">Number</th>
                <th className="data-th text-left">Title</th>
                <th className="data-th text-left">Project</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-left">Deadline</th>
                <th className="data-th text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(rfq => (
                <tr key={rfq.id} className="border-b border-divider hover:bg-surface-elevated/50 cursor-pointer"
                  onClick={() => router.push(`/dashboard/supply/rfqs/${rfq.id}`)}>
                  <td className="data-td text-[13px] font-mono font-medium">{rfq.rfq_number ?? '—'}</td>
                  <td className="data-td text-[13px] font-medium text-text-primary">{rfq.title}</td>
                  <td className="data-td text-[13px] text-text-secondary">
                    {(rfq.deal as { title?: string } | null)?.title ?? '—'}
                  </td>
                  <td className="data-td">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOURS[rfq.status]}`}>
                      {STATUS_LABELS[rfq.status]}
                    </span>
                  </td>
                  <td className="data-td text-[12px] text-text-secondary">{rfq.response_deadline ?? '—'}</td>
                  <td className="data-td text-[12px] text-text-secondary">{rfq.created_at.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
