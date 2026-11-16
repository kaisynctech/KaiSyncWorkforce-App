'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BUSINESS_TYPES, businessType, combinedSetup } from '@/lib/business-types'
import {
  addBlankTemplate, archiveTemplate, loadTemplates, saveBusinessTypes, saveTemplate, setDefaultTemplate,
  type QuoteTemplate,
} from '@/lib/quote-templates'
import { BusinessTypePicker } from '@/components/settings/BusinessTypePicker'
import { QuoteTemplateEditor } from '@/components/settings/QuoteTemplateEditor'

/**
 * Settings › Money › Your business (board J) and Quotation templates (board I).
 * `setup` opens the picker straight away (from the "Set up your workspace" banner); saving then marks the
 * workspace as set up so the banner goes away.
 */
type Loaded = { types: string[]; setupAt: string | null; templates: QuoteTemplate[] }

async function fetchBusiness(companyId: string): Promise<Loaded> {
  const supabase = createClient()
  const [{ data: c }, templates] = await Promise.all([
    supabase.from('companies').select('business_types, workspace_setup_at').eq('id', companyId).maybeSingle(),
    loadTemplates(supabase, companyId).catch(() => [] as QuoteTemplate[]),
  ])
  const row = c as { business_types?: string[] | null; workspace_setup_at?: string | null } | null
  return { types: row?.business_types ?? [], setupAt: row?.workspace_setup_at ?? null, templates }
}

