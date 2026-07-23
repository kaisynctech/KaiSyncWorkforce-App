'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type AppEvent = {
  id: number | string
  created_at: string
  action: string
  screen: string
  level: string
  meta: Record<string, unknown> | null
}

type Filter = 'all' | 'profile' | 'documents' | 'compliance' | 'payments' | 'portal'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'profile', label: 'Profile' },
  { key: 'documents', label: 'Documents' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'payments', label: 'Payments' },
  { key: 'portal', label: 'Portal' },
]

function eventLabel(action: string): string {
  const map: Record<string, string> = {
    contractor_profile_updated: 'Profile Updated',
    contractor_document_uploaded: 'Document Uploaded',
    contractor_document_replaced: 'Document Replaced',
    contractor_document_approved: 'Document Approved',
    contractor_document_rejected: 'Document Rejected',
    contractor_compliance_pack_changed: 'Pack Changed',
    contractor_payment_hold_enabled: 'Payment Hold On',
    contractor_payment_hold_disabled: 'Payment Hold Off',
    contractor_compliance_hold_enabled: 'Compliance Hold On',
    contractor_compliance_hold_disabled: 'Compliance Hold Off',
    contractor_banking_update_submitted: 'Banking Submitted',
    contractor_banking_update_approved: 'Banking Approved',
    contractor_banking_update_rejected: 'Banking Rejected',
    contractor_banking_verified: 'Banking Verified',
    contractor_banking_unverified: 'Banking Unverified',
    hr_start_review: 'Quote Review Started',
    hr_approve_quote: 'Quote Approved',
    hr_reject_quote: 'Quote Rejected',
    hr_request_revision: 'Revision Requested',
  }
  if (map[action]) return map[action]
  const s = action.replace(/^contractor_/, '').replace(/^hr_/, '').replace(/_/g, ' ')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : action
}

function badgeColors(action: string): { bg: string; fg: string } {
  if (action.includes('approved') || action.includes('verified') || action.includes('disabled'))
    return { bg: '#14532D', fg: '#22C55E' }
  if (action.includes('rejected') || action.includes('enabled') || action.includes('unverified'))
    return { bg: '#7F1D1D', fg: '#FCA5A5' }
  if (action.includes('uploaded') || action.includes('replaced') || action.includes('submitted') || action.includes('review'))
    return { bg: '#1E3A5F', fg: '#60A5FA' }
  if (action.includes('profile'))
    return { bg: '#292012', fg: '#FCD34D' }
  return { bg: '#1E293B', fg: '#94A3B8' }
}

function mStr(meta: Record<string, unknown> | null, key: string): string {
  if (!meta) return ''
  const v = meta[key]
  return v == null ? '' : String(v)
}

function description(action: string, meta: Record<string, unknown> | null): string {
  const docName = mStr(meta, 'document_name')
  const docType = mStr(meta, 'document_type')
  const packName = mStr(meta, 'pack_name')
  const reason = mStr(meta, 'rejected_reason') || mStr(meta, 'rejection_reason')
  const quoteNumber = mStr(meta, 'quote_number')
  if (action.startsWith('contractor_document')) {
    const base = docName || docType
    if (action.includes('rejected') && reason) return `${base} — ${reason}`
    return base
  }
  if (action === 'contractor_banking_update_submitted') {
    const last4 = mStr(meta, 'account_last4')
    return last4 ? `Account ending ${last4} — awaiting HR review` : 'Awaiting HR review'
  }
  if (action === 'contractor_banking_update_approved')
    return 'Banking details updated. Verification reset — confirm before next payout.'
  if (action === 'contractor_banking_update_rejected')
    return reason ? `Rejected: ${reason}` : 'Banking update rejected.'
  if (action === 'contractor_compliance_pack_changed' && packName) return `Pack: ${packName}`
  if (quoteNumber) return `Quote ${quoteNumber}`
  return mStr(meta, 'description') || ''
}

function category(action: string): Exclude<Filter, 'all' | 'portal'> | 'other' {
  if (action.startsWith('contractor_document')) return 'documents'
  if (action.startsWith('contractor_profile')) return 'profile'
  if (action.includes('compliance_pack')) return 'compliance'
  if (action.includes('hold') || action.includes('banking') || action.includes('payment') || action.includes('quote'))
    return 'payments'
  return 'other'
}

function actor(screen: string): string {
  if (screen === 'ContractorPortal') return 'Contractor'
  if (screen.toLowerCase().includes('hr') || screen === 'contractor_quotes') return 'HR'
  return 'System'
}

function source(screen: string): string {
  if (screen === 'ContractorPortal') return 'Portal'
  if (screen.toLowerCase().includes('hr') || screen === 'contractor_quotes') return 'HR Portal'
  return screen || 'System'
}

export function ContractorActivityTab({
  companyId,
  contractorId,
}: {
  companyId: string
  contractorId: string
}) {
  const [events, setEvents] = useState<AppEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: rpcErr } = await (supabase.rpc as any)('get_contractor_activity_feed', {
      p_company_id: companyId,
      p_contractor_id: contractorId,
      p_limit: 200,
    })
    if (rpcErr) setError(rpcErr.message)
    setEvents((data ?? []) as AppEvent[])
    setLoading(false)
  }, [companyId, contractorId])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    return events.filter(e => {
      if (filter === 'all') return true
      if (filter === 'portal') return e.screen === 'ContractorPortal'
      const cat = category(e.action)
      if (filter === 'compliance') return cat === 'compliance'
      return cat === filter
    })
  }, [events, filter])

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`h-8 px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
                filter === f.key ? 'bg-primary text-white' : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={load} className="text-[12px] text-primary hover:opacity-70">Refresh</button>
      </div>

      {error && <p className="text-[13px] text-error">{error}</p>}
      {loading ? (
        <p className="text-[13px] text-text-secondary py-8 text-center">Loading activity…</p>
      ) : filtered.length === 0 ? (
        <p className="text-[13px] text-text-secondary py-8 text-center">No activity yet.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => {
            const colors = badgeColors(e.action)
            const desc = description(e.action, e.meta)
            return (
              <div key={String(e.id)} className="card p-3 flex gap-3 items-start">
                <span
                  className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: colors.bg, color: colors.fg }}
                >
                  {eventLabel(e.action)}
                </span>
                <div className="min-w-0 flex-1">
                  {desc && <p className="text-[13px] text-text-primary">{desc}</p>}
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    {new Date(e.created_at).toLocaleString('en-ZA')} · {actor(e.screen)} · {source(e.screen)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
