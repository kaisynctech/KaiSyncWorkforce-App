'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  cancelCompanyPortalLink,
  formatPortalMoney,
  openCompanyPortal,
  type PortalFeed,
} from '@/lib/company-portals'

function when(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function PortalLinkPage() {
  const params = useParams<{ linkId: string }>()
  const linkId = params.linkId
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [feed, setFeed] = useState<PortalFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) {
        setError('Account not linked to an employee.')
        setLoading(false)
        return
      }
      setCompanyId(member.companyId)
      setFeed(await openCompanyPortal(supabase, member.companyId, linkId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this company')
    } finally {
      setLoading(false)
    }
  }, [linkId])

  useEffect(() => { void load() }, [load])

  async function disconnect() {
    if (!companyId || !feed) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      await cancelCompanyPortalLink(supabase, companyId, feed.link.link_id)
      window.location.href = '/dashboard/portals'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect')
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 max-w-4xl mx-auto space-y-4">
        <Link href="/dashboard/portals" className="text-[12px] text-primary font-semibold">Portals</Link>
        {loading ? (
          <p className="text-[13px] text-text-secondary">Loading…</p>
        ) : feed ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-[22px] font-bold text-text-primary">{feed.link.company_name}</h1>
                <p className="text-[13px] text-text-secondary mt-1">
                  {feed.link.kind === 'customer'
                    ? 'Jobs, quotes and invoices they keep on your client record.'
                    : 'Jobs they assigned to you.'}
                </p>
              </div>
              <button type="button" disabled={busy} onClick={() => void disconnect()} className="btn-outlined h-10 px-3 text-[13px]">
                {busy ? '…' : 'Disconnect'}
              </button>
            </div>
            {error && <p className="text-[13px] text-error">{error}</p>}
            <section className="space-y-2">
              <p className="section-label">JOBS</p>
              {feed.jobs.length === 0 ? <p className="text-[13px] text-text-secondary">No shared jobs.</p> : feed.jobs.map(job => (
                <div key={job.id} className="rounded-xl border border-divider px-4 py-3">
                  <p className="text-[14px] font-medium text-text-primary">{job.title || 'Job'}</p>
                  <p className="text-[12px] text-text-secondary">{[job.job_code, job.status, when(job.scheduled_start)].filter(Boolean).join(' · ')}</p>
                </div>
              ))}
            </section>
            {feed.link.kind === 'customer' && (
              <>
                <section className="space-y-2">
                  <p className="section-label">QUOTES</p>
                  {feed.quotes.length === 0 ? <p className="text-[13px] text-text-secondary">No shared quotes.</p> : feed.quotes.map(quote => (
                    <div key={quote.id} className="rounded-xl border border-divider px-4 py-3">
                      <p className="text-[14px] font-medium text-text-primary">{quote.title || 'Quote'}</p>
                      <p className="text-[12px] text-text-secondary">
                        {[quote.quote_number, quote.status, formatPortalMoney(quote.total_amount, quote.currency)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  ))}
                </section>
                <section className="space-y-2">
                  <p className="section-label">INVOICES</p>
                  {feed.invoices.length === 0 ? <p className="text-[13px] text-text-secondary">No shared invoices.</p> : feed.invoices.map(invoice => (
                    <div key={invoice.id} className="rounded-xl border border-divider px-4 py-3">
                      <p className="text-[14px] font-medium text-text-primary">{invoice.invoice_number || 'Invoice'}</p>
                      <p className="text-[12px] text-text-secondary">
                        {[invoice.status, formatPortalMoney(invoice.total_amount, invoice.currency), invoice.balance_due ? `Due ${formatPortalMoney(invoice.balance_due, invoice.currency)}` : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  ))}
                </section>
              </>
            )}
          </>
        ) : (
          <p className="text-[13px] text-error">{error || 'Connection not found.'}</p>
        )}
      </div>
    </div>
  )
}
