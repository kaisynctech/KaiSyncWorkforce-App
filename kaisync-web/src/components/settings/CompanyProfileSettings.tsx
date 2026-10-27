'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CompanyMark } from '@/components/CompanyMark'
import { brandLogoUrl, clearBrandLogo, copyOldLogoIfNeeded, forgetBrand, prepareLogo, saveBrandLogo } from '@/lib/company-brand'
import type { Company } from '@/types/database'

type Props = {
  company: Company
  isOwner: boolean
  isHrOrAbove: boolean
  onSaved: (next: Company) => void
}

type Form = {
  name: string
  legal_name: string
  registration_number: string
  is_vat_registered: boolean
  vat_number: string
  contact_phone: string
  contact_email: string
  website: string
  address: string
  postal_address: string
  bank_account_holder: string
  bank_name: string
  bank_account_number: string
  bank_branch_code: string
  bank_account_type: string
  bank_swift_code: string
  show_bank_on_invoices: boolean
  show_bank_on_quotes: boolean
  document_footer: string
}

const ACCOUNT_TYPES = ['Current / Cheque', 'Business', 'Savings', 'Transmission']

function formOf(c: Company): Form {
  return {
    name: c.name ?? '',
    legal_name: c.legal_name ?? '',
    registration_number: c.registration_number ?? '',
    is_vat_registered: !!c.is_vat_registered,
    vat_number: c.vat_number ?? '',
    contact_phone: c.contact_phone ?? '',
    contact_email: c.contact_email ?? '',
    website: c.website ?? '',
    address: c.address ?? '',
    postal_address: c.postal_address ?? '',
    bank_account_holder: c.bank_account_holder ?? '',
    bank_name: c.bank_name ?? '',
    bank_account_number: c.bank_account_number ?? '',
    bank_branch_code: c.bank_branch_code ?? '',
    bank_account_type: c.bank_account_type ?? '',
    bank_swift_code: c.bank_swift_code ?? '',
    show_bank_on_invoices: c.show_bank_on_invoices ?? true,
    show_bank_on_quotes: c.show_bank_on_quotes ?? false,
    document_footer: c.document_footer ?? '',
  }
}

const input = 'input w-full'

