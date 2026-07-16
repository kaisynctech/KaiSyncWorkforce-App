'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Contractor {
  id: string
  name: string
  registration_number: string | null
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  bank_account: string | null
  bank_name: string | null
  bank_branch_code: string | null
  rating: number | null
  is_active: boolean
  partner_kind: string | null
  contractor_code: string | null
  is_vat_registered: boolean | null
  vat_number: string | null
  tax_number: string | null
  payment_terms: string | null
  preferred_payment_method: string | null
  payment_hold: boolean | null
  compliance_hold: boolean | null
  banking_verified: boolean | null
  account_holder_name: string | null
  account_type: string | null
  swift_bic: string | null
}

function maskAccount(acct: string | null): string {
  if (!acct) return '—'
  if (acct.length <= 4) return acct
  return `•••• ${acct.slice(-4)}`
}

function StarRating({ value }: { value: number | null }) {
  if (value == null) return <span className="text-text-disabled text-[13px]">No rating</span>
  return (
    <span className="flex items-center gap-1">
      {[1,2,3,4,5].map(i => (
        <span key={i} className={`material-icons text-[16px] ${i <= Math.round(value) ? 'text-warning' : 'text-text-disabled'}`}>star</span>
      ))}
      <span className="text-[12px] text-text-secondary ml-1">{value.toFixed(1)}</span>
    </span>
  )
}

function ContractorCard({ c }: { c: Contractor }) {
  return (
    <div className="space-y-4">
      {/* Business Details */}
      <div className="bg-surface border border-divider rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
          <p className="section-label">Business Details</p>
          <div className="flex gap-2">
            {c.partner_kind && (
              <span className="text-[11px] font-semibold px-2 py-[2px] rounded-full bg-primary/10 text-primary capitalize">{c.partner_kind}</span>
            )}
            {c.is_active
              ? <span className="text-[11px] font-semibold px-2 py-[2px] rounded-full bg-success/10 text-success">Active</span>
              : <span className="text-[11px] font-semibold px-2 py-[2px] rounded-full bg-error/10 text-error">Inactive</span>
            }
          </div>
        </div>
        <div className="p-4 space-y-3">
          <InfoRow label="Name" value={c.name} />
          <InfoRow label="Contractor Code" value={c.contractor_code} />
          <InfoRow label="Registration Number" value={c.registration_number} />
          <InfoRow label="VAT Registered" value={c.is_vat_registered ? `Yes — ${c.vat_number ?? 'No VAT number'}` : 'No'} />
          <InfoRow label="Tax Number" value={c.tax_number} />
          <div className="flex flex-col gap-1">
            <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Rating</p>
            <StarRating value={c.rating} />
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="bg-surface border border-divider rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-divider">
          <p className="section-label">Contact</p>
        </div>
        <div className="p-4 space-y-3">
          <InfoRow label="Contact Person" value={c.contact_person} />
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Phone</p>
            {c.phone ? (
              <div className="flex items-center gap-3">
                <p className="text-[13px] text-text-primary">{c.phone}</p>
                <a href={`tel:${c.phone}`}
                  className="text-[12px] font-semibold text-primary border border-primary/30 px-3 py-1 rounded-lg hover:bg-primary/10 transition-colors">
                  Call
                </a>
              </div>
            ) : <p className="text-[13px] text-text-disabled">—</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">Email</p>
            {c.email ? (
              <div className="flex items-center gap-3">
                <p className="text-[13px] text-text-primary truncate">{c.email}</p>
                <a href={`mailto:${c.email}`}
                  className="text-[12px] font-semibold text-primary border border-primary/30 px-3 py-1 rounded-lg hover:bg-primary/10 transition-colors shrink-0">
                  Email
                </a>
              </div>
            ) : <p className="text-[13px] text-text-disabled">—</p>}
          </div>
          <InfoRow label="Address" value={c.address} />
        </div>
      </div>

      {/* Banking */}
      <div className="bg-surface border border-divider rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-divider flex items-center gap-2">
          <p className="section-label">Banking</p>
          {c.banking_verified && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-success">
              <span className="material-icons text-[14px]">verified</span>Verified
            </span>
          )}
        </div>
        <div className="p-4 space-y-3">
          <InfoRow label="Bank Name" value={c.bank_name} />
          <InfoRow label="Account Holder" value={c.account_holder_name} />
          <InfoRow label="Account Number" value={maskAccount(c.bank_account)} />
          <InfoRow label="Account Type" value={c.account_type} />
          <InfoRow label="Branch Code" value={c.bank_branch_code} />
          <InfoRow label="Swift / BIC" value={c.swift_bic} />
        </div>
      </div>

      {/* Status Flags */}
      {(c.compliance_hold || c.payment_hold) && (
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Status Flags</p>
          </div>
          <div className="p-4 space-y-2">
            {c.compliance_hold && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-error/10 border border-error/30">
                <span className="material-icons text-error text-[18px]">gpp_bad</span>
                <p className="text-[13px] font-semibold text-error">Compliance Hold — contact HR</p>
              </div>
            )}
            {c.payment_hold && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30">
                <span className="material-icons text-warning text-[18px]">payment</span>
                <p className="text-[13px] font-semibold text-warning">Payment Hold — contact Finance</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-semibold text-text-disabled uppercase tracking-wide">{label}</p>
      <p className="text-[13px] text-text-primary">{value ?? '—'}</p>
    </div>
  )
}

export default function ContractorProfilePage() {
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [activeTab, setActiveTab]     = useState(0)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: rpcErr } = await (supabase.rpc as any)('employee_get_linked_contractors', {
        p_company_id:   member.companyId,
        p_employee_id:  member.employeeId,
        p_session_token: token,
      })
      if (rpcErr) throw rpcErr
      setContractors((data as Contractor[]) ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load contractor profile.')
    }
    setLoading(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">Contractor Profile</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30 mb-4">
            <p className="text-[13px] text-error font-semibold">{error}</p>
          </div>
        )}

        {contractors.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-center px-8">
            <span className="material-icons text-[48px] text-text-disabled">badge</span>
            <p className="text-[15px] font-semibold text-text-primary">No contractor profile linked</p>
            <p className="text-[13px] text-text-secondary">Your account is not linked to a contractor profile. Contact HR to link your contractor details.</p>
          </div>
        ) : contractors.length === 1 ? (
          <ContractorCard c={contractors[0]} />
        ) : (
          <div>
            <div className="flex gap-2 mb-4 overflow-x-auto">
              {contractors.map((c, i) => (
                <button key={c.id} onClick={() => setActiveTab(i)}
                  className={`text-[12px] font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    activeTab === i ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider'
                  }`}>
                  {c.name}
                </button>
              ))}
            </div>
            <ContractorCard c={contractors[activeTab]} />
          </div>
        )}
      </div>
    </div>
  )
}
