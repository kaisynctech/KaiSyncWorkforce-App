'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getOverview, type OverviewRow, type PartyKind } from '@/lib/compliance/party'

type Status = 'not_configured' | 'compliant' | 'partial' | 'non_compliant'
const STATUS_LABEL: Record<Status, string> = {
  not_configured: 'No pack', compliant: 'Compliant', partial: 'At risk', non_compliant: 'Non-compliant',
}
const TONE: Record<Status, string> = {
  not_configured: 'text-text-secondary', compliant: 'text-success', partial: 'text-warning', non_compliant: 'text-error',
}

function scoreOf(r: OverviewRow): number | null {
  if (!r.pack_id || r.required_count === 0) return null
  return Math.round((r.complete_count / r.required_count) * 100)
}
function statusOf(r: OverviewRow): Status {
  const s = scoreOf(r)
  if (s == null) return 'not_configured'
  if (s >= 100) return 'compliant'
  if (s >= 50) return 'partial'
  return 'non_compliant'
}

/** Compliance overview for clients and contractors — one system, same packs and documents. */
export default function ComplianceOverviewPage() {
  const [kind, setKind] = useState<PartyKind>('contractor')
  const [rows, setRows] = useState<Record<PartyKind, OverviewRow[] | null>>({ client: null, contractor: null })
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'attention' | 'review' | 'expiring' | 'unassigned'>('all')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    try {
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('Your account is not linked to a company.'); return }
      const [cl, co] = await Promise.all([
        getOverview(supabase, member.companyId, 'client').catch(() => [] as OverviewRow[]),
        getOverview(supabase, member.companyId, 'contractor').catch(() => [] as OverviewRow[]),
      ])
      setRows({ client: cl, contractor: co })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load compliance.')
      setRows({ client: [], contractor: [] })
    }
  }, [])

  // Loads from the server on mount; setState happens after the await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const shown = rows[kind]
  const filtered = useMemo(() => (shown ?? []).filter(r => {
    if (q && !`${r.name} ${r.code ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false
    const st = statusOf(r)
    if (filter === 'attention') return st === 'non_compliant' || st === 'partial' || r.expired_count > 0
    if (filter === 'review') return r.pending_count > 0
    if (filter === 'expiring') return r.expiring_count > 0 || r.expired_count > 0
    if (filter === 'unassigned') return !r.pack_id
    return true
  }), [shown, filter, q])

  const counts = useMemo(() => {
    const r = shown ?? []
    return {
      assigned: r.filter(x => x.pack_id).length,
      compliant: r.filter(x => statusOf(x) === 'compliant').length,
      review: r.reduce((s, x) => s + Number(x.pending_count), 0),
      expiring: r.reduce((s, x) => s + Number(x.expiring_count) + Number(x.expired_count), 0),
    }
  }, [shown])

  function exportCsv() {
    const head = [kind === 'client' ? 'Client' : 'Contractor', 'Code', 'Pack', 'Status', 'Score', 'Grade', 'Waiting review', 'Missing', 'Expiring', 'Expired', 'Rejected', ...(kind === 'client' ? ['We owe'] : [])]
    const lines = filtered.map(r => [r.name, r.code ?? '', r.pack_name ?? '', STATUS_LABEL[statusOf(r)], scoreOf(r) ?? '', r.hr_grade ?? '',
      r.pending_count, r.missing_count, r.expiring_count, r.expired_count, r.rejected_count, ...(kind === 'client' ? [r.obligations_open] : [])])
    const csv = [head, ...lines].map(l => l.map(v => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `${kind}-compliance-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-text-primary text-[20px] font-bold">Compliance</h1>
          <p className="text-[12px] text-text-secondary">Every contractor and client in one place: documents, scores and grades. Flag only — nothing is blocked.</p>
        </div>
        <Link href="/dashboard/compliance-packs" className="h-9 px-3 rounded-lg border border-border text-[12px] flex items-center text-text-primary">
          Compliance Packs
        </Link>
      </div>
      {error && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">{error}</div>}

      <div className="flex gap-1 bg-surface-elevated p-1 rounded-xl w-fit">
        {(['contractor', 'client'] as const).map(k => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg ${kind === k ? 'bg-primary text-white' : 'text-text-secondary'}`}>
            {k === 'client' ? 'Clients' : 'Contractors'}
          </button>
        ))}
      </div>

      {shown === null ? (
        <p className="text-[13px] text-text-secondary">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Tile label={kind === 'client' ? 'Clients with a pack' : 'Contractors with a pack'} value={`${counts.assigned} / ${shown.length}`} />
            <Tile label="Fully compliant" value={String(counts.compliant)} />
            <Tile label="Waiting for review" value={String(counts.review)} onClick={() => setFilter('review')} />
            <Tile label="Expiring / expired" value={String(counts.expiring)} onClick={() => setFilter('expiring')} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className="dark-entry max-w-xs" placeholder={kind === 'client' ? 'Search client' : 'Search contractor'} value={q} onChange={e => setQ(e.target.value)} />
            {([['all', 'All'], ['attention', 'Needs attention'], ['review', 'Waiting review'], ['expiring', 'Expiring'], ['unassigned', 'No pack']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={`h-8 px-3 rounded-lg border text-[12px] ${filter === k ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary'}`}>{l}</button>
            ))}
            <button type="button" onClick={exportCsv} className="h-8 px-3 rounded-lg border border-border text-[12px] ml-auto">Export CSV</button>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-[12px] min-w-[720px]">
              <thead>
                <tr className="text-left text-text-secondary">
                  <th className="px-3 py-2">{kind === 'client' ? 'Client' : 'Contractor'}</th><th className="px-3 py-2">Pack</th><th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Score</th><th className="px-3 py-2">Grade</th><th className="px-3 py-2">To do</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const st = statusOf(r)
                  const score = scoreOf(r)
                  return (
                    <tr key={r.party_id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <Link href={kind === 'client' ? `/dashboard/clients/${r.party_id}?tab=compliance` : `/dashboard/contractors/${r.party_id}?tab=Compliance`} className="text-primary hover:underline font-semibold">{r.name}</Link>
                        <span className="text-text-secondary"> {r.code ?? ''}</span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{r.pack_name ?? '—'}</td>
                      <td className={`px-3 py-2 font-semibold ${TONE[st]}`}>{STATUS_LABEL[st]}</td>
                      <td className="px-3 py-2 text-right text-text-primary">{score == null ? '—' : `${score}%`}</td>
                      <td className="px-3 py-2 text-text-primary">{r.hr_grade ?? '—'}</td>
                      <td className="px-3 py-2 text-text-secondary">
                        {[r.pending_count && `${r.pending_count} to review`, r.missing_count && `${r.missing_count} missing`,
                          r.rejected_count && `${r.rejected_count} rejected`, r.expiring_count && `${r.expiring_count} expiring`,
                          r.expired_count && `${r.expired_count} expired`, kind === 'client' && r.obligations_open && `${r.obligations_open} we owe`]
                          .filter(Boolean).join(' · ') || '—'}
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-text-secondary">Nothing matches.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="card px-3 py-2.5 text-left disabled:cursor-default">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-[17px] font-bold text-text-primary">{value}</p>
    </button>
  )
}