function Card({ title, icon, hint, children }: { title: string; icon: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 bg-surface rounded-lg border border-divider overflow-hidden">
      <header className="px-4 py-3 border-b border-divider flex items-center gap-2">
        <span className="material-icons text-[18px] text-text-secondary" aria-hidden="true">{icon}</span>
        <div>
          <h2 className="text-[14px] font-semibold text-text-primary">{title}</h2>
          {hint && <p className="text-[12px] text-text-secondary">{hint}</p>}
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function F({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-[12px] font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

/**
 * Settings › General: the company's logo (shown on dashboards, portals and documents),
 * its details (letterhead on quotes, invoices, payslips and statements) and banking details.
 * Logo: HR and above. Details and banking: the owner (same rule as the company name).
 */
export function CompanyProfileSettings({ company, isOwner, isHrOrAbove, onSaved }: Props) {
  const [form, setForm] = useState<Form>(() => formOf(company))
  const [logoPath, setLogoPath] = useState<string | null>(company.brand_logo_path ?? null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoMsg, setLogoMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()
  const logoUrl = brandLogoUrl(supabase, logoPath)
  const readOnly = !isOwner
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(prev => ({ ...prev, [k]: v }))

  // A logo uploaded before logos became public is copied across once.
  useEffect(() => {
    if (company.brand_logo_path || !company.logo_url || !isHrOrAbove) return
    let cancelled = false
    void copyOldLogoIfNeeded(createClient(), company).then(path => { if (path && !cancelled) setLogoPath(path) })
    return () => { cancelled = true }
  }, [company, isHrOrAbove])

  async function upload(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setLogoMsg('Use a PNG, JPEG or WebP image.'); return }
    if (file.size > 8_000_000) { setLogoMsg('Use an image smaller than 8 MB.'); return }
    setLogoBusy(true); setLogoMsg(null)
    try {
      const png = await prepareLogo(file)
      const res = await saveBrandLogo(supabase, company.id, png)
      if (!res.ok) { setLogoMsg(res.message); return }
      setLogoPath(res.data)
      forgetBrand(company.code)
      onSaved({ ...company, brand_logo_path: res.data })
      setLogoMsg('Logo saved. It now shows on the dashboards, the portals and your documents.')
    } catch (e) {
      setLogoMsg(e instanceof Error ? e.message : 'Could not save the logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  async function removeLogo() {
    if (!window.confirm('Remove the company logo? Your initials badge shows instead.')) return
    setLogoBusy(true)
    const res = await clearBrandLogo(supabase, company.id)
    setLogoBusy(false)
    if (!res.ok) { setLogoMsg(res.message); return }
    setLogoPath(null)
    forgetBrand(company.code)
    onSaved({ ...company, brand_logo_path: null })
    setLogoMsg('Logo removed.')
  }

  async function save() {
    if (!form.name.trim()) { setMsg({ ok: false, text: 'The company name is required.' }); return }
    if (form.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email.trim())) {
      setMsg({ ok: false, text: 'Check the email address.' }); return
    }
    setBusy(true); setMsg(null)
    const clean = (v: string) => v.trim() || null
    const row = {
      name: form.name.trim(),
      legal_name: clean(form.legal_name),
      registration_number: clean(form.registration_number),
      is_vat_registered: form.is_vat_registered,
      vat_number: clean(form.vat_number),
      contact_phone: clean(form.contact_phone),
      contact_email: clean(form.contact_email),
      website: clean(form.website),
      address: clean(form.address),
      postal_address: clean(form.postal_address),
      bank_account_holder: clean(form.bank_account_holder),
      bank_name: clean(form.bank_name),
      bank_account_number: clean(form.bank_account_number.replace(/\s+/g, '')),
      bank_branch_code: clean(form.bank_branch_code),
      bank_account_type: clean(form.bank_account_type),
      bank_swift_code: clean(form.bank_swift_code.toUpperCase()),
      show_bank_on_invoices: form.show_bank_on_invoices,
      show_bank_on_quotes: form.show_bank_on_quotes,
      document_footer: clean(form.document_footer),
    }
    const { data, error } = await supabase.from('companies').update(row).eq('id', company.id).select('*').maybeSingle()
    setBusy(false)
    if (error || !data) {
      setMsg({ ok: false, text: error?.message && !/row-level|permission/i.test(error.message) ? error.message : 'Only the owner can change the company details.' })
      return
    }
    forgetBrand(company.code)
    onSaved(data as Company)
    setForm(formOf(data as Company))
    setMsg({ ok: true, text: 'Company details saved. They show on your quotes, invoices and payslips.' })
  }

  const bankComplete = !!(form.bank_name && form.bank_account_number)

  return (
    <>
      <Card title="Logo" icon="image" hint="Shown on your dashboard, your employees' app, the client and contractor portals, and on quotes, invoices and payslips.">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] items-start">
          <div className="space-y-3">
            <p className="text-[12px] font-medium text-text-secondary">How it looks</p>
            <div className="flex flex-wrap gap-3">
              <div className="rounded-lg bg-[#0f172a] px-3 py-2 flex items-center gap-2 min-w-[200px]">
                <CompanyMark name={form.name} logoUrl={logoUrl} size={32} />
                <span className="text-white text-[13px] font-semibold truncate">{form.name || 'Company'}</span>
              </div>
              <div className="rounded-lg border border-divider bg-white px-4 py-3 flex items-center gap-3 min-w-[260px]">
                {logoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={logoUrl} alt="" className="h-10 max-w-[120px] object-contain" />
                  : <CompanyMark name={form.name} logoUrl={null} size={40} />}
                <div className="text-[11px] text-slate-600 leading-tight">
                  <p className="text-[13px] font-semibold text-slate-900">{form.name || 'Company'}</p>
                  <p>{[form.contact_phone, form.contact_email].filter(Boolean).join(' · ') || 'Phone · email'}</p>
                  <p className="text-slate-400">Quote / invoice header</p>
                </div>
              </div>
            </div>
            {logoMsg && <p className="text-[12px] text-text-secondary" aria-live="polite">{logoMsg}</p>}
          </div>
          {isHrOrAbove && (
            <div className="flex flex-col gap-2">
              <button type="button" disabled={logoBusy} onClick={() => fileRef.current?.click()}
                className="h-9 px-4 rounded-md bg-primary text-white text-[13px] font-semibold disabled:opacity-50">
                {logoBusy ? 'Saving…' : logoUrl ? 'Change logo' : 'Upload logo'}
              </button>
              {logoUrl && (
                <button type="button" disabled={logoBusy} onClick={() => void removeLogo()}
                  className="h-9 px-4 rounded-md border border-border text-[13px] text-error disabled:opacity-50">Remove logo</button>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Upload company logo"
                onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
              <p className="text-[11px] text-text-secondary max-w-[200px]">PNG with a see-through background looks best. Empty borders are trimmed for you.</p>
            </div>
          )}
        </div>
      </Card>

      <Card title="Company details" icon="business" hint={readOnly ? 'Only the owner can change these.' : 'Printed on your quotes, invoices, payslips and statements.'}>
        <fieldset disabled={readOnly || busy} className="grid gap-3 sm:grid-cols-2">
          <F label="Company name (trading name) *">
            <input className={input} value={form.name} maxLength={200} onChange={e => set('name', e.target.value)} />
          </F>
          <F label="Registered name">
            <input className={input} value={form.legal_name} maxLength={200} placeholder="e.g. Winterstech (Pty) Ltd" onChange={e => set('legal_name', e.target.value)} />
          </F>
          <F label="Company registration number">
            <input className={input} value={form.registration_number} maxLength={60} placeholder="e.g. 2015/123456/07" onChange={e => set('registration_number', e.target.value)} />
          </F>
          <F label="VAT">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[13px] text-text-primary whitespace-nowrap">
                <input type="checkbox" className="accent-primary" checked={form.is_vat_registered} onChange={e => set('is_vat_registered', e.target.checked)} />
                VAT registered
              </label>
              <input className={input} value={form.vat_number} maxLength={30} placeholder="VAT number" disabled={!form.is_vat_registered || readOnly}
                onChange={e => set('vat_number', e.target.value)} />
            </div>
          </F>
          <F label="Phone">
            <input className={input} type="tel" value={form.contact_phone} maxLength={40} onChange={e => set('contact_phone', e.target.value)} />
          </F>
          <F label="Email">
            <input className={input} type="email" value={form.contact_email} maxLength={200} onChange={e => set('contact_email', e.target.value)} />
          </F>
          <F label="Website">
            <input className={input} value={form.website} maxLength={200} placeholder="www.example.co.za" onChange={e => set('website', e.target.value)} />
          </F>
          <F label="Company code">
            <div className="h-10 px-3 rounded-md border border-border bg-surface-elevated text-[13px] text-text-secondary flex items-center font-mono">{company.code ?? 'Not set'}</div>
          </F>
          <F label="Physical address">
            <textarea className={`${input} h-auto py-2`} rows={3} value={form.address} maxLength={500} onChange={e => set('address', e.target.value)} />
          </F>
          <F label="Postal address (if different)">
            <textarea className={`${input} h-auto py-2`} rows={3} value={form.postal_address} maxLength={500} onChange={e => set('postal_address', e.target.value)} />
          </F>
        </fieldset>
      </Card>

      <Card title="Banking details" icon="account_balance" hint="Where clients pay you. Choose where they are printed.">
        <fieldset disabled={readOnly || busy} className="grid gap-3 sm:grid-cols-2">
          <F label="Account holder">
            <input className={input} value={form.bank_account_holder} maxLength={200} onChange={e => set('bank_account_holder', e.target.value)} />
          </F>
          <F label="Bank">
            <input className={input} value={form.bank_name} maxLength={120} placeholder="e.g. FNB" onChange={e => set('bank_name', e.target.value)} />
          </F>
          <F label="Account number">
            <input className={input} inputMode="numeric" value={form.bank_account_number} maxLength={40} onChange={e => set('bank_account_number', e.target.value)} />
          </F>
          <F label="Branch code">
            <input className={input} inputMode="numeric" value={form.bank_branch_code} maxLength={20} onChange={e => set('bank_branch_code', e.target.value)} />
          </F>
          <F label="Account type">
            <select className={input} value={form.bank_account_type} onChange={e => set('bank_account_type', e.target.value)}>
              <option value="">—</option>
              {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              {form.bank_account_type && !ACCOUNT_TYPES.includes(form.bank_account_type) && <option value={form.bank_account_type}>{form.bank_account_type}</option>}
            </select>
          </F>
          <F label="SWIFT code (for payments from abroad)">
            <input className={input} value={form.bank_swift_code} maxLength={20} onChange={e => set('bank_swift_code', e.target.value)} />
          </F>
          <div className="sm:col-span-2 flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-[13px] text-text-primary">
              <input type="checkbox" className="accent-primary" checked={form.show_bank_on_invoices} onChange={e => set('show_bank_on_invoices', e.target.checked)} />
              Show on invoices
            </label>
            <label className="flex items-center gap-2 text-[13px] text-text-primary">
              <input type="checkbox" className="accent-primary" checked={form.show_bank_on_quotes} onChange={e => set('show_bank_on_quotes', e.target.checked)} />
              Show on quotes
            </label>
            {!bankComplete && (form.show_bank_on_invoices || form.show_bank_on_quotes) && (
              <span className="text-[12px] text-text-secondary">Add the bank and account number for them to print.</span>
            )}
          </div>
          <F label="Note at the bottom of documents (optional)" wide>
            <textarea className={`${input} h-auto py-2`} rows={2} value={form.document_footer} maxLength={1000}
              placeholder="e.g. Payment due within 30 days. Use the invoice number as reference."
              onChange={e => set('document_footer', e.target.value)} />
          </F>
        </fieldset>
      </Card>

      {isOwner && (
        <div className="flex items-center gap-3 mb-4">
          <button type="button" onClick={() => void save()} disabled={busy}
            className="h-10 px-5 rounded-md bg-primary text-white text-[13px] font-semibold disabled:opacity-50">
            {busy ? 'Saving…' : 'Save company details'}
          </button>
          {msg && <p className={`text-[13px] ${msg.ok ? 'text-success' : 'text-error'}`} role={msg.ok ? undefined : 'alert'}>{msg.text}</p>}
        </div>
      )}
    </>
  )
}
