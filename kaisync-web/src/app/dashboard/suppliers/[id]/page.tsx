'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { SectionCard, FormField, entryClass } from '@/components/SectionCard'
import { FormSelect } from '@/components/FormSelect'
import { Toggle } from '@/components/Toggle'
import { isSupplierKind, PARTNER_KIND, type PartnerKind } from '@/lib/partner-kinds'
import type { ComplianceDocument, Contractor, InventoryItem } from '@/types/database'

const TABS = ['Information', 'Payments', 'Inventory', 'Compliance'] as const
type Tab = (typeof TABS)[number]

const ACCOUNT_TYPES = ['Cheque / Current', 'Savings', 'Transmission']
const PAYMENT_TERMS_OPTIONS = ['7 days', '14 days', '30 days', '60 days', 'On completion']
const PAYMENT_METHODS = ['EFT', 'Cheque', 'Cash', 'Credit Card']
const COMPLIANCE_PACKS = ['Standard', 'Premium', 'Basic', 'Government']

const fmtR = (n: number) =>
  `R ${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * Supplier detail — procurement UX only.
 * Storage remains `contractors` with partner_kind supplier|both.
 */
export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const supplierId = params.id

  const [tab, setTab] = useState<Tab>('Information')
  const [supplier, setSupplier] = useState<Contractor | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [partnerKind, setPartnerKind] = useState<PartnerKind>(PARTNER_KIND.supplier)
  const [regNumber, setRegNumber] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [taxNumber, setTaxNumber] = useState('')
  const [isVatRegistered, setIsVatRegistered] = useState(false)
  const [vatNumber, setVatNumber] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')

  const [accHolder, setAccHolder] = useState('')
  const [payBankName, setPayBankName] = useState('')
  const [payAccNumber, setPayAccNumber] = useState('')
  const [payBranchCode, setPayBranchCode] = useState('')
  const [paySwiftBic, setPaySwiftBic] = useState('')
  const [payAccountType, setPayAccountType] = useState('')
  const [payTerms, setPayTerms] = useState('')
  const [payMethod, setPayMethod] = useState('')
  const [bankingVerified, setBankingVerified] = useState(false)
  const [paymentHold, setPaymentHold] = useState(false)
  const [complianceHold, setComplianceHold] = useState(false)
  const [compliancePack, setCompliancePack] = useState('')
  const [complianceDocs, setComplianceDocs] = useState<ComplianceDocument[]>([])

  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(false)

  const [xeroLink, setXeroLink] = useState<{ xero_contact_id: string; last_synced_at: string } | null>(null)
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroPushing, setXeroPushing] = useState(false)
  const [sessionToken, setSessionToken] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { data: c, error: qErr } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', supplierId)
      .single()

    if (qErr || !c) {
      setError(qErr?.message ?? 'Supplier not found')
      router.push('/dashboard/suppliers')
      return
    }

    const cont = c as Contractor & { partner_kind?: string | null; registration_number?: string | null }
    if (!isSupplierKind(cont.partner_kind) && cont.is_supplier !== true) {
      router.replace(`/dashboard/contractors/${supplierId}`)
      return
    }

    setSupplier(cont)
    setName(cont.name ?? '')
    setPartnerKind(
      cont.partner_kind === PARTNER_KIND.both ? PARTNER_KIND.both : PARTNER_KIND.supplier,
    )
    setRegNumber(cont.registration_number ?? '')
    setIsActive(cont.is_active ?? true)
    setTaxNumber(cont.tax_number ?? '')
    setIsVatRegistered(cont.is_vat_registered ?? false)
    setVatNumber(cont.vat_number ?? '')
    setContactPerson(cont.contact_person ?? '')
    setPhone(cont.phone ?? '')
    setEmail(cont.email ?? '')
    setAddress(cont.address ?? '')
    setNotes(cont.notes ?? '')
    setAccHolder(cont.account_holder_name ?? '')
    setPayBankName(cont.bank_name ?? '')
    setPayAccNumber(cont.bank_account ?? '')
    setPayBranchCode(cont.branch_code ?? '')
    setPaySwiftBic(cont.swift_bic ?? '')
    setPayAccountType(cont.account_type ?? '')
    setPayTerms(cont.payment_terms ?? '')
    setPayMethod(cont.preferred_payment_method ?? '')
    setBankingVerified(cont.is_banking_verified ?? false)
    setPaymentHold(cont.payment_hold ?? false)
    setComplianceHold(cont.compliance_hold ?? false)
    setCompliancePack(cont.compliance_pack ?? '')

    const { data: docs } = await supabase
      .from('compliance_documents')
      .select('*')
      .eq('contractor_id', supplierId)
    setComplianceDocs((docs ?? []) as ComplianceDocument[])

    const cId = cont.company_id
    const { data: xStatus } = await (supabase.rpc as any)('get_xero_connection_status', { p_company_id: cId })
    setXeroConnected(xStatus?.connected ?? false)
    if (xStatus?.connected) {
      const { data: lnk } = await (supabase.rpc as any)('get_xero_link_for_record', {
        p_company_id: cId, p_record_type: 'contractor', p_record_id: supplierId,
      })
      setXeroLink(lnk ?? null)
    }
    const { data: { session } } = await supabase.auth.getSession()
    setSessionToken(session?.access_token ?? null)
    setLoading(false)
  }, [supplierId, router])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (tab !== 'Inventory') return
    void (async () => {
      setInventoryLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('supplier_contractor_id', supplierId)
        .order('name')
      setInventory((data ?? []) as InventoryItem[])
      setInventoryLoading(false)
    })()
  }, [tab, supplierId])

  async function handleSave() {
    if (!name.trim()) { setError('Supplier name is required.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase
      .from('contractors')
      .update({
        name: name.trim(),
        partner_kind: partnerKind,
        is_supplier: true,
        registration_number: regNumber.trim() || null,
        tax_number: taxNumber.trim() || null,
        is_vat_registered: isVatRegistered,
        vat_number: isVatRegistered ? (vatNumber.trim() || null) : null,
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        is_active: isActive,
        compliance_pack: compliancePack || null,
        account_holder_name: accHolder.trim() || null,
        bank_name: payBankName.trim() || null,
        bank_account: payAccNumber.trim() || null,
        branch_code: payBranchCode.trim() || null,
        swift_bic: paySwiftBic.trim() || null,
        account_type: payAccountType || null,
        payment_terms: payTerms || null,
        preferred_payment_method: payMethod || null,
        is_banking_verified: bankingVerified,
        payment_hold: paymentHold,
        compliance_hold: complianceHold,
      })
      .eq('id', supplierId)

    if (e) setError(e.message)
    else setSupplier(prev => prev ? { ...prev, name: name.trim(), is_active: isActive, partner_kind: partnerKind } : prev)
    setSaving(false)
  }

  async function pushToXero() {
    if (!supplier?.company_id || !sessionToken || xeroPushing) return
    setXeroPushing(true)
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: supplier.company_id,
          record_id: supplierId,
          record_type: 'contractor',
        }),
      })
      const data = await resp.json()
      if (data.ok) setXeroLink({ xero_contact_id: data.xero_contact_id, last_synced_at: new Date().toISOString() })
      else setError(data.error ?? 'Xero sync failed')
    } catch {
      setError('Xero sync failed')
    } finally {
      setXeroPushing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard/suppliers" className="text-text-secondary hover:text-text-primary transition-colors shrink-0">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold text-text-primary truncate">{supplier?.name ?? 'Supplier'}</h1>
            <p className="text-[11px] text-text-secondary">
              Supplier{partnerKind === PARTNER_KIND.both ? ' · also contractor' : ''}
            </p>
            {xeroConnected && (
              <div className="flex items-center gap-2 mt-1">
                {xeroLink ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-[12px] text-green-400">
                      <span className="text-[14px]">✓</span> Synced to Xero
                    </span>
                    <button onClick={() => void pushToXero()} disabled={xeroPushing}
                      className="text-[11px] text-[#13B5EA] hover:opacity-70 disabled:opacity-40">
                      Update in Xero
                    </button>
                  </>
                ) : (
                  <button onClick={() => void pushToXero()} disabled={xeroPushing}
                    className="inline-flex items-center gap-1 text-[12px] px-3 py-1 rounded border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors">
                    {xeroPushing ? 'Pushing…' : '+ Push to Xero'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="h-10 px-5 text-[14px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors shrink-0"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <p className="px-4 py-2 text-error text-[13px] shrink-0">{error}</p>}

      <div className="flex gap-1 px-4 pt-2 border-b border-divider shrink-0 overflow-x-auto">
        {TABS.map(t => {
          const active = tab === t
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {t}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'Information' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
            <SectionCard title="SUPPLIER DETAILS">
              <FormField label="Supplier / trading name *">
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Supplier name" required className={entryClass} />
              </FormField>
              <FormSelect label="Role" value={partnerKind} onChange={e => setPartnerKind(e.target.value as PartnerKind)}>
                <option value={PARTNER_KIND.supplier}>Supplier only</option>
                <option value={PARTNER_KIND.both}>Also acts as contractor</option>
              </FormSelect>
              {partnerKind === PARTNER_KIND.both && (
                <p className="text-[11px] text-text-secondary">
                  This partner also appears under Contractors. Job / portal tools live there.
                </p>
              )}
              <FormField label="Registration number">
                <input type="text" value={regNumber} onChange={e => setRegNumber(e.target.value)}
                  placeholder="e.g. 2023/123456/07" className={entryClass} />
              </FormField>
              <div className="flex items-center justify-between py-1">
                <p className="text-[14px] font-medium text-text-primary">Active</p>
                <Toggle checked={isActive} onChange={setIsActive} />
              </div>
            </SectionCard>

            <SectionCard title="TAX & IDENTIFICATION">
              <FormField label="Tax number">
                <input type="text" value={taxNumber} onChange={e => setTaxNumber(e.target.value)}
                  className={entryClass} />
              </FormField>
              <div className="flex items-center justify-between py-1">
                <p className="text-[14px] font-medium text-text-primary">VAT Registered</p>
                <Toggle checked={isVatRegistered} onChange={setIsVatRegistered} />
              </div>
              <FormField label="VAT number">
                <input type="text" value={vatNumber} onChange={e => setVatNumber(e.target.value)}
                  disabled={!isVatRegistered} className={entryClass} />
              </FormField>
            </SectionCard>

            <SectionCard title="CONTACT">
              <FormField label="Contact person">
                <input type="text" value={contactPerson} onChange={e => setContactPerson(e.target.value)} className={entryClass} />
              </FormField>
              <FormField label="Phone">
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={entryClass} />
              </FormField>
              <FormField label="Email">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={entryClass} />
              </FormField>
              <FormField label="Address">
                <input type="text" value={address} onChange={e => setAddress(e.target.value)} className={entryClass} />
              </FormField>
            </SectionCard>

            <SectionCard title="NOTES">
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Internal notes about this supplier…"
                rows={3} className={`${entryClass} resize-none h-auto min-h-[72px] py-3`} />
            </SectionCard>
          </div>
        )}

        {tab === 'Payments' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
            <div className="card p-4 space-y-3">
              <p className="section-label">BANKING DETAILS</p>
              <input placeholder="Account holder name *" value={accHolder}
                onChange={e => setAccHolder(e.target.value)} className="dark-entry" />
              <input placeholder="Bank name" value={payBankName}
                onChange={e => setPayBankName(e.target.value)} className="dark-entry" />
              <input placeholder="Account number" value={payAccNumber}
                onChange={e => setPayAccNumber(e.target.value)} className="dark-entry" />
              <input placeholder="Branch code" value={payBranchCode}
                onChange={e => setPayBranchCode(e.target.value)} inputMode="numeric" className="dark-entry" />
              <FormSelect value={payAccountType} onChange={e => setPayAccountType(e.target.value)}>
                <option value="">Account type…</option>
                {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </FormSelect>
              <input placeholder="SWIFT / BIC" value={paySwiftBic}
                onChange={e => setPaySwiftBic(e.target.value)} className="dark-entry" />
            </div>

            <div className="card p-4 space-y-3">
              <p className="section-label">PAYMENT SETTINGS</p>
              <FormSelect value={payTerms} onChange={e => setPayTerms(e.target.value)}>
                <option value="">Payment terms…</option>
                {PAYMENT_TERMS_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </FormSelect>
              <FormSelect value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                <option value="">Preferred payment method…</option>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </FormSelect>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-text-primary text-[14px]">Banking Verified</p>
                  <p className="text-text-secondary text-[11px]">Bank details confirmed against proof of banking.</p>
                </div>
                <Toggle checked={bankingVerified} onChange={setBankingVerified} activeColor="#16A34A" />
              </div>
              <div className="h-px bg-divider" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[14px]" style={{ color: paymentHold ? '#F59E0B' : 'var(--color-text-primary)' }}>Payment Hold</p>
                  <p className="text-text-secondary text-[11px]">Blocks payouts to this supplier.</p>
                </div>
                <Toggle checked={paymentHold} onChange={setPaymentHold} activeColor="#D97706" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[14px]" style={{ color: complianceHold ? '#EF4444' : 'var(--color-text-primary)' }}>Compliance Hold</p>
                  <p className="text-text-secondary text-[11px]">Blocks payments when compliance is incomplete.</p>
                </div>
                <Toggle checked={complianceHold} onChange={setComplianceHold} activeColor="#DC2626" />
              </div>
            </div>
          </div>
        )}

        {tab === 'Inventory' && (
          <div className="flex-1 overflow-auto">
            <div className="px-4 py-2 flex items-center justify-between border-b border-divider">
              <p className="text-xs text-text-secondary">
                Items linked to this supplier
              </p>
              <button
                onClick={() => router.push('/dashboard/inventory/new')}
                className="text-[13px] text-primary hover:opacity-70"
              >
                + Inventory item
              </button>
            </div>
            {inventoryLoading ? (
              <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
            ) : (
              <table className="w-full" style={{ minWidth: 640 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th text-left">Item</th>
                    <th className="data-th text-left">SKU</th>
                    <th className="data-th text-right">On hand</th>
                    <th className="data-th text-right">Unit cost</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="data-td text-center text-text-secondary py-10">
                        No inventory items linked yet.
                      </td>
                    </tr>
                  ) : inventory.map(item => (
                    <tr
                      key={item.id}
                      className="bg-surface-card cursor-pointer hover:bg-background border-b border-divider"
                      onClick={() => router.push(`/dashboard/inventory/${item.id}`)}
                    >
                      <td className="data-td text-sm font-medium text-primary">{item.name}</td>
                      <td className="data-td text-sm text-text-secondary">{item.sku ?? '—'}</td>
                      <td className="data-td text-sm text-right">{item.quantity_on_hand}</td>
                      <td className="data-td text-sm text-right">{fmtR(item.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'Compliance' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
            <SectionCard title="COMPLIANCE PACK">
              <FormSelect label="Pack" value={compliancePack} onChange={e => setCompliancePack(e.target.value)}>
                <option value="">None</option>
                {COMPLIANCE_PACKS.map(p => <option key={p} value={p}>{p}</option>)}
              </FormSelect>
            </SectionCard>
            <SectionCard title="DOCUMENTS">
              {complianceDocs.length === 0 ? (
                <p className="text-[13px] text-text-secondary">No compliance documents on file.</p>
              ) : (
                <ul className="space-y-2">
                  {complianceDocs.map(doc => (
                    <li key={doc.id} className="flex items-center justify-between text-[13px] border-b border-divider py-2">
                      <span className="text-text-primary">{doc.document_type}</span>
                      <span className="text-text-secondary capitalize">{doc.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  )
}
