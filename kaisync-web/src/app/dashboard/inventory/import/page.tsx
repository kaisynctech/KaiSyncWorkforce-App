'use client'

/**
 * Products & stock → Import price list: upload Excel / CSV, check which column is which, see what will happen
 * to every row (new / update / skipped and why), then import. Matching is by part no., then exact name.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM } from '@/lib/permissions'
import { fmtMoney } from '@/lib/finance-calc'
import { cn } from '@/lib/utils'
import {
  IMPORT_FIELDS,
  guessMapping,
  planImport,
  type CatalogueKind,
  type Existing,
  type ImportField,
  type PlannedRow,
} from '@/lib/catalogue-import'

type Step = 'upload' | 'columns' | 'check' | 'done'

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Part no', 'OEM no', 'Kind', 'Brand', 'Condition', 'Description', 'Unit', 'Cost price', 'Selling price', 'Qty on hand', 'Reorder at', 'Bin'],
    ['Alternator 24V 80A', '0 124 525 045', 'A 004 154 76 02', 'part', 'Bosch', 'New', 'Fits Actros, Axor', 'each', 1980, 2500, 1, 2, 'A4'],
    ['Fitting labour', 'LAB-FIT', '', 'labour', '', '', 'Per hour', 'hour', 250, 450, '', '', ''],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Price list')
  XLSX.writeFile(wb, 'kaisync_price_list_template.xlsx')
}

export default function ImportCataloguePage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [ctx, setCtx] = useState<{ companyId: string; employeeId: string } | null>(null)
  const [canEdit, setCanEdit] = useState<boolean | null>(null)
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({})
  const [defaultKind, setDefaultKind] = useState<CatalogueKind>('part')
  const [existing, setExisting] = useState<Existing[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ added: number; updated: number; failed: string[] } | null>(null)
  const [showOnly, setShowOnly] = useState<'all' | 'skip'>('all')

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { setCanEdit(false); return }
      setCtx({ companyId: member.companyId, employeeId: member.employeeId })
      const { data: me } = await supabase.from('employees').select('access_level').eq('id', member.employeeId).maybeSingle()
      const perms = await loadPermissions(supabase, member.companyId, me?.access_level)
      setCanEdit(can(perms, PERM.inventoryEdit))
    })()
  }, [])

  async function loadExisting(companyId: string) {
    const supabase = createClient()
    const all: Existing[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error: e } = await supabase.from('quote_catalogue_items')
        .select('id, name, sku').eq('company_id', companyId).order('id').range(from, from + 999)
      if (e) throw new Error(e.message)
      all.push(...((data ?? []) as Existing[]))
      if (!data || data.length < 1000) break
    }
    return all
  }

  function handleFile(file: File) {
    setError(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = async evt => {
      try {
        const wb = XLSX.read(evt.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true }) as Record<string, unknown>[]
        if (data.length === 0) { setError('The file has no rows under the header row.'); return }
        if (data.length > 5000) { setError('That file has more than 5 000 rows. Split it into smaller files and import them one after the other.'); return }
        const hdrs = Object.keys(data[0])
        setHeaders(hdrs)
        setRows(data)
        setMapping(guessMapping(hdrs))
        setStep('columns')
      } catch (e) {
        setError(e instanceof Error ? `Could not read the file: ${e.message}` : 'Could not read the file.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // The catalogue as it is now, to decide new vs update (loaded once a file is read).
  useEffect(() => {
    if (!ctx || rows.length === 0 || existing) return
    let live = true
    loadExisting(ctx.companyId)
      .then(list => { if (live) setExisting(list) })
      .catch(e => { if (live) setError(`Could not load your catalogue: ${e instanceof Error ? e.message : e}`) })
    return () => { live = false }
  }, [ctx, rows.length, existing])

  const plan: PlannedRow[] = useMemo(
    () => (existing ? planImport(rows, mapping, existing, defaultKind) : []),
    [rows, mapping, existing, defaultKind],
  )
  const counts = useMemo(() => ({
    new: plan.filter(p => p.action === 'new').length,
    update: plan.filter(p => p.action === 'update').length,
    skip: plan.filter(p => p.action === 'skip').length,
  }), [plan])

  async function runImport() {
    if (!ctx) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const failed: string[] = []
    const todo = plan.filter(p => p.action !== 'skip')
    setProgress({ done: 0, total: todo.length })
    let done = 0
    let added = 0
    let updated = 0
    const bump = (n: number) => { done += n; setProgress({ done, total: todo.length }) }

    // Brands the way the catalogue stores them; conditions by name (unknown ones are left empty).
    const brandOf = new Map<string, string>()
    const brands = [...new Set(todo.map(p => p.brand).filter((b): b is string => Boolean(b)))]
    for (let i = 0; i < brands.length; i += 10) {
      await Promise.all(brands.slice(i, i + 10).map(async b => {
        const { data } = await (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: unknown }>)('normalize_brand', { p_brand: b })
        brandOf.set(b, (data as string | null) ?? b)
      }))
    }
    const { data: conds } = await supabase.from('catalogue_conditions')
      .select('id, name').or(`company_id.eq.${ctx.companyId},company_id.is.null`).eq('is_active', true)
    const condOf = new Map(((conds ?? []) as { id: string; name: string }[]).map(c => [c.name.trim().toLowerCase(), c.id]))

    const common = (p: PlannedRow) => {
      const out: Record<string, unknown> = { name: p.name, item_type: p.kind }
      if (p.sku) out.sku = p.sku
      if (p.brand) out.brand = brandOf.get(p.brand) ?? p.brand
      if (p.condition && condOf.has(p.condition.toLowerCase())) out.condition_id = condOf.get(p.condition.toLowerCase())
      if (p.description) out.description = p.description
      if (p.unit) out.unit_of_measure = p.unit
      if (p.cost !== null) out.cost_price = p.cost
      if (p.price !== null) out.sell_price = p.price
      if (p.reorder !== null) out.reorder_point = p.reorder
      if (p.bin) out.bin_location = p.bin
      return out
    }

    // New items, 200 at a time.
    const news = todo.filter(p => p.action === 'new')
    for (let i = 0; i < news.length; i += 200) {
      const chunk = news.slice(i, i + 200)
      const payload = chunk.map(p => ({
        ...common(p),
        company_id: ctx.companyId,
        created_by: ctx.employeeId,
        unit_of_measure: p.unit || 'each',
        cost_price: p.cost ?? 0,
        sell_price: p.price ?? 0,
        is_stockable: p.qty !== null || p.kind === 'part' || p.kind === 'material',
        qty_on_hand: p.qty ?? 0,
        is_active: true,
      }))
      const { data: inserted, error: e } = await supabase.from('quote_catalogue_items').insert(payload).select('id, name, sku')
      if (e) {
        failed.push(`Lines ${chunk[0].line}–${chunk[chunk.length - 1].line}: ${e.message}`)
      } else {
        const ids = (inserted ?? []) as Existing[]
        added += ids.length
        const aliasRows = chunk.flatMap(p => {
          if (!p.oem) return []
          const hit = ids.find(x => (p.sku && x.sku === p.sku) || x.name === p.name)
          return hit ? [{ company_id: ctx.companyId, catalogue_item_id: hit.id, alias_type: 'oem_number', alias_value: p.oem }] : []
        })
        if (aliasRows.length) {
          const { error: ae } = await supabase.from('catalogue_item_aliases').insert(aliasRows)
          if (ae) failed.push(`OEM numbers for lines ${chunk[0].line}–${chunk[chunk.length - 1].line}: ${ae.message}`)
        }
      }
      bump(chunk.length)
    }

    // Updates: only the columns that have a value in the file; stock on hand is never overwritten.
    const ups = todo.filter(p => p.action === 'update')
    for (let i = 0; i < ups.length; i += 5) {
      await Promise.all(ups.slice(i, i + 5).map(async p => {
        const { error: e } = await supabase.from('quote_catalogue_items').update(common(p)).eq('id', p.existingId as string).eq('company_id', ctx.companyId)
        if (e) failed.push(`Line ${p.line} (${p.name}): ${e.message}`)
        else updated += 1
      }))
      bump(Math.min(5, ups.length - i))
    }

    setResult({ added, updated, failed })
    setBusy(false)
    setStep('done')
  }

  const sel = 'h-11 w-full rounded-lg border border-divider bg-surface px-3 text-[14px] text-text-primary'

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 pb-16 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/inventory" aria-label="Back to products & stock" className="btn-back shrink-0">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div>
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-text-secondary">Products &amp; stock</p>
            <h1 className="text-[22px] font-semibold text-text-primary tracking-tight">Import a price list</h1>
          </div>
        </div>

        {canEdit === false && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            You can look at products but not change them, so you can&apos;t import. Ask someone who can edit products.
          </p>
        )}
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>}

        {step === 'upload' && canEdit && (
          <div className="bg-surface-card border border-divider rounded-2xl p-5 flex flex-col gap-4">
            <p className="text-[14px] text-text-primary">Upload an Excel or CSV file with one item per row and a header row on top. Supplier price lists usually work as they are.</p>
            <ul className="text-[13px] text-text-secondary list-disc pl-5 flex flex-col gap-1">
              <li>Items already in your catalogue are updated (found by part no., then by name), not added twice.</li>
              <li>Only the columns you bring are changed. Stock on hand is only set for new items.</li>
              <li>You see every row before anything is saved.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-primary h-11 px-5 text-[14px] inline-flex items-center gap-1.5">
                <span className="material-icons text-[18px]">upload_file</span>Choose file
              </button>
              <button type="button" onClick={downloadTemplate} className="btn-outlined h-11 px-4 text-[14px]">Download a template</button>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="Price list file"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
          </div>
        )}

        {step === 'columns' && (
          <div className="bg-surface-card border border-divider rounded-2xl p-5 flex flex-col gap-4">
            <div>
              <p className="text-[14px] font-semibold text-text-primary">Which column is which?</p>
              <p className="text-[12.5px] text-text-secondary">{fileName} · {rows.length} rows. We guessed from the headings; change any that are wrong.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {IMPORT_FIELDS.map(f => (
                <label key={f.key} className="flex flex-col gap-1 text-[12.5px] text-text-secondary">
                  {f.label}{f.required ? ' *' : ''}
                  <select value={mapping[f.key] ?? ''} className={sel}
                    onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value || undefined }))}>
                    <option value="">Not in my file</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
              <label className="flex flex-col gap-1 text-[12.5px] text-text-secondary">
                Kind when the file doesn&apos;t say
                <select value={defaultKind} onChange={e => setDefaultKind(e.target.value as CatalogueKind)} className={sel}>
                  <option value="part">Part</option><option value="service">Service</option>
                  <option value="material">Material</option><option value="labour">Labour</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={() => { setStep('upload'); setRows([]); setHeaders([]) }} className="btn-outlined h-11 px-4 text-[14px]">Choose another file</button>
              <button type="button" disabled={!mapping.name || !existing} onClick={() => setStep('check')} className="btn-primary h-11 px-5 text-[14px] disabled:opacity-50">
                {existing ? 'Check the rows' : 'Loading your catalogue…'}
              </button>
            </div>
          </div>
        )}

        {step === 'check' && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              {([['new', 'New', 'text-emerald-700'], ['update', 'Update', 'text-blue-700'], ['skip', 'Skipped', 'text-amber-700']] as const).map(([k, l, c]) => (
                <div key={k} className="bg-surface-card border border-divider rounded-2xl px-3 py-3">
                  <p className="text-[12px] text-text-secondary">{l}</p>
                  <p className={cn('text-[22px] font-bold tabular-nums', c)}>{counts[k]}</p>
                </div>
              ))}
            </div>
            {counts.skip > 0 && (
              <div className="flex gap-1.5">
                {(['all', 'skip'] as const).map(v => (
                  <button key={v} type="button" onClick={() => setShowOnly(v)} aria-pressed={showOnly === v}
                    className={cn('h-9 px-3.5 rounded-full text-[12.5px] font-semibold border', showOnly === v ? 'bg-primary border-primary text-white' : 'bg-surface border-divider text-text-secondary')}>
                    {v === 'all' ? 'All rows' : `Only skipped (${counts.skip})`}
                  </button>
                ))}
              </div>
            )}
            <ul className="flex flex-col bg-surface-card border border-divider rounded-2xl divide-y divide-divider overflow-hidden">
              {plan.filter(p => showOnly === 'all' || p.action === 'skip').slice(0, 300).map(p => (
                <li key={p.line} className="px-4 py-2.5 flex items-start gap-3">
                  <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5',
                    p.action === 'new' ? 'bg-emerald-100 text-emerald-800' : p.action === 'update' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800')}>
                    {p.action === 'new' ? 'New' : p.action === 'update' ? 'Update' : 'Skip'}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] font-medium text-text-primary truncate">{p.name || <i className="text-text-secondary">no name</i>}</span>
                    <span className="block text-[12px] text-text-secondary truncate">
                      Line {p.line}{p.sku ? ` · ${p.sku}` : ''} · {p.kind}{p.brand ? ` · ${p.brand}` : ''}{p.price !== null ? ` · ${fmtMoney(p.price)}` : ''}
                    </span>
                    {p.problems.length > 0 && <span className="block text-[12px] text-amber-700">{p.problems.join(' · ')}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {plan.length > 300 && <p className="text-[12px] text-text-secondary">Showing the first 300 rows; all {plan.length} are imported.</p>}
            {progress && busy && <p className="text-[13px] text-text-secondary">Importing… {progress.done} of {progress.total}</p>}
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" disabled={busy} onClick={() => setStep('columns')} className="btn-outlined h-11 px-4 text-[14px] disabled:opacity-50">Back to columns</button>
              <button type="button" disabled={busy || counts.new + counts.update === 0} onClick={() => void runImport()} className="btn-primary h-11 px-5 text-[14px] disabled:opacity-50">
                {busy ? 'Importing…' : `Import ${counts.new + counts.update} ${counts.new + counts.update === 1 ? 'item' : 'items'}`}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div className="bg-surface-card border border-divider rounded-2xl p-5 flex flex-col gap-3">
            <p className="text-[16px] font-semibold text-text-primary">
              {result.failed.length === 0 ? 'Imported' : 'Imported with problems'}
            </p>
            <p className="text-[13.5px] text-text-secondary">{result.added} added · {result.updated} updated · {counts.skip} skipped</p>
            {result.failed.length > 0 && (
              <ul className="text-[12.5px] text-red-700 list-disc pl-5">{result.failed.slice(0, 20).map(f => <li key={f}>{f}</li>)}</ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/inventory" className="btn-primary h-11 px-5 text-[14px] inline-flex items-center">Open products &amp; stock</Link>
              <button type="button" onClick={() => { setStep('upload'); setResult(null); setRows([]); setExisting(null) }} className="btn-outlined h-11 px-4 text-[14px]">Import another file</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
