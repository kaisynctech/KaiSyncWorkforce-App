'use client'

import { useEffect, useState, type DragEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  CLIENT_TYPES,
  CLIENT_TYPE_LABELS,
  normalizeClientType,
  nextClientCode,
} from '@/lib/client-create-payload'
import { createClientRecord } from '@/lib/clients'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { Toggle } from '@/components/Toggle'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { Client, Site, Project } from '@/types/database'

const CLIENT_TABS = ['info', 'projects', 'jobs'] as const
type ClientTab = typeof CLIENT_TABS[number]

type ClientJob = { id: string; title: string; status: string; created_at: string }

const JOB_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  open:        { bg: '#DBEAFE', fg: '#1E40AF' },
  scheduled:   { bg: '#E0E7FF', fg: '#3730A3' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E' },
  completed:   { bg: '#DCFCE7', fg: '#166534' },
  cancelled:   { bg: '#E5E7EB', fg: '#6B7280' },
}

const PROJECT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft:       { bg: '#E5E7EB', fg: '#6B7280' },
  sent:        { bg: '#DBEAFE', fg: '#1E40AF' },
  negotiation: { bg: '#E0E7FF', fg: '#3730A3' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E' },
  won:         { bg: '#DCFCE7', fg: '#166534' },
  lost:        { bg: '#FEE2E2', fg: '#991B1B' },
}
const PROJECT_STATUS_OPTIONS = ['draft', 'sent', 'negotiation', 'in_progress', 'won', 'lost']
const BOARD_STAGES = ['draft', 'sent', 'negotiation', 'in_progress', 'won', 'lost'] as const