export function BusinessSettings({ companyId, canEdit, setup }: { companyId: string; canEdit: boolean; setup?: boolean }) {
  const [types, setTypes] = useState<string[] | null>(null)
  const [setupAt, setSetupAt] = useState<string | null>(null)
  const [templates, setTemplates] = useState<QuoteTemplate[]>([])
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const [editing, setEditing] = useState<QuoteTemplate | null>(null)
  const [adding, setAdding] = useState<{ name: string; from: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const apply = useCallback((d: Loaded) => {
    setTypes(d.types); setSetupAt(d.setupAt); setTemplates(d.templates)
  }, [])
  const load = useCallback(async () => apply(await fetchBusiness(companyId)), [apply, companyId])

  useEffect(() => {
    let live = true
    fetchBusiness(companyId).then(d => {
      if (!live) return
      apply(d)
      if (setup && canEdit) { setDraft(d.types); setPicking(true) }
    }).catch(() => { if (live) setTypes([]) })
    return () => { live = false }
  }, [apply, companyId, setup, canEdit])

  async function act(fn: () => Promise<void>, ok?: string) {
    setBusy(true); setError(null); setNote(null)
    try { await fn(); await load(); if (ok) setNote(ok) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } finally { setBusy(false) }
  }

  const supabase = createClient()
  const setupInfo = combinedSetup(types ?? [])
  const box = 'bg-surface-card border border-divider rounded-2xl p-4 flex flex-col gap-3'

  return (
    <div className="flex flex-col gap-4" id="business">
      {error && <p className="text-[13px] text-danger bg-danger/10 rounded-lg px-3 py-2">{error}</p>}
      {note && <p className="text-[13px] text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{note}</p>}

      <section className={box}>
        <div className="flex items-start gap-3">
          <span className="material-icons text-[22px] text-primary mt-0.5">storefront</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-semibold text-text-primary">Your business</h2>
            <p className="text-[12.5px] text-text-secondary">What you do decides your quotation templates and what happens after a client accepts.</p>
          </div>
          {canEdit && !picking && types !== null && (
            <button type="button" onClick={() => { setDraft(types); setPicking(true) }} className="btn-outlined h-10 px-3.5 text-[13px] shrink-0">
              {types.length ? 'Change' : 'Choose'}
            </button>
          )}
        </div>

        {types === null ? <p className="text-[13px] text-text-secondary">Loading…</p>
          : picking ? (
            <div className="flex flex-col gap-3">
              <p className="text-[14px] font-medium text-text-primary">What does your business do?</p>
              <BusinessTypePicker value={draft} onChange={setDraft} disabled={busy} />
              <div className="flex gap-2 sticky bottom-0 bg-surface-card py-2">
                <button type="button" disabled={busy || draft.length === 0}
                  onClick={() => act(async () => { await saveBusinessTypes(supabase, companyId, draft, { markSetup: true }); setPicking(false) }, 'Saved. Your templates are below.')}
                  className="btn-primary h-11 px-4 text-[14px] flex-1 sm:flex-none">{busy ? 'Saving…' : 'Save'}</button>
                <button type="button" disabled={busy} onClick={() => setPicking(false)} className="btn-outlined h-11 px-4 text-[14px]">Cancel</button>
              </div>
            </div>
          ) : types.length === 0 ? (
            <p className="text-[13px] text-amber-700">Not chosen yet{canEdit ? ': tap Choose so quotations fit your work.' : '.'}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {types.map((k, i) => (
                  <span key={k} className={`inline-flex items-center gap-1 h-8 px-3 rounded-full text-[13px] ${i === 0 ? 'bg-primary text-white' : 'bg-primary/10 text-primary'}`}>
                    {businessType(k)?.label ?? k}{i === 0 && <span className="text-[11px] opacity-80">· main</span>}
                  </span>
                ))}
              </div>
              <ul className="text-[12.5px] text-text-secondary flex flex-col gap-1">
                <li><span className="material-icons text-[16px] align-[-3px] mr-1">task_alt</span>After a client accepts: {[...new Set(setupInfo.types.map(t => t.afterAccept))].join(' / ')}</li>
                {setupInfo.askSuppliers && <li><span className="material-icons text-[16px] align-[-3px] mr-1">request_quote</span>Ask suppliers for prices from a quotation</li>}
                {setupInfo.recurring && <li><span className="material-icons text-[16px] align-[-3px] mr-1">autorenew</span>Monthly / recurring amounts</li>}
                {setupInfo.timesheets && <li><span className="material-icons text-[16px] align-[-3px] mr-1">schedule</span>Time on jobs from timesheets</li>}
              </ul>
              {!setupAt && canEdit && <p className="text-[12px] text-text-secondary">Tap Change and Save once to confirm your set-up.</p>}
            </>
          )}
      </section>

      <section className={box}>
        <div className="flex items-start gap-3">
          <span className="material-icons text-[22px] text-primary mt-0.5">description</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-semibold text-text-primary">Quotation templates</h2>
            <p className="text-[12.5px] text-text-secondary">What each kind of quotation shows. Quotations you already sent don’t change.</p>
          </div>
        </div>
        {templates.length === 0
          ? <p className="text-[13px] text-text-secondary">None yet. {types?.length ? 'Add one below.' : 'Choose what your business does and your templates are made for you.'}</p>
          : (
            <ul className="flex flex-col divide-y divide-divider -mx-1">
              {templates.map(t => (
                <li key={t.id} className="flex items-center gap-3 px-1 py-2.5 min-h-[56px]">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium text-text-primary truncate">
                      {t.name}{t.is_default && <span className="ml-2 align-middle rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold px-2 py-0.5">Default</span>}
                    </span>
                    <span className="block text-[12px] text-text-secondary truncate">
                      {[businessType(t.business_type)?.label, `${t.columns.filter(c => c.visible).length} columns`, t.defaults?.deposit_pct ? `${t.defaults.deposit_pct}% deposit` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {canEdit && <button type="button" onClick={() => setEditing(t)} className="btn-outlined h-10 px-3.5 text-[13px] shrink-0">Edit</button>}
                </li>
              ))}
            </ul>
          )}
        {canEdit && (adding ? (
          <div className="flex flex-col gap-2 border-t border-divider pt-3">
            <input className="w-full h-11 px-3 bg-background border border-border rounded-lg text-[14px]" placeholder="Template name" maxLength={80}
              value={adding.name} onChange={e => setAdding({ ...adding, name: e.target.value })} />
            <select className="w-full h-11 px-3 bg-background border border-border rounded-lg text-[14px]" value={adding.from}
              onChange={e => setAdding({ ...adding, from: e.target.value })}>
              <option value="">Start blank</option>
              {BUSINESS_TYPES.map(b => <option key={b.key} value={b.key}>Start from: {b.label}</option>)}
            </select>
            <div className="flex gap-2">
              <button type="button" disabled={busy || !adding.name.trim()} className="btn-primary h-11 px-4 text-[14px] flex-1 sm:flex-none"
                onClick={() => act(async () => {
                  const id = await addBlankTemplate(supabase, companyId, adding.from || null, adding.name)
                  setAdding(null)
                  const fresh = await loadTemplates(supabase, companyId)
                  const made = fresh.find(x => x.id === id)
                  if (made) setEditing(made)
                })}>Add</button>
              <button type="button" disabled={busy} onClick={() => setAdding(null)} className="btn-outlined h-11 px-4 text-[14px]">Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding({ name: '', from: types?.[0] ?? '' })} className="self-start h-10 px-2 text-[13px] font-medium text-primary rounded-lg hover:bg-primary/10">
            <span className="material-icons text-[18px] align-[-4px] mr-1">add</span>Add a template
          </button>
        ))}
      </section>

      {editing && (
        <QuoteTemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSave={async t => { await saveTemplate(supabase, t); await load(); setNote('Template saved.') }}
          onArchive={async t => { await archiveTemplate(supabase, t); await load(); setNote('Template archived.') }}
          onMakeDefault={async t => { await setDefaultTemplate(supabase, companyId, t.id); await load() }}
        />
      )}
    </div>
  )
}
