'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import {
  archivePack, getOverview, listPacks, STATUS_LABEL, statusTone, upsertPack,
  type DocType, type OverviewRow, type PackItem, type PackWithItems,
} from '@/lib/compliance/api'

type View = 'overview' | 'packs'
const TONE = { success: 'text-success', warning: 'text-warning', error: 'text-error', muted: 'text-text-secondary' }

/** Client Compliance: overview of every client, and the client requirement packs. */
export default function ComplianceOverviewPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [view, setView] = useState<View>('overview')
  const [kind, setKind] = useState<'client' | 'contractor'>('client')
  const [contractorRows, setContractorRows] = useState<OverviewRow[] | null>(null)
  const [rows, setRows] = useState<OverviewRow[] | null>(null)
  const [packs, setPacks] = useState<PackWithItems[]>([])
  const [types, setTypes] = useState<DocType[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'attention' | 'review' | 'expiring' | 'unassigned'>('all')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    try {
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('Your account is not linked to a company.'); return }
      setCompanyId(member.companyId)
      const [p, ov, pk, cov] = await Promise.all([
        loadPermissions(supabase, member.companyId),
        getOverview(supabase, member.companyId, 'client'),
        listPacks(supabase, member.companyId, 'client'),
        getOverview(supabase, member.companyId, 'contractor').catch(() => [] as OverviewRow[]),
      ])
      setPerms(p)
      setRows(ov)
      setContractorRows(cov)
      setPacks(pk.packs)
      setTypes(pk.types)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load compliance.')
      setRows([])
    }
  }, [])

  // Loads from the server on mount; setState happens after the await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const shown = kind === 'client' ? rows : contractorRows
  const filtered = useMemo(() => (shown ?? []).filter(r => {
    if (q && !`${r.name} ${r.code ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false
    if (filter === 'attention') return r.status === 'non_compliant' || r.status === 'partial' || r.expired_count > 0
    if (filter === 'review') return r.pending_count > 0
    if (filter === 'expiring') return r.expiring_count > 0 || r.expired_count > 0
    if (filter === 'unassigned') return !r.pack_id
    return true
  }), [shown, filter, q])

  const counts = useMemo(() => {
    const r = shown ?? []
    return {
      assigned: r.filter(x => x.pack_id).length,
      compliant: r.filter(x => x.status === 'compliant').length,
      review: r.reduce((s, x) => s + x.pending_count, 0),
      expiring: r.reduce((s, x) => s + x.expiring_count + x.expired_count, 0),
    }
  }, [shown])

  function exportCsv() {
    const head = [kind === 'client' ? 'Client' : 'Contractor', 'Code', 'Pack', 'Status', 'Score', 'Grade', 'Waiting review', 'Missing', 'Expiring', 'Expired', 'Our obligations open']
    const lines = filtered.map(r => [r.name, r.code ?? '', r.pack_name ?? '', STATUS_LABEL[r.status], r.score, r.hr_grade ?? '',
      r.pending_count, r.missing_count, r.expiring_count, r.expired_count, r.obligations_open])
    const csv = [head, ...lines].map(l => l.map(v => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `${kind}-compliance-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const canEdit = can(perms, PERM.clientsEdit)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-text-primary text-[20px] font-bold">Compliance</h1>
          <p className="text-[12px] text-text-secondary">Documents each client must give us, documents we owe them, scores and grades. Flag only — nothing is blocked.</p>
        </div>
        <div className="flex gap-1 bg-surface-elevated p-1 rounded-xl">
          {(['overview', 'packs'] as View[]).map(v => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg ${view === v ? 'bg-primary text-white' : 'text-text-secondary'}`}>
              {v === 'overview' ? 'Overview' : 'Requirement packs'}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[12px] text-error">{error}</div>}

      {view === 'packs' ? (
        companyId && <PacksEditor companyId={companyId} packs={packs} types={types} canEdit={canEdit} onChanged={() => void load()} />
      ) : shown === null ? (
        <p className="text-[13px] text-text-secondary">Loading…</p>
      ) : (
        <>
          <div className="flex gap-1 bg-surface-elevated p-1 rounded-xl w-fit">
            {(['client', 'contractor'] as const).map(k => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg ${kind === k ? 'bg-primary text-white' : 'text-text-secondary'}`}>
                {k === 'client' ? 'Clients' : 'Contractors'}
              </button>
            ))}
          </div>
          {kind === 'contractor' && (
            <p className="text-[12px] text-text-secondary">Contractor packs and documents are managed on each contractor record and under Compliance Packs, as before.</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Tile label={kind === 'client' ? 'Clients with a pack' : 'Contractors with a pack'} value={`${counts.assigned} / ${shown.length}`} />
            <Tile label="Fully compliant" value={String(counts.compliant)} />
            <Tile label="Waiting for review" value={String(counts.review)} onClick={() => setFilter('review')} />
            <Tile label="Expiring / expired" value={String(counts.expiring)} onClick={() => setFilter('expiring')} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className="dark-entry max-w-xs" placeholder="Search client" value={q} onChange={e => setQ(e.target.value)} />
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
                {filtered.map(r => (
                  <tr key={r.party_id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link href={kind === 'client' ? `/dashboard/clients/${r.party_id}?tab=compliance` : `/dashboard/contractors/${r.party_id}`} className="text-primary hover:underline font-semibold">{r.name}</Link>
                      <span className="text-text-secondary"> {r.code ?? ''}</span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{r.pack_name ?? '—'}</td>
                    <td className={`px-3 py-2 font-semibold ${TONE[statusTone(r.status)]}`}>{STATUS_LABEL[r.status]}</td>
                    <td className="px-3 py-2 text-right text-text-primary">{r.pack_id ? `${r.score}%` : '—'}</td>
                    <td className="px-3 py-2 text-text-primary">{r.hr_grade ?? '—'}</td>
                    <td className="px-3 py-2 text-text-secondary">
                      {[r.pending_count && `${r.pending_count} to review`, r.missing_count && `${r.missing_count} missing`,
                        r.expiring_count && `${r.expiring_count} expiring`, r.expired_count && `${r.expired_count} expired`,
                        r.obligations_open && `${r.obligations_open} we owe`].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
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

function emptyItem(t: DocType): PackItem {
  return { document_type_code: t.code, direction: t.default_direction, requirement: 'required', validity_days: t.default_validity_days,
    expiry_required: t.default_validity_days != null, weight: 1, notes: null }
}

function PacksEditor({ companyId, packs, types, canEdit, onChanged }: {
  companyId: string; packs: PackWithItems[]; types: DocType[]; canEdit: boolean; onChanged: () => void
}) {
  const [edit, setEdit] = useState<{ id: string | null; name: string; description: string; is_default: boolean; items: PackItem[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = (code: string) => types.find(t => t.code === code)?.label ?? code

  async function save() {
    if (!edit) return
    setBusy(true); setError(null)
    try { await upsertPack(createClient(), companyId, 'client', edit); setEdit(null); onChanged() }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not save the pack.') }
    setBusy(false)
  }

  if (edit) {
    const chosen = new Set(edit.items.map(i => `${i.direction}:${i.document_type_code}`))
    const setItem = (idx: number, patch: Partial<PackItem>) =>
      setEdit({ ...edit, items: edit.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) })
    return (
      <div className="card p-4 space-y-3">
        {error && <p className="text-[12px] text-error">{error}</p>}
        <input className="dark-entry" placeholder="Pack name *" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} />
        <input className="dark-entry" placeholder="Description" value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} />
        <label className="flex items-center gap-2 text-[12px] text-text-primary">
          <input type="checkbox" checked={edit.is_default} onChange={e => setEdit({ ...edit, is_default: e.target.checked })} />
          Default pack for new clients
        </label>
        <p className="section-label">DOCUMENTS IN THIS PACK</p>
        {edit.items.length === 0 && <p className="text-[12px] text-text-secondary">Add documents from the list below.</p>}
        {edit.items.map((it, idx) => (
          <div key={`${it.direction}-${it.document_type_code}`} className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto_auto] items-center border-t border-border pt-2">
            <span className="text-[13px] text-text-primary">{label(it.document_type_code)}</span>
            <select className="dark-entry appearance-none" value={it.direction} onChange={e => setItem(idx, { direction: e.target.value as PackItem['direction'] })}>
              <option value="from_party">From client</option><option value="to_party">From us</option>
            </select>
            <select className="dark-entry appearance-none" value={it.requirement} onChange={e => setItem(idx, { requirement: e.target.value as PackItem['requirement'] })}>
              <option value="required">Required</option><option value="recommended">Recommended</option>
            </select>
            <input className="dark-entry w-24" type="number" min={0} placeholder="Valid days" value={it.validity_days ?? ''}
              onChange={e => setItem(idx, { validity_days: e.target.value ? Number(e.target.value) : null })} />
            <input className="dark-entry w-20" type="number" min={0.1} step={0.5} title="Weight" value={it.weight}
              onChange={e => setItem(idx, { weight: Number(e.target.value) || 1 })} />
            <button type="button" className="text-[12px] text-error" onClick={() => setEdit({ ...edit, items: edit.items.filter((_, i) => i !== idx) })}>Remove</button>
          </div>
        ))}
        <select className="dark-entry appearance-none" value="" onChange={e => {
          const t = types.find(x => x.code === e.target.value)
          if (t) setEdit({ ...edit, items: [...edit.items, emptyItem(t)] })
        }}>
          <option value="">+ Add a document…</option>
          {types.filter(t => !chosen.has(`${t.default_direction}:${t.code}`)).map(t => (
            <option key={t.code} value={t.code}>{t.label}{t.default_direction === 'to_party' ? ' (from us)' : ''}</option>
          ))}
        </select>
        <p className="text-[11px] text-text-secondary">Score = weighted share of required &quot;from client&quot; documents that are approved and not expired. &quot;From us&quot; documents are tracked as our obligations and do not affect the client&apos;s score.</p>
        <div className="flex gap-2">
          <button type="button" disabled={busy || !edit.name.trim()} onClick={() => void save()}
            className="h-9 px-4 rounded-lg bg-primary text-white text-[12px] font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Save pack'}</button>
          <button type="button" onClick={() => setEdit(null)} className="h-9 px-4 rounded-lg border border-border text-[12px]">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <button type="button" onClick={() => setEdit({ id: null, name: '', description: '', is_default: packs.filter(p => !p.is_archived).length === 0, items: [] })}
          className="h-9 px-4 rounded-lg bg-primary text-white text-[12px] font-semibold">+ New client pack</button>
      )}
      {error && <p className="text-[12px] text-error">{error}</p>}
      {packs.length === 0 && <p className="text-[13px] text-text-secondary">No client packs yet. Create one, e.g. &quot;Commercial client – standard&quot;.</p>}
      {packs.map(p => (
        <div key={p.id} className={`card p-4 space-y-1 ${p.is_archived ? 'opacity-60' : ''}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[14px] font-semibold text-text-primary">{p.name}{p.is_default ? ' · default' : ''}{p.is_archived ? ' · archived' : ''}</p>
            {canEdit && (
              <div className="flex gap-3">
                {!p.is_archived && <button type="button" className="text-[12px] text-primary" onClick={() => setEdit({
                  id: p.id, name: p.name, description: p.description ?? '', is_default: p.is_default, items: p.items,
                })}>Edit</button>}
                <button type="button" className="text-[12px] text-text-secondary" disabled={busy} onClick={() => void (async () => {
                  setBusy(true); setError(null)
                  try { await archivePack(createClient(), p.id, !p.is_archived); onChanged() } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed') }
                  setBusy(false)
                })()}>{p.is_archived ? 'Restore' : 'Archive'}</button>
              </div>
            )}
          </div>
          {p.description && <p className="text-[12px] text-text-secondary">{p.description}</p>}
          <p className="text-[12px] text-text-secondary">
            {p.items.filter(i => i.direction === 'from_party').length} from client · {p.items.filter(i => i.direction === 'to_party').length} from us · used by {p.assigned_count} client(s)
          </p>
        </div>
      ))}
    </div>
  )
}
