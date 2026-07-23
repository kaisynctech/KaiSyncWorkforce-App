'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  isContractorKind,
  nextContractorCode,
  partnerKindFromQuery,
  partnerKindLabel,
  PARTNER_KIND,
  type PartnerKind,
} from '@/lib/partner-kinds'

const ACCOUNT_TYPES = [
  { value: 'cheque', label: 'Cheque / Current' },
  { value: 'savings', label: 'Savings' },
  { value: 'transmission', label: 'Transmission' },
]
const PAYMENT_TERMS = [
  { value: '7_days', label: '7 days' },
  { value: '14_days', label: '14 days' },
  { value: '30_days', label: '30 days' },
  { value: '60_days', label: '60 days' },
  { value: 'on_completion', label: 'On completion' },
]
const PAYMENT_METHODS = [
  { value: 'eft', label: 'EFT' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit_card', label: 'Credit Card' },
]

function NewContractorForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialKind = partnerKindFromQuery(searchParams.get('type'))

  const [partnerKind, setPartnerKind] = useState<PartnerKind>(initialKind)
  const [name, setName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [taxNumber, setTaxNumber] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [isVatRegistered, setIsVatRegistered] = useState(false)
  const [vatNumber, setVatNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [accountHolder, setAccountHolder] = useState('')
  const [branchCode, setBranchCode] = useState('')
  const [accountType, setAccountType] = useState('cheque')
  const [paymentTerms, setPaymentTerms] = useState('30_days')
  const [paymentMethod, setPaymentMethod] = useState('eft')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const title = `New ${partnerKindLabel(partnerKind)}`
  const backHref = partnerKind === PARTNER_KIND.supplier ? '/dashboard/suppliers' : '/dashboard/contractors'

  async function save() {
    if (!name.trim()) { setError('Company / partner name is required.'); return }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Account not linked to an active employee.'); setBusy(false); return }

    let contractorCode: string | null = null
    if (isContractorKind(partnerKind)) {
      const [{ data: company }, { data: existing }] = await Promise.all([
        supabase.from('companies').select('company_code').eq('id', member.companyId).maybeSingle(),
        supabase.from('contractors').select('contractor_code').eq('company_id', member.companyId),
      ])
      const companyCode = (company as { company_code?: string | null } | null)?.company_code ?? ''
      contractorCode = nextContractorCode(
        companyCode,
        (existing ?? []).map(r => (r as { contractor_code: string | null }).contractor_code),
      )
    }

    const payload = {
      company_id: member.companyId,
      name: name.trim(),
      partner_kind: partnerKind,
      contractor_code: contractorCode,
      contact_person: contactPerson.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      tax_number: taxNumber.trim() || null,
      registration_number: registrationNumber.trim() || null,
      is_vat_registered: isVatRegistered,
      vat_number: isVatRegistered ? (vatNumber.trim() || null) : null,
      notes: notes.trim() || null,
      bank_name: bankName.trim() || null,
      bank_account: bankAccount.trim() || null,
      account_holder_name: accountHolder.trim() || null,
      branch_code: branchCode.trim() || null,
      account_type: accountType || null,
      payment_terms: paymentTerms || null,
      preferred_payment_method: paymentMethod || null,
      is_active: true,
      rating: 0,
      is_banking_verified: false,
      payment_hold: false,
      compliance_hold: false,
      // Legacy flag for older web lists that still filter is_supplier
      is_supplier: partnerKind === PARTNER_KIND.supplier || partnerKind === PARTNER_KIND.both,
    }

    const { data, error: insertErr } = await supabase
      .from('contractors')
      .insert(payload)
      .select('id')
      .single()

    if (insertErr) {
      setError(insertErr.message)
      setBusy(false)
      return
    }

    router.push(`/dashboard/contractors/${data.id}`)
    setBusy(false)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <Link href={backHref} className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-[20px] font-semibold text-text-primary">{title}</h1>
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="h-10 px-5 text-[14px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
        {error && (
          <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[13px] text-error">
            {error}
          </div>
        )}

        <section className="card p-4 space-y-3">
          <p className="section-label">GENERAL</p>
          <Field label="Partner kind">
            <select
              value={partnerKind}
              onChange={e => setPartnerKind(e.target.value as PartnerKind)}
              className="dark-entry w-full"
            >
              <option value={PARTNER_KIND.contractor}>Contractor</option>
              <option value={PARTNER_KIND.supplier}>Supplier</option>
              <option value={PARTNER_KIND.both}>Contractor &amp; supplier</option>
            </select>
          </Field>
          <Field label="Company / partner name *">
            <input value={name} onChange={e => setName(e.target.value)} className="dark-entry w-full" autoFocus />
          </Field>
          <Field label="Registration number">
            <input value={registrationNumber} onChange={e => setRegistrationNumber(e.target.value)} className="dark-entry w-full" />
          </Field>
          <Field label="Tax number">
            <input value={taxNumber} onChange={e => setTaxNumber(e.target.value)} className="dark-entry w-full" />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-text-primary">
            <input type="checkbox" checked={isVatRegistered} onChange={e => setIsVatRegistered(e.target.checked)} />
            VAT registered
          </label>
          {isVatRegistered && (
            <Field label="VAT number">
              <input value={vatNumber} onChange={e => setVatNumber(e.target.value)} className="dark-entry w-full" />
            </Field>
          )}
        </section>

        <section className="card p-4 space-y-3">
          <p className="section-label">CONTACT</p>
          <Field label="Contact person">
            <input value={contactPerson} onChange={e => setContactPerson(e.target.value)} className="dark-entry w-full" />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={e => setPhone(e.target.value)} className="dark-entry w-full" />
          </Field>
          <Field label="Email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="dark-entry w-full" />
          </Field>
          <Field label="Address">
            <textarea value={address} onChange={e => setAddress(e.target.value)} className="dark-entry w-full min-h-[72px]" />
          </Field>
          <Field label="Notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className="dark-entry w-full min-h-[72px]" />
          </Field>
        </section>

        <section className="card p-4 space-y-3">
          <p className="section-label">BANKING (OPTIONAL)</p>
          <Field label="Account holder">
            <input value={accountHolder} onChange={e => setAccountHolder(e.target.value)} className="dark-entry w-full" />
          </Field>
          <Field label="Bank name">
            <input value={bankName} onChange={e => setBankName(e.target.value)} className="dark-entry w-full" />
          </Field>
          <Field label="Account number">
            <input value={bankAccount} onChange={e => setBankAccount(e.target.value)} className="dark-entry w-full" />
          </Field>
          <Field label="Branch code">
            <input value={branchCode} onChange={e => setBranchCode(e.target.value)} className="dark-entry w-full" />
          </Field>
          <Field label="Account type">
            <select value={accountType} onChange={e => setAccountType(e.target.value)} className="dark-entry w-full">
              {ACCOUNT_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Payment terms">
            <select value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} className="dark-entry w-full">
              {PAYMENT_TERMS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Payment method">
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="dark-entry w-full">
              {PAYMENT_METHODS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </section>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-secondary font-medium">{label}</label>
      {children}
    </div>
  )
}

export default function NewContractorPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full text-[13px] text-text-secondary">Loading…</div>
    }>
      <NewContractorForm />
    </Suspense>
  )
}
