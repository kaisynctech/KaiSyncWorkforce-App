'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { PARTNER_KIND, type PartnerKind } from '@/lib/partner-kinds'
import { createSupplier } from '@/lib/suppliers'

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-secondary font-medium">{label}</label>
      {children}
    </div>
  )
}

/** Dedicated supplier create — procurement partner, not field contractor. */
export default function NewSupplierPage() {
  const router = useRouter()

  const [partnerKind, setPartnerKind] = useState<PartnerKind>(PARTNER_KIND.supplier)
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
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [permsLoaded, setPermsLoaded] = useState(false)

  const canEdit = can(perms, PERM.suppliersEdit)
  const canCreateDual = can(perms, PERM.contractorsCreate)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { setPermsLoaded(true); return }
      const { data: me } = await supabase
        .from('employees')
        .select('access_level')
        .eq('id', member.employeeId)
        .maybeSingle()
      setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))
      setPermsLoaded(true)
    })()
  }, [])

  async function save() {
    if (!canEdit) { setError('You do not have permission to create suppliers.'); return }
    if (!name.trim()) { setError('Supplier name is required.'); return }
    if (partnerKind !== PARTNER_KIND.supplier && partnerKind !== PARTNER_KIND.both) {
      setError('Choose Supplier or Contractor & supplier.')
      return
    }
    if (partnerKind === PARTNER_KIND.both && !canCreateDual) {
      setError('Creating a dual contractor & supplier requires contractors.create permission.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Account not linked to an active employee.'); setBusy(false); return }

    const created = await createSupplier(supabase, {
      companyId: member.companyId,
      name,
      partnerKind,
      contactPerson,
      phone,
      email,
      address,
      taxNumber,
      registrationNumber,
      isVatRegistered,
      vatNumber,
      notes,
      bankName,
      bankAccount,
      accountHolderName: accountHolder,
      bankBranchCode: branchCode,
      accountType,
      paymentTerms,
      preferredPaymentMethod: paymentMethod,
    })

    if (!created.ok) {
      setError(created.message)
      setBusy(false)
      return
    }

    router.push(`/dashboard/suppliers/${created.data.id}`)
    setBusy(false)
  }

  if (permsLoaded && !canEdit) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2 px-4">
          <span className="material-icons text-[48px] text-text-disabled">lock</span>
          <p className="text-[14px] font-semibold text-text-primary">Permission required</p>
          <p className="text-[13px] text-text-secondary">You do not have permission to create suppliers.</p>
          <Link href="/dashboard/suppliers" className="text-primary text-[13px]">Back to suppliers</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/suppliers" className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-[20px] font-semibold text-text-primary">New Supplier</h1>
            <p className="text-[11px] text-text-secondary">Procurement partner — separate from field contractors</p>
          </div>
        </div>
        <button
          onClick={() => void save()}
          disabled={busy || !canEdit}
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
          <Field label="Role">
            <select
              value={partnerKind}
              onChange={e => setPartnerKind(e.target.value as PartnerKind)}
              className="dark-entry w-full"
            >
              <option value={PARTNER_KIND.supplier}>Supplier only</option>
              <option value={PARTNER_KIND.both} disabled={!canCreateDual}>
                Also acts as contractor{!canCreateDual ? ' (needs contractors.create)' : ''}
              </option>
            </select>
          </Field>
          {partnerKind === PARTNER_KIND.both && (
            <p className="text-[11px] text-text-secondary">
              Dual partners get a contractor code and appear under Contractors for job assignment.
              Requires contractors.create permission.
            </p>
          )}
          <Field label="Supplier / trading name *">
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
