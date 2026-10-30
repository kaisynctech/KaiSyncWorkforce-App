'use client'

import { useEffect, useState } from 'react'
import { getProfile, updateProfile } from '@/lib/client-portal/api'
import type { ClientPortalSession } from '@/lib/client-portal/session'
import { usePortalMode } from '@/lib/client-portal/portal-mode'
import { moneyZAR } from '@/lib/client-portal/quotation'
import { CLIENT_EDITABLE_FIELDS, type ClientEditableField, type ClientPortalProfile } from '@/lib/client-portal/types'

const LABELS: Record<ClientEditableField, string> = {
  name: 'Company name *',
  legal_name: 'Legal / registered name',
  company_number: 'Registration number',
  vat_number: 'VAT number',
  contact_person: 'Contact person',
  email: 'Email',
  phone: 'Phone',
  mobile: 'Mobile',
  direct_line: 'Direct line',
  fax: 'Fax',
  website: 'Website',
  address: 'Physical address',
  billing_address: 'Billing address',
}

const GROUPS: { title: string; fields: ClientEditableField[] }[] = [
  { title: 'Company', fields: ['name', 'legal_name', 'company_number', 'vat_number', 'website'] },
  { title: 'Contact', fields: ['contact_person', 'email', 'phone', 'mobile', 'direct_line', 'fax'] },
  { title: 'Addresses', fields: ['address', 'billing_address'] },
]

function toForm(p: ClientPortalProfile): Record<ClientEditableField, string> {
  const out = {} as Record<ClientEditableField, string>
  for (const f of CLIENT_EDITABLE_FIELDS) out[f] = (p[f] as string | null) ?? ''
  return out
}

/** "My information": the client views and updates their own details. */
export function ClientPortalInformation({ session }: { session: ClientPortalSession }) {
  const mode = usePortalMode()
  const canEdit = mode.kind === 'portal' || (mode.canAct && mode.canEditDetails)
  const [profile, setProfile] = useState<ClientPortalProfile | null>(null)
  const [form, setForm] = useState<Record<ClientEditableField, string> | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getProfile(session.company_code, session.client_code)
      .then(p => { if (!cancelled) { setProfile(p); if (p) setForm(toForm(p)) } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your details.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [session.company_code, session.client_code])

  async function save() {
    if (!form) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const p = await updateProfile(session.company_code, session.client_code, form)
      if (p) { setProfile(p); setForm(toForm(p)) }
      setEditing(false)
      setSaved(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save your details.')
    }
    setSaving(false)
  }

  if (loading) return <div className="py-16 text-center text-text-secondary text-[14px]">Loading…</div>
  if (!profile || !form) {
    return <div className="py-16 text-center text-text-secondary text-[13px]">{error ?? 'Your details could not be loaded.'}</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <p className="text-[12px] text-text-secondary">
          Keep your details up to date. Changes are saved straight away and shared with our team.
        </p>
        {!editing && canEdit && (
          <button
            type="button"
            onClick={() => { setEditing(true); setSaved(false); setError(null) }}
            className="h-9 px-4 rounded-lg bg-primary text-white text-[12px] font-semibold shrink-0"
          >
            Edit details
          </button>
        )}
      </div>

      {saved && (
        <div className="bg-success/10 border border-success/30 rounded-xl px-4 py-3 text-[13px] text-success font-semibold">
          Your details were saved and our team has been notified.
        </div>
      )}
      {error && (
        <div className="bg-error/10 border border-error/25 rounded-xl px-4 py-3 text-[13px] text-error font-semibold">{error}</div>
      )}

      {GROUPS.map(g => (
        <section key={g.title} className="border-divider bg-surface rounded-xl border overflow-hidden">
          <div className="border-divider px-4 py-2.5 border-b">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{g.title}</p>
          </div>
          <div className="px-4 py-3 grid gap-3 md:grid-cols-2">
            {g.fields.map(f => (
              <div key={f} className={f === 'address' || f === 'billing_address' ? 'md:col-span-2 space-y-1' : 'space-y-1'}>
                <label className="text-[11px] font-semibold text-text-secondary uppercase">{LABELS[f]}</label>
                {editing ? (
                  f === 'address' || f === 'billing_address' ? (
                    <textarea
                      className="bg-surface border border-divider text-text-primary w-full min-h-[64px] px-3 py-2 rounded-lg text-[13px]"
                      value={form[f]}
                      maxLength={1000}
                      onChange={e => setForm({ ...form, [f]: e.target.value })}
                    />
                  ) : (
                    <input
                      className="bg-surface border border-divider text-text-primary w-full h-10 px-3 rounded-lg text-[13px]"
                      value={form[f]}
                      maxLength={1000}
                      type={f === 'email' ? 'email' : 'text'}
                      onChange={e => setForm({ ...form, [f]: e.target.value })}
                    />
                  )
                ) : (
                  <p className="text-[13px] text-text-primary whitespace-pre-wrap">{profile[f] || '—'}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {editing && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="h-10 px-5 rounded-xl bg-primary text-white text-[13px] font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => { setForm(toForm(profile)); setEditing(false); setError(null) }}
            className="h-10 px-5 rounded-xl border border-divider text-text-primary text-[13px] font-semibold"
          >
            Cancel
          </button>
        </div>
      )}

      <section className="border-divider bg-surface rounded-xl border overflow-hidden">
        <div className="border-divider px-4 py-2.5 border-b">
          <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Account (managed by our team)</p>
        </div>
        <div className="px-4 py-3 grid gap-2 md:grid-cols-2 text-[13px]">
          <Row label="Client code" value={profile.client_code || '—'} />
          <Row label="Account number" value={profile.account_number || '—'} />
          <Row label="Payment terms" value={profile.payment_terms_days != null ? `${profile.payment_terms_days} days` : '—'} />
          <Row label="Credit limit" value={profile.credit_limit != null ? moneyZAR(profile.credit_limit) : '—'} />
          <Row label="Tax exempt" value={profile.tax_exempt ? 'Yes' : 'No'} />
        </div>
        <p className="px-4 pb-3 text-[12px] text-text-secondary">To change these, send us a message.</p>
      </section>

      {profile.contacts.length > 0 && (
        <section className="border-divider bg-surface rounded-xl border overflow-hidden">
          <div className="border-divider px-4 py-2.5 border-b">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">People we email</p>
          </div>
          <div className="px-4 py-3 space-y-1 text-[13px]">
            {profile.contacts.map(c => (
              <p key={c.id} className="text-text-primary">{c.name}{c.email ? <span className="text-text-secondary"> · {c.email}</span> : null}</p>
            ))}
            <p className="pt-1 text-[12px] text-text-secondary">To add or remove people, send us a message.</p>
          </div>
        </section>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary text-right">{value}</span>
    </div>
  )
}
