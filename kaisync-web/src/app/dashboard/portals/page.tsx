'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  decideCompanyPortalLink,
  listCompanyPortals,
  requestCompanyPortalLink,
  type PortalLink,
  type PortalList,
} from '@/lib/company-portals'

type Tab = 'client' | 'contractor'

export default function PortalsPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('client')
  const [list, setList] = useState<PortalList>({ as_client: [], as_contractor: [], to_decide: [] })
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [contractors, setContractors] = useState<{ id: string; name: string }[]>([])
  const [picks, setPicks] = useState<Record<string, string>>({})
  const [code, setCode] = useState('')
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
      const [portalList, clientRes, contractorRes] = await Promise.all([
        listCompanyPortals(supabase, member.companyId),
        supabase.from('clients').select('id, name').eq('company_id', member.companyId).order('name').limit(500),
        supabase.from('contractors').select('id, name').eq('company_id', member.companyId).order('name').limit(500),
      ])
      setList(portalList)
      setClients((clientRes.data ?? []) as { id: string; name: string }[])
      setContractors((contractorRes.data ?? []) as { id: string; name: string }[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Portals')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function connect() {
    if (!companyId || !code.trim()) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      await requestCompanyPortalLink(
        supabase,
        companyId,
        code.trim(),
        tab === 'client' ? 'customer' : 'hired',
      )
      setCode('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the connection')
    } finally {
      setBusy(false)
    }
  }

  async function decide(link: PortalLink, accept: boolean) {
    if (!companyId) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      await decideCompanyPortalLink(supabase, companyId, link.link_id, accept, picks[link.link_id] ?? null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the connection')
    } finally {
      setBusy(false)
    }
  }

  const rows = tab === 'client' ? list.as_client : list.as_contractor

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-5 max-w-4xl mx-auto space-y-4">
        <div>
          <Link href="/dashboard/overview" className="text-[12px] text-primary font-semibold">Overview</Link>
          <h1 className="text-[22px] font-bold text-text-primary mt-1">Portals</h1>
          <p className="text-[13px] text-text-secondary mt-1">
            Open work another company already shares with you. The company that owns the work keeps creating it there.
          </p>
        </div>

        {error && <p className="text-[13px] text-error">{error}</p>}

        {list.to_decide.length > 0 && (
          <div className="space-y-2">
            <p className="section-label">WAITING FOR YOU</p>
            {list.to_decide.map(link => (
              <div key={link.link_id} className="rounded-2xl border border-divider bg-surface-card p-4 space-y-3">
                <div>
                  <p className="text-[14px] font-semibold text-text-primary">{link.company_name}</p>
                  <p className="text-[12px] text-text-secondary">
                    {link.kind === 'customer'
                      ? 'They asked to connect you as their client.'
                      : 'They asked to connect you as their contractor.'}
                    {link.company_code ? ` Company ${link.company_code}.` : ''}
                  </p>
                </div>
                {link.needs_record && link.kind === 'customer' && (
                  <select
                    value={picks[link.link_id] ?? ''}
                    onChange={e => setPicks(prev => ({ ...prev, [link.link_id]: e.target.value }))}
                    className="h-10 w-full px-3 border border-border rounded-md text-[13px] bg-background"
                  >
                    <option value="">Choose the client</option>
                    {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
                  </select>
                )}
                {link.needs_record && link.kind === 'hired' && (
                  <select
                    value={picks[link.link_id] ?? ''}
                    onChange={e => setPicks(prev => ({ ...prev, [link.link_id]: e.target.value }))}
                    className="h-10 w-full px-3 border border-border rounded-md text-[13px] bg-background"
                  >
                    <option value="">Choose the contractor</option>
                    {contractors.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                )}
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void decide(link, true)} className="btn-primary h-10 px-3 text-[13px]">Accept</button>
                  <button type="button" disabled={busy} onClick={() => void decide(link, false)} className="btn-outlined h-10 px-3 text-[13px]">Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={() => setTab('client')} className={tab === 'client' ? 'btn-primary h-10 px-3 text-[13px]' : 'btn-outlined h-10 px-3 text-[13px]'}>
            As a client
          </button>
          <button type="button" onClick={() => setTab('contractor')} className={tab === 'contractor' ? 'btn-primary h-10 px-3 text-[13px]' : 'btn-outlined h-10 px-3 text-[13px]'}>
            As a contractor
          </button>
        </div>

        <div className="rounded-2xl border border-divider bg-surface-card p-4 space-y-3">
          <p className="text-[13px] text-text-secondary">
            {tab === 'client'
              ? 'Enter the company code of a company you buy from. They choose which client you are, then accept.'
              : 'Enter the company code of a company that hires you. They choose which contractor you are, then accept.'}
          </p>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Company code"
              className="flex-1 h-10 px-3 border border-border rounded-md text-[13px] bg-background"
            />
            <button type="button" disabled={busy || !code.trim()} onClick={() => void connect()} className="btn-primary h-10 px-3 text-[13px]">
              {busy ? '…' : 'Connect'}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-[13px] text-text-secondary">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-text-secondary py-6 text-center">No companies on this tab yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map(link => (
              <div key={link.link_id} className="rounded-2xl border border-divider bg-surface-card px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[14px] font-semibold text-text-primary">{link.company_name}</p>
                  <p className="text-[12px] text-text-secondary">
                    {link.status === 'pending' ? 'Waiting for them to accept.' : (link.record_name || 'Connected')}
                    {link.company_code ? ` · ${link.company_code}` : ''}
                  </p>
                </div>
                {link.status === 'active' && (
                  <Link href={`/dashboard/portals/${link.link_id}`} className="text-[13px] font-semibold text-primary">Open</Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