const fmtCurrency = (n: number | null) =>
  n != null ? `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 0 })}` : '—'

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const clientId = params.id
  const isNew = clientId === 'new'

  const [tab, setTab] = useState<ClientTab>('info')
  const [client, setClient] = useState<Client | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [clientJobs, setClientJobs] = useState<ClientJob[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companyCode, setCompanyCode] = useState('')
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [xeroLink,      setXeroLink]      = useState<{ xero_contact_id: string; last_synced_at: string } | null>(null)
  const [xeroConnected, setXeroConnected] = useState(false)
  const [xeroPushing,   setXeroPushing]   = useState(false)
  const [xeroMsg,       setXeroMsg]       = useState<string | null>(null)
  const [xeroSessionToken, setXeroSessionToken] = useState<string | null>(null)
  const [projectView, setProjectView] = useState<'table' | 'board'>('table')
  const [codeCopied, setCodeCopied] = useState(false)
  const [addingSite, setAddingSite] = useState(false)
  const [siteName, setSiteName] = useState('')
  const [siteAddress, setSiteAddress] = useState('')

  // Form state
  const [name, setName] = useState('')
  const [clientType, setClientType] = useState<string>('individual')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [portalEnabled, setPortalEnabled] = useState(false)

  const canEdit = can(perms, PERM.clientsEdit)
  const showRelatedTabs = !isNew && !!client
  const hasClientCode = !!client?.client_code

  useEffect(() => { load() }, [clientId])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (member) {
      const { data: me } = await supabase
        .from('employees')
        .select('access_level')
        .eq('id', member.employeeId)
        .maybeSingle()
      setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))
      const { data: company } = await supabase
        .from('companies')
        .select('code')
        .eq('id', member.companyId)
        .maybeSingle()
      setCompanyCode((company as { code?: string | null } | null)?.code ?? '')
    }

    if (isNew) {
      setClientType('individual')
      setLoading(false)
      return
    }

    const [cRes, sRes, pRes, jRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('sites').select('*').eq('client_id', clientId),
      supabase.from('client_deals').select('*, employees:manager_employee_id(name, surname)').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabase.from('jobs').select('id, title, status, created_at').eq('client_id', clientId).order('created_at', { ascending: false }),
    ])

    if (!cRes.data) { router.push('/dashboard/clients'); return }

    const c = cRes.data as Client
    setClient(c)
    setName(c.name ?? '')
    setClientType(normalizeClientType(c.type))
    setContactPerson(c.contact_person ?? '')
    setPhone(c.phone ?? '')
    setEmail(c.email ?? '')
    setAddress(c.address ?? '')
    setNotes(c.notes ?? '')
    setPortalEnabled(c.portal_enabled ?? false)

    setSites((sRes.data ?? []) as Site[])
    setProjects((pRes.data ?? []) as Project[])
    setClientJobs((jRes.data ?? []) as ClientJob[])
    const cId = c.company_id
    const { data: xStatus } = await (supabase.rpc as any)('get_xero_connection_status', { p_company_id: cId })
    setXeroConnected(xStatus?.connected ?? false)
    if (xStatus?.connected) {
      const { data: lnk } = await (supabase.rpc as any)('get_xero_link_for_record', {
        p_company_id: cId, p_record_type: 'client', p_record_id: clientId,
      })
      setXeroLink(lnk ?? null)
    }
    const { data: { session } } = await supabase.auth.getSession()
    setXeroSessionToken(session?.access_token ?? null)
    setLoading(false)
  }

  async function pushToXero() {
    if (!canEdit || !client?.company_id || !xeroSessionToken || xeroPushing) return
    setXeroPushing(true)
    setXeroMsg(null)
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/xero-sync-contacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${xeroSessionToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: client.company_id, record_id: clientId, record_type: 'client' }),
      })
      const data = await resp.json().catch(() => ({} as { ok?: boolean; error?: string; xero_contact_id?: string }))
      if (data.ok) {
        setXeroLink({
          xero_contact_id: data.xero_contact_id ?? xeroLink?.xero_contact_id ?? '',
          last_synced_at: new Date().toISOString(),
        })
        setXeroMsg('Synced to Xero.')
      } else {
        setXeroMsg(data.error ?? `Xero push failed (${resp.status})`)
      }
    } catch {
      setXeroMsg('Xero push failed — network or server error')
    } finally {
      setXeroPushing(false)
    }
  }

  async function save() {
    if (!canEdit) { setError('You do not have permission to edit clients.'); return }
    if (!name.trim()) { setError('Client name is required.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const type = normalizeClientType(clientType)

    if (isNew) {
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('Account not linked to an active employee.'); setSaving(false); return }
      const created = await createClientRecord(supabase, {
        companyId: member.companyId,
        name: name.trim(),
        type,
        contactPerson,
        phone,
        email,
        address,
        notes,
        portalEnabled,
        assignCode: portalEnabled,
      })
      if (!created.ok) { setError(created.message); setSaving(false); return }
      router.push(`/dashboard/clients/${created.data.id}`)
    } else {
      // Omit client_code so an existing permanent code is never blanked on save
      const payload: Record<string, unknown> = {
        name: name.trim(),
        type,
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        portal_enabled: portalEnabled,
      }

      const { error: e } = await supabase.from('clients').update(payload).eq('id', clientId)
      if (e) setError(e.message)
      else setClient(prev => prev
        ? { ...prev, ...payload, type, portal_enabled: portalEnabled } as Client
        : prev)
    }
    setSaving(false)
  }

  /** Assign a permanent C#### code once if missing — never rotates/replaces an existing code. */
  async function ensurePermanentClientCode(): Promise<string | null> {
    if (!canEdit) return null
    if (!client?.company_id) return null
    if (client.client_code) return client.client_code

    const supabase = createClient()
    const [{ data: company }, { data: existing }] = await Promise.all([
      supabase.from('companies').select('code').eq('id', client.company_id).maybeSingle(),
      supabase.from('clients').select('client_code').eq('company_id', client.company_id),
    ])
    const code = nextClientCode(
      (company as { code?: string | null } | null)?.code ?? '',
      (existing ?? []).map(r => (r as { client_code: string | null }).client_code),
    )
    const { error: e } = await supabase
      .from('clients')
      .update({ client_code: code })
      .eq('id', clientId)
      .is('client_code', null)
    if (e) {
      setError(e.message)
      return null
    }
    return code
  }

  async function handlePortalToggle(next: boolean) {
    if (!canEdit) return
    setPortalEnabled(next)
    if (isNew || !next || hasClientCode || !client?.company_id) return

    setIsBusy(true)
    setError(null)
    const code = await ensurePermanentClientCode()
    if (code) {
      const supabase = createClient()
      await supabase.from('clients').update({ portal_enabled: true }).eq('id', clientId)
      await load()
    }
    setIsBusy(false)
  }

  async function addSite() {
    if (!canEdit || !client) return
    if (!siteName.trim()) { setError('Site name is required.'); return }
    setIsBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: e } = await supabase.from('sites').insert({
      company_id: client.company_id,
      client_id: clientId,
      name: siteName.trim(),
      address: siteAddress.trim() || null,
    })
    if (e) {
      setError(e.message)
    } else {
      setSiteName('')
      setSiteAddress('')
      setAddingSite(false)
      const { data } = await supabase.from('sites').select('*').eq('client_id', clientId)
      setSites((data ?? []) as Site[])
    }
    setIsBusy(false)
  }

  async function updateProjectStatus(p: Project, newStatus: string) {
    if (!canEdit) return
    const from = p.status ?? 'draft'
    if (from === newStatus) return
    const supabase = createClient()
    await supabase.from('client_deals').update({ status: newStatus }).eq('id', p.id)
    await supabase.from('client_deal_updates').insert({
      deal_id: p.id,
      company_id: p.company_id,
      body: `Moved to ${newStatus.replace(/_/g, ' ')}`,
      status_from: from,
      status_to: newStatus,
    })
    setProjects(prev => prev.map(x => x.id === p.id ? { ...x, status: newStatus } : x))
  }

  function onBoardDrop(e: DragEvent, stage: string) {
    e.preventDefault()
    if (!canEdit) return
    const id = e.dataTransfer.getData('text/project-id')
    if (!id) return
    const project = projects.find(p => p.id === id)
    if (project) void updateProjectStatus(project, stage)
  }

  async function copyCredentials() {
    const code = client?.client_code
    if (!code) return
    const text = `Company Code: ${companyCode}\nClient Code: ${code}`
    try {
      await navigator.clipboard.writeText(text)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 2000)
    } catch {
      setError('Could not copy portal credentials to clipboard.')
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/clients" className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-[20px] font-semibold text-text-primary">{name || 'New Client'}</h1>
            {!isNew && xeroConnected && (
              <div className="flex items-center gap-2 mt-1">
                {xeroLink ? (
                  <>
                    <span className="inline-flex items-center gap-1 text-[12px] text-green-400">
                      <span className="text-[14px]">✓</span> Synced to Xero
                    </span>
                    <span className="text-text-disabled text-[11px]">
                      {new Date(xeroLink.last_synced_at).toLocaleDateString()}
                    </span>
                    <button onClick={pushToXero} disabled={xeroPushing || !canEdit}
                      className="text-[11px] text-[#13B5EA] hover:opacity-70 disabled:opacity-40">
                      Update in Xero
                    </button>
                  </>
                ) : (
                  <button onClick={pushToXero} disabled={xeroPushing || !canEdit}
                    className="inline-flex items-center gap-1 text-[12px] px-3 py-1 rounded border border-[#13B5EA] text-[#13B5EA] hover:bg-[#13B5EA]/10 disabled:opacity-40 transition-colors">
                    {xeroPushing ? 'Pushing…' : '+ Push to Xero'}
                  </button>
                )}
              </div>
            )}
            {xeroMsg && (
              <p className={`text-[11px] mt-1 ${
                xeroMsg.includes('Synced') ? 'text-green-400' : 'text-error'
              }`}>
                {xeroMsg}
                <button type="button" onClick={() => setXeroMsg(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
              </p>
            )}
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving || !canEdit}
          title={!canEdit ? 'You do not have permission to edit clients' : undefined}
          className="h-11 px-5 text-[16px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors min-w-[96px]"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <p className="px-4 py-2 text-error text-[13px] shrink-0">{error}</p>}

      {/* Tab bar */}
      {showRelatedTabs && (
        <div className="grid grid-cols-3 gap-2 mx-4 my-2 shrink-0">
          {CLIENT_TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className="h-[38px] rounded-[10px] text-[12px] font-medium transition-colors"
              style={{ backgroundColor: tab === t ? '#3B82F6' : '#FFFFFF', color: tab === t ? '#FFFFFF' : '#6B7280' }}>
              {t === 'info' ? 'Information' : t === 'projects' ? 'Projects' : 'Jobs'}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">

        {/* ── INFORMATION ── */}
        {(isNew || tab === 'info') && (
          <>
            <div className="card p-4 space-y-3">
              <p className="section-label">CLIENT DETAILS</p>
              <input placeholder="Client / company name *" value={name} onChange={e => setName(e.target.value)}
                disabled={!canEdit} className="dark-entry" />
              <select value={clientType} onChange={e => setClientType(e.target.value)}
                disabled={!canEdit}
                className="dark-entry appearance-none">
                {CLIENT_TYPES.map(t => <option key={t} value={t}>{CLIENT_TYPE_LABELS[t]}</option>)}
              </select>
              {hasClientCode && (
                <div className="flex justify-between items-center py-1">
                  <span className="text-text-primary font-semibold text-[14px]">Code: {client?.client_code}</span>
                  <span className="text-text-secondary text-[11px]">auto-generated</span>
                </div>
              )}
              <input placeholder="Primary contact" value={contactPerson} onChange={e => setContactPerson(e.target.value)}
                disabled={!canEdit} className="dark-entry" />
              <div className="grid grid-cols-2 gap-3">
                <input type="tel" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)}
                  disabled={!canEdit} className="dark-entry" />
                <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                  disabled={!canEdit} className="dark-entry" />
              </div>
              <input placeholder="Address" value={address} onChange={e => setAddress(e.target.value)}
                disabled={!canEdit} className="dark-entry" />
              <textarea placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)}
                disabled={!canEdit}
                rows={3} className="dark-entry min-h-[72px] py-3 resize-none" />
            </div>

            {/* Client Portal Access */}
            <div className="card p-4 space-y-3">
              <p className="section-label">CLIENT PORTAL</p>
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-[14px] font-medium text-text-primary">Portal user</p>
                  <p className="text-[12px] text-text-secondary">
                    Enables client portal login with company code + permanent client code.
                  </p>
                </div>
                <Toggle
                  checked={portalEnabled}
                  onChange={handlePortalToggle}
                  disabled={!canEdit || isBusy}
                />
              </div>
              {hasClientCode && (
                <>
                  <input readOnly value={companyCode} placeholder="Company code"
                    className="dark-entry text-text-secondary cursor-default" />
                  <input readOnly value={client?.client_code ?? ''}
                    className="dark-entry text-text-secondary cursor-default" />
                  <button
                    type="button"
                    onClick={() => void copyCredentials()}
                    disabled={!client?.client_code}
                    className="w-full h-[42px] rounded-sm bg-surface-elevated border border-border text-text-primary text-[12px] hover:bg-background transition-colors disabled:opacity-40"
                  >
                    {codeCopied ? 'Copied' : 'Copy portal login credentials'}
                  </button>
                  <p className="text-text-secondary text-[11px]">
                    Permanent login code (assigned once). Codes do not expire.
                    Disable Portal user to revoke access without changing the code.
                  </p>
                </>
              )}
              {!hasClientCode && portalEnabled && !isNew && (
                <p className="text-[12px] text-text-secondary">Assigning portal code…</p>
              )}
              {!hasClientCode && !portalEnabled && (
                <p className="text-[11px] text-text-secondary">
                  Enable Portal user to assign a permanent code (same format as create: C…).
                  Codes do not expire — disable Portal user to revoke access.
                </p>
              )}
            </div>

            {/* Sites */}
            {showRelatedTabs && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="section-label">SITES</p>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setAddingSite(v => !v)}
                      className="text-primary text-[13px] px-2 hover:opacity-70 transition-opacity"
                    >
                      {addingSite ? 'Cancel' : '+ Site'}
                    </button>
                  )}
                </div>
                {addingSite && canEdit && (
                  <div className="card p-3 space-y-2">
                    <input
                      placeholder="Site name *"
                      value={siteName}
                      onChange={e => setSiteName(e.target.value)}
                      className="dark-entry"
                    />
                    <input
                      placeholder="Address (optional)"
                      value={siteAddress}
                      onChange={e => setSiteAddress(e.target.value)}
                      className="dark-entry"
                    />
                    <button
                      type="button"
                      disabled={isBusy || !siteName.trim()}
                      onClick={() => void addSite()}
                      className="h-9 px-3 rounded-lg bg-primary text-white text-[12px] font-medium disabled:opacity-50"
                    >
                      {isBusy ? 'Saving…' : 'Add site'}
                    </button>
                  </div>
                )}
                <div className="card overflow-hidden" style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {sites.length === 0 ? (
                    <p className="text-text-secondary text-[13px] p-4">No sites.</p>
                  ) : (
                    <table className="w-full">
                      <tbody>
                        {sites.map(s => (
                          <tr key={s.id} className="border-b border-divider last:border-0">
                            <td className="data-td text-text-primary text-[13px]">{s.name}</td>
                            <td className="data-td text-text-secondary text-[12px] truncate">{s.address ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── PROJECTS ── */}
        {showRelatedTabs && tab === 'projects' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">PROJECTS (CRM)</p>
              {canEdit && (
                <button onClick={() => router.push('/dashboard/projects/new')}
                  className="btn-primary h-9 px-[14px] text-[13px]">+ Project</button>
              )}
            </div>
            {/* View toggle */}
            <div className="flex gap-2">
              {(['table', 'board'] as const).map(v => (
                <button key={v} onClick={() => setProjectView(v)}
                  className="rounded-lg h-8 px-[10px] text-[11px] transition-colors"
                  style={{ backgroundColor: projectView === v ? '#3B82F6' : '#FFFFFF', color: projectView === v ? '#FFFFFF' : '#6B7280' }}>
                  {v === 'table' ? 'Table' : 'Board'}
                </button>
              ))}
            </div>

            {projectView === 'board' ? (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {BOARD_STAGES.map(stage => {
                  const sc = PROJECT_STATUS_COLORS[stage] ?? PROJECT_STATUS_COLORS.draft
                  const column = projects.filter(p => (p.status ?? 'draft') === stage)
                  return (
                    <div
                      key={stage}
                      className="shrink-0 w-[220px] bg-surface-elevated rounded-lg border border-divider p-2 min-h-[280px]"
                      onDragOver={e => { if (canEdit) e.preventDefault() }}
                      onDrop={e => onBoardDrop(e, stage)}
                    >
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: sc.fg }}>
                          {stage.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[11px] text-text-secondary">{column.length}</span>
                      </div>
                      <div className="space-y-2">
                        {column.map(p => (
                          <div
                            key={p.id}
                            draggable={canEdit}
                            onDragStart={e => e.dataTransfer.setData('text/project-id', p.id)}
                            className="card p-2.5 cursor-grab active:cursor-grabbing space-y-1.5"
                          >
                            <button
                              onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                              className="text-left text-[13px] font-medium text-text-primary hover:text-primary w-full"
                            >
                              {p.title}
                            </button>
                            <p className="text-[11px] text-text-secondary font-mono">{p.project_code ?? '—'}</p>
                            <p className="text-[11px] text-text-secondary">{fmtCurrency(p.offer_amount)}</p>
                            <select
                              value={p.status ?? 'draft'}
                              onChange={e => updateProjectStatus(p, e.target.value)}
                              disabled={!canEdit}
                              className="w-full text-[11px] h-7 px-1.5 rounded border border-border bg-surface"
                            >
                              {PROJECT_STATUS_OPTIONS.map(s => (
                                <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                              ))}
                            </select>
                          </div>
                        ))}
                        {column.length === 0 && (
                          <p className="text-[11px] text-text-disabled px-1 py-4 text-center">Drop here</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
                <table style={{ minWidth: 520 }} className="w-full">
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th style={{ width: 90 }} className="data-th">Code</th>
                      <th className="data-th">Project</th>
                      <th style={{ width: 120 }} className="data-th">Status</th>
                      <th style={{ width: 80 }} className="data-th text-right">Offer</th>
                      <th style={{ width: 72 }} className="data-th text-center">Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.length === 0 ? (
                      <tr><td colSpan={5} className="text-text-secondary text-center py-6 text-[13px]">No projects for this client.</td></tr>
                    ) : (
                      projects.map(p => {
                        const sc = PROJECT_STATUS_COLORS[p.status ?? 'draft'] ?? PROJECT_STATUS_COLORS.draft
                        return (
                          <tr key={p.id} className="bg-surface border-b border-divider last:border-0">
                            <td className="data-td">
                              <button onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                                className="text-text-primary text-[12px] font-medium hover:text-primary transition-colors">
                                {p.project_code ?? '—'}
                              </button>
                            </td>
                            <td className="data-td">
                              <button onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                                className="text-left text-text-primary text-[13px] truncate w-full hover:text-primary transition-colors">
                                {p.title}
                              </button>
                            </td>
                            <td className="data-td">
                              <select value={p.status ?? 'draft'} onChange={e => updateProjectStatus(p, e.target.value)}
                                disabled={!canEdit}
                                className="text-[11px] h-8 px-2 rounded-lg border border-border bg-surface focus:outline-none w-full"
                                style={{ color: sc.fg }}>
                                {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                              </select>
                            </td>
                            <td className="data-td text-text-secondary text-[12px] text-right">{fmtCurrency(p.offer_amount)}</td>
                            <td className="data-td text-center">
                              <button
                                onClick={() => router.push(`/dashboard/projects/${p.id}?tab=payments`)}
                                className="bg-primary text-white rounded-lg h-7 px-2 text-[10px] font-medium"
                              >
                                + Pay
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── JOBS ── */}
        {showRelatedTabs && tab === 'jobs' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">JOBS</p>
              {canEdit && (
                <button onClick={() => router.push(`/dashboard/jobs/new?clientId=${clientId}`)}
                  className="btn-primary h-9 px-[14px] text-[13px]">+ Job</button>
              )}
            </div>
            <div className="overflow-x-auto bg-surface rounded-lg border border-divider">
              <table style={{ minWidth: 420 }} className="w-full">
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th">Title</th>
                    <th style={{ width: 120 }} className="data-th text-center">Status</th>
                    <th style={{ width: 72  }} className="data-th"></th>
                  </tr>
                </thead>
                <tbody>
                  {clientJobs.length === 0 ? (
                    <tr><td colSpan={3} className="text-text-secondary text-center py-6 text-[13px]">No jobs for this client.</td></tr>
                  ) : (
                    clientJobs.map(j => {
                      const sc = JOB_STATUS_COLORS[j.status] ?? { bg: '#E5E7EB', fg: '#6B7280' }
                      return (
                        <tr key={j.id} className="bg-surface border-b border-divider last:border-0">
                          <td className="data-td text-text-primary text-[13px] truncate">{j.title}</td>
                          <td className="data-td text-center">
                            <StatusBadge label={j.status.replace('_', ' ')} bg={sc.bg} fg={sc.fg} />
                          </td>
                          <td className="data-td">
                            <button onClick={() => router.push(`/dashboard/jobs/${j.id}`)}
                              className="text-primary text-[11px] font-medium h-[30px]">Open →</button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
