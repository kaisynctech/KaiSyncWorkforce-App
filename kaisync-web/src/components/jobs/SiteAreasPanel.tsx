'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import {
  addSiteArea,
  areaOptions,
  deleteSiteArea,
  importSiteAreas,
  listSiteAreas,
  parseAreaRows,
  updateSiteArea,
  type AreaImportRow,
  type SiteArea,
} from '@/lib/job-services'

type Props = {
  companyId: string
  siteId: string
  siteName: string
  canEdit: boolean
  /** Tells the parent how many areas the site has (for the "Areas (n)" button). */
  onCount?: (count: number) => void
}

const input =
  'h-9 px-2.5 rounded-sm bg-surface-elevated border border-border text-[13px] text-text-primary ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30'

/**
 * Areas inside one client site (Brewhouse › Service Room), with priority. Add one at a time or
 * import a sheet. Areas appear in the job form's Area dropdown for this site.
 */
export function SiteAreasPanel({ companyId, siteId, siteName, canEdit, onCount }: Props) {
  const [areas, setAreas] = useState<SiteArea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [priority, setPriority] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string; priority: string } | null>(null)
  const [preview, setPreview] = useState<{ file: string; rows: AreaImportRow[]; problems: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const onCountRef = useRef(onCount)
  useEffect(() => { onCountRef.current = onCount })

  const load = useCallback(async () => {
    const res = await listSiteAreas(createClient(), companyId, [siteId], { includeInactive: true })
    setLoading(false)
    if (!res.ok) { setError(res.message); return }
    setAreas(res.data)
    onCountRef.current?.(res.data.filter(a => a.is_active).length)
  }, [companyId, siteId])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  const options = useMemo(() => areaOptions(areas), [areas])
  const childCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of areas) if (a.parent_area_id) m.set(a.parent_area_id, (m.get(a.parent_area_id) ?? 0) + 1)
    return m
  }, [areas])

  async function add() {
    if (!name.trim()) return
    setBusy(true); setError(null); setNotice(null)
    const res = await addSiteArea(createClient(), companyId, {
      siteId, name, parentAreaId: parent || null, priority: priority ? Number(priority) : null,
    })
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setName('')
    setNotice(`Added ${res.data.name}.`)
    await load()
  }

  async function saveEdit() {
    if (!editing) return
    setBusy(true); setError(null)
    const res = await updateSiteArea(createClient(), companyId, editing.id, {
      name: editing.name, priority: editing.priority ? Number(editing.priority) : null,
    })
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setEditing(null)
    await load()
  }

  async function toggle(a: SiteArea) {
    setBusy(true)
    const res = await updateSiteArea(createClient(), companyId, a.id, { isActive: !a.is_active })
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  async function remove(a: SiteArea) {
    const inner = childCount.get(a.id) ?? 0
    const extra = inner ? `\n\nThe ${inner} area${inner === 1 ? '' : 's'} inside it will be deleted too.` : ''
    if (!window.confirm(`Delete "${a.name}"?${extra}\n\nJobs keep their history. To keep it for old reports, choose Hide instead.`)) return
    setBusy(true)
    const res = await deleteSiteArea(createClient(), companyId, a.id)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setNotice(`Deleted ${a.name}.`)
    await load()
  }

  async function readFile(file: File) {
    setError(null); setNotice(null)
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]
      const parsed = parseAreaRows(rows)
      setPreview({ file: file.name, ...parsed })
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function runImport() {
    if (!preview) return
    setBusy(true); setError(null)
    const res = await importSiteAreas(createClient(), companyId, siteId, preview.rows, areas)
    setBusy(false)
    if (!res.ok) { setError(res.message); await load(); return }
    setPreview(null)
    setNotice(`Imported ${res.data.added} area${res.data.added === 1 ? '' : 's'}${res.data.skipped ? `; ${res.data.skipped} already there` : ''}.`)
    await load()
  }

  const groups = preview ? preview.rows.filter(r => !r.subArea).length : 0
  const inner = preview ? preview.rows.filter(r => r.subArea).length : 0

  return (
    <div className="space-y-2 rounded-lg border border-divider bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[12px] font-semibold text-text-primary">Areas at {siteName}</p>
        {canEdit && (
          <>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-primary text-[12px] hover:underline">
              Import from Excel
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label={`Import areas for ${siteName}`}
              onChange={e => { const f = e.target.files?.[0]; if (f) void readFile(f) }} />
          </>
        )}
      </div>

      {preview && (
        <div className="rounded-sm border border-primary/40 bg-surface p-3 space-y-2">
          <p className="text-[13px] text-text-primary">
            {preview.file}: {groups} area{groups === 1 ? '' : 's'}{inner ? ` with ${inner} area${inner === 1 ? '' : 's'} inside them` : ''}.
            Areas that are already here are skipped.
          </p>
          {preview.problems.length > 0 && (
            <ul className="text-[12px] text-warning list-disc pl-4">
              {preview.problems.slice(0, 5).map(p => <li key={p}>{p}</li>)}
            </ul>
          )}
          {preview.rows.length > 0 && (
            <p className="text-[12px] text-text-secondary">
              For example: {preview.rows.filter(r => r.subArea).slice(0, 3).map(r => `${r.area} › ${r.subArea}`).join(', ') || preview.rows.slice(0, 3).map(r => r.area).join(', ')}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy || preview.rows.length === 0} onClick={() => void runImport()} className="btn-primary h-8 px-3 text-[12px] disabled:opacity-50">
              {busy ? 'Importing…' : `Import ${preview.rows.length}`}
            </button>
            <button type="button" onClick={() => setPreview(null)} className="btn-outlined h-8 px-3 text-[12px]">Cancel</button>
          </div>
          <p className="text-[11px] text-text-secondary">
            The sheet needs an &quot;Area&quot; column. Optional: &quot;Sub-area&quot; and &quot;Priority&quot;. A schedule where a name in capitals heads a group of rooms also works.
          </p>
        </div>
      )}

      {canEdit && (
        <form className="flex flex-wrap gap-2 items-end" onSubmit={e => { e.preventDefault(); void add() }}>
          <input className={`${input} flex-1 min-w-[160px]`} placeholder="New area, e.g. Service Room" aria-label="New area name"
            value={name} onChange={e => setName(e.target.value)} maxLength={160} />
          {options.length > 0 && (
            <select className={`${input} max-w-[220px]`} aria-label="Inside which area" value={parent} onChange={e => setParent(e.target.value)}>
              <option value="">Not inside another area</option>
              {options.map(a => <option key={a.id} value={a.id}>Inside {a.path}</option>)}
            </select>
          )}
          <select className={input} aria-label="Priority" value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="">No priority</option>
            {[1, 2, 3, 4, 5].map(p => <option key={p} value={p}>Priority {p}</option>)}
          </select>
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary h-9 px-3 text-[12px] disabled:opacity-50">Add</button>
        </form>
      )}

      {error && <p className="text-[12px] text-error" role="alert">{error}</p>}
      {notice && !error && <p className="text-[12px] text-success" aria-live="polite">{notice}</p>}

      {loading ? (
        <p className="text-[12px] text-text-secondary">Loading…</p>
      ) : options.length === 0 ? (
        <p className="text-[12px] text-text-secondary">No areas yet. Add them here or import a sheet.</p>
      ) : (
        <ul className="max-h-[320px] overflow-y-auto divide-y divide-divider rounded-sm border border-divider bg-surface">
          {options.map(a => (
            <li key={a.id} className="flex items-center gap-2 px-2 py-1.5 text-[13px]" style={{ paddingLeft: 8 + a.depth * 18 }}>
              {editing?.id === a.id ? (
                <>
                  <input className={`${input} flex-1`} aria-label="Area name" value={editing.name} autoFocus
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') void saveEdit(); if (e.key === 'Escape') setEditing(null) }} />
                  <select className={input} aria-label="Priority" value={editing.priority} onChange={e => setEditing({ ...editing, priority: e.target.value })}>
                    <option value="">No priority</option>
                    {[1, 2, 3, 4, 5].map(p => <option key={p} value={p}>Priority {p}</option>)}
                  </select>
                  <button type="button" disabled={busy} onClick={() => void saveEdit()} className="text-primary text-[12px]">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className="text-text-secondary text-[12px]">Cancel</button>
                </>
              ) : (
                <>
                  <span className={`flex-1 min-w-0 truncate ${a.is_active ? 'text-text-primary' : 'text-text-disabled line-through'}`}>
                    {a.depth > 0 && <span className="text-text-disabled mr-1" aria-hidden="true">└</span>}
                    {a.name}
                  </span>
                  {a.priority && <span className="text-[11px] text-text-secondary shrink-0">Priority {a.priority}</span>}
                  {canEdit && (
                    <span className="flex gap-3 shrink-0 text-[11px]">
                      <button type="button" className="text-primary" onClick={() => setEditing({ id: a.id, name: a.name, priority: a.priority ? String(a.priority) : '' })}>Edit</button>
                      <button type="button" className="text-text-secondary" disabled={busy} onClick={() => void toggle(a)}>{a.is_active ? 'Hide' : 'Show'}</button>
                      <button type="button" className="text-error" disabled={busy} onClick={() => void remove(a)}>Delete</button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
