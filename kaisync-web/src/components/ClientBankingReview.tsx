'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Update = {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  account_holder: string | null
  bank_name: string | null
  account_number: string | null
  branch_code: string | null
  account_type: string | null
  submitted_at: string
  reviewed_at: string | null
  rejection_reason: string | null
  reviewed_by_name: string | null
}

function fmt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * HR client record → Bank details: bank details the client submitted in the portal.
 * Approve copies them into the client's bank details (audited); reject needs a reason.
 */
export function ClientBankingReview({
  companyId,
  clientId,
  onApproved,
}: {
  companyId: string
  clientId: string
  onApproved: () => void
}) {
  const [updates, setUpdates] = useState<Update[]>([])
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: e } = await (supabase.rpc as any)('hr_get_client_banking_updates', { p_company_id: companyId, p_client_id: clientId })
    if (e) { setError(e.message); return }
    setUpdates(Array.isArray(data) ? (data as Update[]) : [])
  }, [companyId, clientId])

  // Loads from the server on mount; setState happens after the await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function review(id: string, approve: boolean) {
    if (!approve && !reason.trim()) { setError('Give a reason for rejecting.'); return }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.rpc as any)('hr_review_client_banking', { p_update_id: id, p_approve: approve, p_reason: approve ? null : reason.trim() })
    if (e) setError(e.message)
    else {
      setReason('')
      await load()
      if (approve) onApproved()
    }
    setBusy(false)
  }

  const pending = updates.find(u => u.status === 'pending')
  const history = updates.filter(u => u.status !== 'pending').slice(0, 3)
  if (!pending && history.length === 0 && !error) return null

  return (
    <div className="space-y-2">
      {pending && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
          <p className="text-[13px] font-semibold text-warning">Client submitted new bank details — review required</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
            <span className="text-text-secondary">Submitted</span><span className="text-text-primary">{fmt(pending.submitted_at)}</span>
            <span className="text-text-secondary">Account holder</span><span className="text-text-primary">{pending.account_holder || '—'}</span>
            <span className="text-text-secondary">Bank</span><span className="text-text-primary">{pending.bank_name || '—'}</span>
            <span className="text-text-secondary">Account number</span><span className="text-text-primary">{pending.account_number || '—'}</span>
            <span className="text-text-secondary">Branch code</span><span className="text-text-primary">{pending.branch_code || '—'}</span>
            <span className="text-text-secondary">Account type</span><span className="text-text-primary">{pending.account_type || '—'}</span>
          </div>
          <p className="text-[11px] text-text-secondary">Check the details with the client (e.g. a bank confirmation letter) before approving.</p>
          <input
            className="dark-entry"
            placeholder="Reason (needed to reject)"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void review(pending.id, true)}
              className="h-9 px-4 rounded-lg bg-primary text-white text-[12px] font-semibold disabled:opacity-50">Approve</button>
            <button type="button" disabled={busy} onClick={() => void review(pending.id, false)}
              className="h-9 px-4 rounded-lg border border-error/40 text-error text-[12px] font-semibold disabled:opacity-50">Reject</button>
          </div>
        </div>
      )}
      {error && <p className="text-[12px] text-error">{error}</p>}
      {history.length > 0 && (
        <div className="text-[11px] text-text-secondary space-y-0.5">
          {history.map(u => (
            <p key={u.id}>
              Portal update {u.status} {fmt(u.reviewed_at)}{u.reviewed_by_name ? ` by ${u.reviewed_by_name}` : ''}
              {u.rejection_reason ? ` — ${u.rejection_reason}` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
