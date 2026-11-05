'use client'

/**
 * To + CC for every "email this" dialog.
 * - With a client: To is the client's email (or its first contact); the client's contacts ticked
 *   "include in emails" are CC'd automatically. Other contacts are one tap away; anyone can be removed.
 * - Any address can be typed in (Enter, comma or leaving the box adds it).
 * - New addresses can be saved as contacts on the client for next time.
 * The parent owns the value; the dialog mounts this when it opens.
 */

import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

export type Recipients = { to: string; cc: string[]; saveNew: boolean }
type Contact = { id: string; name: string; email: string; include_in_emails: boolean }

export const isEmail = (v: string) => /^[^@\s<>",;]+@[^@\s<>",;]+\.[^@\s<>",;]+$/.test(v.trim())
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function emptyRecipients(to?: string | null): Recipients {
  return { to: (to ?? '').trim(), cc: [], saveNew: false }
}

export function RecipientsInput({
  value, onChange, companyId, clientId, clientEmail, toLabel = 'Send to', disabled, ccOnly,
}: {
  value: Recipients
  onChange: (v: Recipients) => void
  companyId: string
  /** Contacts are read from this client. Leave out for suppliers, contractors and staff. */
  clientId?: string | null
  /** The client's main email, so it isn't offered as a "new" address to save. */
  clientEmail?: string | null
  toLabel?: string
  disabled?: boolean
  /** Only the CC box (the main recipients are chosen elsewhere, e.g. one email per supplier on an RFQ). */
  ccOnly?: boolean
}) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [draft, setDraft] = useState('')
  const [draftErr, setDraftErr] = useState<string | null>(null)
  const prefilled = useRef(false)
  const latest = useRef(value)
  useEffect(() => { latest.current = value }, [value])

  useEffect(() => {
    if (!clientId) return
    let off = false
    void createClient().from('client_contacts').select('id, name, email, include_in_emails')
      .eq('company_id', companyId).eq('client_id', clientId).order('sort_order').order('name')
      .then(({ data }) => {
        if (off) return
        const list = ((data ?? []) as { id: string; name: string; email: string | null; include_in_emails: boolean }[])
          .filter(c => c.email && isEmail(c.email)).map(c => ({ ...c, email: c.email!.trim() }))
        setContacts(list)
        if (prefilled.current) return
        prefilled.current = true
        // Fill in once: To from the first contact when the client has no email, CC from the ticked contacts.
        const cur = latest.current
        const to = cur.to || list.find(c => c.include_in_emails)?.email || list[0]?.email || ''
        const cc = [...cur.cc]
        for (const c of list) {
          if (c.include_in_emails && !same(c.email, to) && !cc.some(x => same(x, c.email))) cc.push(c.email)
        }
        if (to !== cur.to || cc.length !== cur.cc.length) onChange({ ...cur, to, cc })
      })
    return () => { off = true }
  }, [companyId, clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (email: string) => contacts.find(c => same(c.email, email))?.name ?? null
  const inUse = (email: string) => same(email, value.to) || value.cc.some(x => same(x, email))

  function addCc(raw: string) {
    const parts = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
    if (!parts.length) { setDraft(''); setDraftErr(null); return }
    const bad = parts.filter(p => !isEmail(p))
    const good = parts.filter(p => isEmail(p) && !inUse(p))
    if (good.length) onChange({ ...value, cc: [...value.cc, ...good].slice(0, 10) })
    setDraft(bad.join(', '))
    setDraftErr(bad.length ? `"${bad[0]}" isn't an email address.` : null)
  }

  const known = (e: string) => (clientEmail && same(e, clientEmail)) || contacts.some(c => same(c.email, e))
  const newOnes = clientId ? [value.to, ...value.cc].filter(e => e && isEmail(e) && !known(e)) : []
  const others = contacts.filter(c => !inUse(c.email))
  const field = 'h-10 rounded-xl border border-divider px-3 text-[14px] bg-background text-text-primary focus:outline-none focus:border-primary/60 disabled:opacity-60'

  return (
    <div className="flex flex-col gap-3">
      {!ccOnly && <label className="flex flex-col gap-1.5 text-[12px] font-medium text-text-secondary">{toLabel}
        <input value={value.to} disabled={disabled} onChange={e => onChange({ ...value, to: e.target.value.trim() })}
          type="email" placeholder="name@company.co.za" list={contacts.length ? 'recipient-contacts' : undefined} className={field} />
        {nameOf(value.to) && <span className="text-[11.5px] text-text-secondary font-normal">{nameOf(value.to)}</span>}
      </label>}
      {contacts.length > 0 && (
        <datalist id="recipient-contacts">
          {contacts.map(c => <option key={c.id} value={c.email}>{c.name}</option>)}
        </datalist>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-text-secondary">CC <span className="font-normal">(optional)</span></span>
        {value.cc.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.cc.map(e => (
              <span key={e} className="inline-flex items-center gap-1 rounded-full bg-surface-elevated border border-divider pl-2.5 pr-1 py-0.5 text-[12.5px] text-text-primary max-w-full">
                <span className="truncate">{nameOf(e) ? <><span className="font-medium">{nameOf(e)}</span> · {e}</> : e}</span>
                <button type="button" disabled={disabled} aria-label={`Remove ${e}`} onClick={() => onChange({ ...value, cc: value.cc.filter(x => x !== e) })}
                  className="w-5 h-5 rounded-full text-text-secondary hover:bg-divider flex items-center justify-center shrink-0">
                  <span className="material-icons text-[14px]">close</span>
                </button>
              </span>
            ))}
          </div>
        )}
        <input value={draft} disabled={disabled || value.cc.length >= 10}
          onChange={e => { setDraft(e.target.value); setDraftErr(null) }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); addCc(draft) } }}
          onBlur={() => addCc(draft)}
          type="email" placeholder={value.cc.length >= 10 ? 'Up to 10 people' : 'Type an email and press Enter'} className={field} />
        {draftErr && <span className="text-[12px] text-error">{draftErr}</span>}
        {others.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] text-text-secondary">Contacts:</span>
            {others.map(c => (
              <button key={c.id} type="button" disabled={disabled || value.cc.length >= 10}
                onClick={() => value.to ? onChange({ ...value, cc: [...value.cc, c.email] }) : onChange({ ...value, to: c.email })}
                title={c.email}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-divider px-2.5 py-0.5 text-[12px] text-text-primary hover:bg-surface-elevated disabled:opacity-50">
                <span className="material-icons text-[13px]">add</span>{c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {newOnes.length > 0 && (
        <label className="flex items-start gap-2 text-[12.5px] text-text-primary">
          <input type="checkbox" checked={value.saveNew} disabled={disabled} onChange={e => onChange({ ...value, saveNew: e.target.checked })}
            className="mt-0.5 w-4 h-4 accent-[var(--color-primary,#1E3A5F)]" />
          <span>Save {newOnes.length === 1 ? newOnes[0] : `${newOnes.length} new addresses`} as {newOnes.length === 1 ? 'a contact' : 'contacts'} for this client, copied in next time</span>
        </label>
      )}
    </div>
  )
}

/** After a successful send: add the new addresses as client contacts ("include in emails" on). Best effort. */
export async function saveNewContacts(
  supabase: SupabaseClient,
  opts: { companyId: string; clientId: string; clientEmail?: string | null; emails: string[] },
): Promise<number> {
  const { data } = await supabase.from('client_contacts').select('email, sort_order')
    .eq('company_id', opts.companyId).eq('client_id', opts.clientId)
  const rows = (data ?? []) as { email: string | null; sort_order: number }[]
  const have = rows.map(r => (r.email ?? '').toLowerCase())
  if (opts.clientEmail) have.push(opts.clientEmail.toLowerCase())
  const fresh = [...new Set(opts.emails.map(e => e.trim()).filter(e => isEmail(e) && !have.includes(e.toLowerCase())))]
  if (!fresh.length) return 0
  let order = rows.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0)
  const { error } = await supabase.from('client_contacts').insert(fresh.map(email => ({
    company_id: opts.companyId, client_id: opts.clientId, email, include_in_emails: true, sort_order: ++order,
    // A readable name from the address ("thandi.mokoena@…" → "Thandi Mokoena"); it can be renamed on the client.
    name: email.split('@')[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || email,
  })))
  return error ? 0 : fresh.length
}
