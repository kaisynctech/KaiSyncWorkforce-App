'use client'

import { useState } from 'react'
import {
  ALL_FEATURES, ALL_HEADERS, COLUMN_LABEL, FEATURE_LABEL, HEADER_LABEL,
  type QuoteTemplate, type TemplateColumn,
} from '@/lib/quote-templates'
import type { HeaderField, QuoteFeature } from '@/lib/business-types'

/** Board I: change what a quotation template shows. Full screen on the phone, a dialog on bigger screens. */
export function QuoteTemplateEditor({ template, onClose, onSave, onArchive, onMakeDefault }: {
  template: QuoteTemplate
  onClose: () => void
  onSave: (t: QuoteTemplate) => Promise<void>
  onArchive: (t: QuoteTemplate) => Promise<void>
  onMakeDefault: (t: QuoteTemplate) => Promise<void>
}) {
  const [t, setT] = useState<QuoteTemplate>(() => ({
    ...template,
    features: [...template.features],
    header_fields: [...template.header_fields],
    columns: template.columns.map(c => ({ ...c })),
    defaults: { ...{ valid_days: 14, payment_terms_days: 30, deposit_pct: null, margin_pct: null }, ...template.defaults },
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newCol, setNewCol] = useState('')

  const toggleFeature = (f: QuoteFeature) =>
    setT(p => ({ ...p, features: p.features.includes(f) ? p.features.filter(x => x !== f) : [...p.features, f] }))
  const toggleHeader = (h: HeaderField) =>
    setT(p => ({ ...p, header_fields: p.header_fields.includes(h) ? p.header_fields.filter(x => x !== h) : [...p.header_fields, h] }))
  const setCol = (i: number, patch: Partial<TemplateColumn>) =>
    setT(p => ({ ...p, columns: p.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  const moveCol = (i: number, d: -1 | 1) => setT(p => {
    const j = i + d
    if (j < 0 || j >= p.columns.length) return p
    const cols = [...p.columns];
    [cols[i], cols[j]] = [cols[j], cols[i]]
    return { ...p, columns: cols }
  })
  const addCol = () => {
    const label = newCol.trim()
    if (!label) return
    const key = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}_${Date.now().toString(36).slice(-4)}`
    setT(p => ({ ...p, columns: [...p.columns, { key, label, visible: true, team_only: false, custom: true }] }))
    setNewCol('')
  }
  const num = (v: string): number | null => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))))

  async function run(fn: () => Promise<void>, close = true) {
    setBusy(true); setError(null)
    try { await fn(); if (close) onClose() } catch (e) { setError(e instanceof Error ? e.message : 'Could not save') } finally { setBusy(false) }
  }

  const box = 'bg-surface-card border border-divider rounded-2xl p-4 flex flex-col gap-3'
  const input = 'w-full h-11 px-3 bg-background border border-border rounded-lg text-[14px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30'

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true">
      <div className="bg-background w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-2xl flex flex-col overflow-hidden">
        <header className="flex items-center gap-2 px-3 h-14 border-b border-divider shrink-0">
          <button type="button" onClick={onClose} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-black/5" aria-label="Close">
            <span className="material-icons">close</span>
          </button>
          <h2 className="flex-1 text-[16px] font-semibold text-text-primary truncate">Quotation template</h2>
          <button type="button" disabled={busy} onClick={() => run(() => onSave(t))} className="btn-primary h-10 px-4 text-[14px]">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 pb-24">
          {error && <p className="text-[13px] text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</p>}

          <section className={box}>
            <label className="text-[12px] font-medium text-text-secondary">Name
              <input className={`${input} mt-1`} value={t.name} maxLength={80} onChange={e => setT(p => ({ ...p, name: e.target.value }))} />
            </label>
            {t.is_default
              ? <p className="text-[12.5px] text-text-secondary"><span className="material-icons text-[16px] align-[-3px] text-emerald-600">star</span> New quotations start with this template.</p>
              : <button type="button" disabled={busy} onClick={() => run(async () => { await onMakeDefault(t); setT(p => ({ ...p, is_default: true })) }, false)}
                  className="btn-outlined h-10 px-3 text-[13px] self-start">Use for new quotations</button>}
          </section>

          <section className={box}>
            <h3 className="text-[14px] font-semibold text-text-primary">What the quotation shows</h3>
            <ul className="flex flex-col divide-y divide-divider">
              {ALL_FEATURES.map(f => (
                <li key={f}>
                  <label className="flex items-center gap-3 min-h-[48px] cursor-pointer">
                    <input type="checkbox" className="w-5 h-5 accent-[var(--color-primary)]" checked={t.features.includes(f)} onChange={() => toggleFeature(f)} />
                    <span className="text-[14px] text-text-primary">{FEATURE_LABEL[f]}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className={box}>
            <h3 className="text-[14px] font-semibold text-text-primary">At the top of the quotation</h3>
            <div className="flex flex-wrap gap-2">
              {ALL_HEADERS.map(h => {
                const on = t.header_fields.includes(h)
                return (
                  <button key={h} type="button" onClick={() => toggleHeader(h)} aria-pressed={on}
                    className={`h-10 px-3 rounded-full border text-[13px] ${on ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-divider text-text-secondary'}`}>
                    {on && <span className="material-icons text-[16px] align-[-3px] mr-1">check</span>}{HEADER_LABEL[h]}
                  </button>
                )
              })}
            </div>
          </section>

          <section className={box}>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">Columns on each line</h3>
              <p className="text-[12px] text-text-secondary">“Team only” columns never show on what the client sees.</p>
            </div>
            <ul className="flex flex-col gap-2">
              {t.columns.map((c, i) => (
                <li key={c.key} className={`rounded-xl border border-divider px-3 py-2 flex flex-col gap-2 ${c.visible ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <input className="flex-1 min-w-0 h-10 px-2 bg-background border border-border rounded-lg text-[14px]" value={c.label}
                      aria-label={`Column name (${COLUMN_LABEL[c.key] ?? 'custom'})`} maxLength={30} onChange={e => setCol(i, { label: e.target.value })} />
                    <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => moveCol(i, -1)} className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-black/5 disabled:opacity-30">
                      <span className="material-icons text-[20px]">arrow_upward</span>
                    </button>
                    <button type="button" aria-label="Move down" disabled={i === t.columns.length - 1} onClick={() => moveCol(i, 1)} className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-black/5 disabled:opacity-30">
                      <span className="material-icons text-[20px]">arrow_downward</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-text-secondary">
                    <label className="flex items-center gap-2 min-h-[36px]"><input type="checkbox" className="w-5 h-5" checked={c.visible} onChange={e => setCol(i, { visible: e.target.checked })} /> Show</label>
                    <label className="flex items-center gap-2 min-h-[36px]"><input type="checkbox" className="w-5 h-5" checked={c.team_only} onChange={e => setCol(i, { team_only: e.target.checked })} /> Team only</label>
                    {c.custom && (
                      <button type="button" onClick={() => setT(p => ({ ...p, columns: p.columns.filter((_, j) => j !== i) }))} className="ml-auto text-danger text-[13px] min-h-[36px]">Remove</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input className={input} placeholder="Add your own column (e.g. Colour)" value={newCol} maxLength={30}
                onChange={e => setNewCol(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCol() } }} />
              <button type="button" onClick={addCol} disabled={!newCol.trim()} className="btn-outlined h-11 px-3 text-[13px] shrink-0">Add</button>
            </div>
          </section>

          <section className={box}>
            <h3 className="text-[14px] font-semibold text-text-primary">Starting values</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[12px] font-medium text-text-secondary">Valid for (days)
                <input type="number" inputMode="numeric" min={1} className={`${input} mt-1`} value={t.defaults.valid_days ?? ''}
                  onChange={e => setT(p => ({ ...p, defaults: { ...p.defaults, valid_days: num(e.target.value) ?? 14 } }))} />
              </label>
              <label className="text-[12px] font-medium text-text-secondary">Pay within (days)
                <input type="number" inputMode="numeric" min={0} className={`${input} mt-1`} value={t.defaults.payment_terms_days ?? ''}
                  onChange={e => setT(p => ({ ...p, defaults: { ...p.defaults, payment_terms_days: num(e.target.value) ?? 30 } }))} />
              </label>
              <label className="text-[12px] font-medium text-text-secondary">Deposit %
                <input type="number" inputMode="numeric" min={0} max={100} placeholder="None" className={`${input} mt-1`} value={t.defaults.deposit_pct ?? ''}
                  onChange={e => setT(p => ({ ...p, defaults: { ...p.defaults, deposit_pct: num(e.target.value) === null ? null : Math.min(100, num(e.target.value)!) } }))} />
              </label>
              <label className="text-[12px] font-medium text-text-secondary">Margin % (team only)
                <input type="number" inputMode="numeric" min={0} placeholder="None" className={`${input} mt-1`} value={t.defaults.margin_pct ?? ''}
                  onChange={e => setT(p => ({ ...p, defaults: { ...p.defaults, margin_pct: num(e.target.value) } }))} />
              </label>
            </div>
          </section>

          <section className={box}>
            <h3 className="text-[14px] font-semibold text-text-primary">Terms printed on the quotation</h3>
            <textarea rows={5} className="w-full px-3 py-2 bg-background border border-border rounded-lg text-[14px]" value={t.terms ?? ''} maxLength={4000}
              onChange={e => setT(p => ({ ...p, terms: e.target.value }))} />
          </section>

          {!t.is_default && (
            <button type="button" disabled={busy} onClick={() => run(() => onArchive(t))} className="self-start h-10 px-3 text-[13px] text-danger rounded-lg hover:bg-danger/10">
              <span className="material-icons text-[18px] align-[-4px] mr-1">archive</span>Archive this template
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
