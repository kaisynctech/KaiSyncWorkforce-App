'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getGrade, setGrade, type GradeInfo, type PartyKind } from '@/lib/compliance/party'

/** Internal A–D risk grade (with reason and history) on a contractor or client. Never shown to them. */
export function ComplianceGradeBox({ companyId, kind, partyId }: { companyId: string; kind: PartyKind; partyId: string }) {
  const [data, setData] = useState<GradeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [grade, setG] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setData(await getGrade(createClient(), companyId, kind, partyId)) }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not load the grade.') }
  }, [companyId, kind, partyId])

  // Loads from the server on mount; setState happens after the await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function save() {
    setBusy(true); setError(null)
    try { await setGrade(createClient(), companyId, kind, partyId, grade || null, reason.trim()); setOpen(false); setReason(''); await load() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not save the grade.') }
    setBusy(false)
  }

  if (!data) return error ? <p className="text-[12px] text-error">{error}</p> : null

  return (
    <div className="card p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="section-label">HR RISK GRADE (INTERNAL)</p>
        {data.set_at && <p className="text-[11px] text-text-secondary">Set {new Date(data.set_at).toLocaleDateString('en-ZA')}</p>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[24px] font-bold text-text-primary">{data.grade ?? '—'}</span>
        {data.can_edit && (
          <button type="button" className="text-[12px] text-primary hover:underline" onClick={() => { setOpen(v => !v); setG(data.grade ?? '') }}>
            {data.grade ? 'Change' : 'Set grade'}
          </button>
        )}
        {data.history.length > 0 && (
          <button type="button" className="text-[12px] text-text-secondary hover:underline" onClick={() => setShowHistory(v => !v)}>History</button>
        )}
      </div>
      {data.reason && <p className="text-[11px] text-text-secondary">{data.reason}</p>}
      <p className="text-[10px] text-text-secondary">A = low risk, D = high risk. Never shown to the {kind}.</p>
      {error && <p className="text-[12px] text-error">{error}</p>}
      {open && (
        <div className="space-y-2">
          <div className="flex gap-1">
            {['A', 'B', 'C', 'D', ''].map(g => (
              <button key={g || 'none'} type="button" onClick={() => setG(g)}
                className={`h-8 min-w-8 px-2 rounded-lg border text-[12px] font-semibold ${grade === g ? 'bg-primary text-white border-primary' : 'border-border text-text-primary'}`}>
                {g || 'Clear'}
              </button>
            ))}
          </div>
          <input className="dark-entry" placeholder="Reason (required)" value={reason} onChange={e => setReason(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !reason.trim()} onClick={() => void save()}
              className="h-8 px-3 rounded-lg bg-primary text-white text-[12px] font-semibold disabled:opacity-50">Save grade</button>
            <button type="button" onClick={() => setOpen(false)} className="h-8 px-3 rounded-lg border border-border text-[12px]">Cancel</button>
          </div>
        </div>
      )}
      {showHistory && data.history.map((h, i) => (
        <p key={i} className="text-[11px] text-text-secondary">
          <span className="font-semibold text-text-primary">{h.grade ?? 'cleared'}</span> · {new Date(h.set_at).toLocaleDateString('en-ZA')}
          {h.set_by_name ? ` · ${h.set_by_name}` : ''} — {h.reason}
        </p>
      ))}
    </div>
  )
}
