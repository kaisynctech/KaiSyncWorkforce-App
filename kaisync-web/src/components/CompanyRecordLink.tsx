'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  cancelCompanyPortalLink,
  fetchCompanyPortalRecordLink,
  requestCompanyPortalLink,
  type PortalKind,
  type PortalLink,
} from '@/lib/company-portals'

export function CompanyRecordLink({
  companyId,
  recordId,
  kind,
  canEdit,
}: {
  companyId: string
  recordId: string
  kind: PortalKind
  canEdit: boolean
}) {
  const [link, setLink] = useState<PortalLink | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member || member.companyId !== companyId) {
      setLoaded(true)
      return
    }
    try {
      setLink(await fetchCompanyPortalRecordLink(supabase, companyId, kind, recordId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the connection')
    } finally {
      setLoaded(true)
    }
  }, [companyId, kind, recordId])

  useEffect(() => { void load() }, [load])

  async function connect() {
    if (!canEdit || !code.trim()) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      await requestCompanyPortalLink(supabase, companyId, code.trim(), kind, recordId)
      setCode('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the connection')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!canEdit || !link) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      await cancelCompanyPortalLink(supabase, companyId, link.link_id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close the connection')
    } finally {
      setBusy(false)
    }
  }

  const title = kind === 'customer' ? 'THEIR COMPANY' : 'THEIR KAISYNC COMPANY'
  const body = kind === 'customer'
    ? 'When this client has their own company on KaiSync, connect it here. After they accept, they see this client’s jobs, quotes and invoices in Portals. You keep creating the work on this client.'
    : 'When this contractor is a company on KaiSync, connect it here. After they accept, the jobs you assign to this contractor show in their Portals.'

  return (
    <div className="card p-4 space-y-3">
      <p className="section-label">{title}</p>
      <p className="text-[12px] text-text-secondary">{body}</p>
      {!loaded ? (
        <p className="text-[12px] text-text-secondary">Loading…</p>
      ) : link ? (
        <div className="space-y-2">
          <p className="text-[14px] font-medium text-text-primary">
            {link.company_name || 'Company'} {link.company_code ? `(${link.company_code})` : ''}
          </p>
          <p className="text-[12px] text-text-secondary">
            {link.status === 'active'
              ? 'Connected. They open this from Portals.'
              : 'Waiting for them to accept in Portals.'}
          </p>
          {canEdit && (
            <button type="button" onClick={() => void disconnect()} disabled={busy} className="btn-outlined h-10 px-3 text-[13px]">
              {busy ? '…' : 'Disconnect'}
            </button>
          )}
        </div>
      ) : canEdit ? (
        <div className="flex gap-2">
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Their company code"
            className="dark-entry flex-1"
          />
          <button type="button" onClick={() => void connect()} disabled={busy || !code.trim()} className="btn-primary h-10 px-3 text-[13px]">
            {busy ? '…' : 'Connect'}
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-text-secondary">No company is connected.</p>
      )}
      {error && <p className="text-[12px] text-error">{error}</p>}
    </div>
  )
}
