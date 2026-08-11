'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { fmtMoney } from '@/lib/finance-calc'

type CreditNoteRow = {
  id: string
  credit_note_number: string | null
  status: string
  reason_code: string | null
  total_amount: number
  issue_date: string | null
  clients: { name: string } | null
  finance_invoices: { invoice_number: string | null } | null
}

const STATUS_BADGE: Record<string, string> = {
  draft:             'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending_approval:  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  approved:          'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  applied:           'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  voided:            'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-500'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export default function CreditNotesPage() {
  const [rows, setRows]       = useState<CreditNoteRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    const { data } = await supabase
      .from('credit_notes')
      .select('id, credit_note_number, status, reason_code, total_amount, issue_date, clients(name), finance_invoices(invoice_number)')
      .eq('company_id', member.companyId)
      .order('created_at', { ascending: false })
    setRows((data ?? []) as unknown as CreditNoteRow[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">Credit Notes</h1>
        <p className="text-[12px] text-text-secondary">Issue from an invoice detail page</p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : (
          <table className="w-full" style={{ minWidth: 680 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider sticky top-0">
                <th className="data-th text-left">#</th>
                <th className="data-th text-left">Invoice</th>
                <th className="data-th text-left">Client</th>
                <th className="data-th text-left">Reason</th>
                <th className="data-th text-right">Amount</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-divider hover:bg-surface-elevated transition-colors">
                  <td className="data-td text-[13px] font-medium text-text-primary">
                    {r.credit_note_number || <span className="text-text-disabled italic">draft</span>}
                  </td>
                  <td className="data-td text-[13px] text-text-secondary">
                    {(r.finance_invoices as { invoice_number: string | null } | null)?.invoice_number ?? '—'}
                  </td>
                  <td className="data-td text-[13px] text-text-secondary">
                    {(r.clients as { name: string } | null)?.name ?? '—'}
                  </td>
                  <td className="data-td text-[13px] text-text-secondary capitalize">
                    {(r.reason_code ?? '—').replace(/_/g, ' ')}
                  </td>
                  <td className="data-td text-[13px] text-right font-medium text-text-primary">
                    {fmtMoney(r.total_amount)}
                  </td>
                  <td className="data-td"><StatusBadge status={r.status} /></td>
                  <td className="data-td text-[13px] text-text-secondary">{r.issue_date ?? '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-[13px] text-text-secondary py-14">
                    <span className="material-icons text-[32px] text-text-disabled block mb-1">undo</span>
                    No credit notes yet — issue one from an invoice
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
