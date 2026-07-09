'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ComingSoon } from '@/components/ui/ComingSoon'
import type { Client, Site, Project } from '@/types/database'

const CLIENT_TABS = ['info', 'projects', 'jobs'] as const
type ClientTab = typeof CLIENT_TABS[number]

const CLIENT_TYPES = ['individual', 'company', 'government', 'ngo']
const CLIENT_TYPE_LABELS: Record<string, string> = {
  individual: 'Individual', company: 'Company', government: 'Government', ngo: 'NGO',
}
const PROJECT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft:       { bg: '#E5E7EB', fg: '#6B7280' },
  sent:        { bg: '#DBEAFE', fg: '#1E40AF' },
  in_progress: { bg: '#FEF3C7', fg: '#92400E' },
  won:         { bg: '#DCFCE7', fg: '#166534' },
  lost:        { bg: '#FEE2E2', fg: '#991B1B' },
}
const PROJECT_STATUS_OPTIONS = ['draft', 'sent', 'in_progress', 'won', 'lost']

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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companyCode, setCompanyCode] = useState('')
  const [projectView, setProjectView] = useState<'table' | 'board'>('table')

  // Form state
  const [name, setName] = useState('')
  const [clientType, setClientType] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [clientCode, setClientCode] = useState('')

  const showRelatedTabs = !isNew && !!client

  useEffect(() => { load() }, [clientId])

  async function load() {
    setLoading(true)
    const supabase = createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: me } = await supabase.from('employees').select('companies(company_code)').eq('user_id', user.id).maybeSingle()
      const companies = (me as Record<string, unknown>)?.['companies'] as Record<string, unknown> | null
      setCompanyCode((companies?.['company_code'] as string) ?? '')
    }

    if (isNew) { setLoading(false); return }

    const [cRes, sRes, pRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('sites').select('*').eq('client_id', clientId),
      supabase.from('projects').select('*, employees(name, surname)').eq('client_id', clientId).order('created_at', { ascending: false }),
    ])

    if (!cRes.data) { router.push('/dashboard/clients'); return }

    const c = cRes.data as Client
    setClient(c)
    setName(c.name ?? '')
    setClientType(c.type ?? '')
    setContactPerson(c.contact_person ?? '')
    setPhone(c.phone ?? '')
    setEmail(c.email ?? '')
    setAddress(c.address ?? '')
    setNotes(c.notes ?? '')
    setClientCode(c.code ?? '')

    setSites((sRes.data ?? []) as Site[])
    setProjects((pRes.data ?? []) as Project[])
    setLoading(false)
  }

  function generateCode() {
    const ts = Date.now().toString(36).toUpperCase().slice(-6)
    setClientCode(`C-${ts}`)
  }

  async function save() {
    if (!name.trim()) { setError('Client name is required.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const payload = {
      name:           name.trim(),
      type:           clientType || null,
      contact_person: contactPerson.trim() || null,
      phone:          phone.trim() || null,
      email:          email.trim() || null,
      address:        address.trim() || null,
      notes:          notes.trim() || null,
      code:           clientCode.trim() || null,
    }

    if (isNew) {
      const { data: { user } } = await supabase.auth.getUser()
      const { data: me } = await supabase.from('employees').select('company_id').eq('user_id', user!.id).maybeSingle()
      const { data: nc, error: e } = await supabase.from('clients').insert({ ...payload, company_id: me?.company_id }).select().single()
      if (e) { setError(e.message); setSaving(false); return }
      router.push(`/dashboard/clients/${nc.id}`)
    } else {
      const { error: e } = await supabase.from('clients').update(payload).eq('id', clientId)
      if (e) setError(e.message)
      else setClient(prev => prev ? { ...prev, ...payload } : prev)
    }
    setSaving(false)
  }

  async function updateProjectStatus(p: Project, newStatus: string) {
    const supabase = createClient()
    await supabase.from('projects').update({ status: newStatus }).eq('id', p.id)
    setProjects(prev => prev.map(x => x.id === p.id ? { ...x, status: newStatus } : x))
  }

  function copyCredentials() {
    const text = `Company Code: ${companyCode}\nClient Code: ${clientCode}`
    navigator.clipboard.writeText(text).catch(() => {})
  }

  async function rotateCode() {
    const supabase = createClient()
    try { await supabase.rpc('rotate_client_portal_code', { p_client_id: clientId }); load() } catch {}
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
          <h1 className="text-[20px] font-semibold text-text-primary">{name || 'New Client'}</h1>
        </div>
        <button onClick={save} disabled={saving}
          className="h-11 px-5 text-[16px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors min-w-[96px]">
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
                className="dark-entry" />
              <select value={clientType} onChange={e => setClientType(e.target.value)}
                className="dark-entry appearance-none">
                <option value="">Client type…</option>
                {CLIENT_TYPES.map(t => <option key={t} value={t}>{CLIENT_TYPE_LABELS[t]}</option>)}
              </select>
              <input placeholder="Primary contact" value={contactPerson} onChange={e => setContactPerson(e.target.value)}
                className="dark-entry" />
              <div className="grid grid-cols-2 gap-3">
                <input type="tel" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)}
                  className="dark-entry" />
                <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                  className="dark-entry" />
              </div>
              <input placeholder="Address" value={address} onChange={e => setAddress(e.target.value)}
                className="dark-entry" />
              <textarea placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)}
                rows={3} className="dark-entry min-h-[72px] py-3 resize-none" />
            </div>

            {/* Client Portal Access */}
            <div className="card p-4 space-y-3">
              <p className="section-label">CLIENT PORTAL ACCESS</p>
              <input readOnly value={companyCode} placeholder="Company code"
                className="dark-entry text-text-secondary cursor-default" />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input placeholder="Client code" value={clientCode} onChange={e => setClientCode(e.target.value)}
                  className="dark-entry" />
                <button onClick={generateCode}
                  className="px-3 rounded-sm bg-surface-elevated border border-border text-text-primary text-[12px] whitespace-nowrap hover:bg-background transition-colors">
                  Generate
                </button>
              </div>
              <button
                onClick={copyCredentials}
                disabled={!clientCode}
                className="w-full h-[42px] rounded-sm bg-surface-elevated border border-border text-text-primary text-[12px] hover:bg-background transition-colors disabled:opacity-40">
                Copy portal login credentials
              </button>
              {clientCode && (
                <button onClick={rotateCode}
                  className="w-full h-[42px] rounded-sm bg-surface-elevated border border-border text-[12px] hover:bg-background transition-colors"
                  style={{ color: '#F59E0B' }}>
                  Rotate portal code
                </button>
              )}
              <p className="text-text-secondary text-[11px]">
                Clients use Home → Client portal sign-in with company code + client code.
              </p>
            </div>

            {/* Sites */}
            {showRelatedTabs && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="section-label">SITES</p>
                  <button className="text-primary text-[13px] px-2 hover:opacity-70 transition-opacity">+ Site</button>
                </div>
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
              <button onClick={() => router.push('/dashboard/projects/new')}
                className="btn-primary h-9 px-[14px] text-[13px]">+ Project</button>
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
              <ComingSoon />
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
                                {p.code ?? '—'}
                              </button>
                            </td>
                            <td className="data-td">
                              <button onClick={() => router.push(`/dashboard/projects/${p.id}`)}
                                className="text-left text-text-primary text-[13px] truncate w-full hover:text-primary transition-colors">
                                {p.name}
                              </button>
                            </td>
                            <td className="data-td">
                              <select value={p.status ?? 'draft'} onChange={e => updateProjectStatus(p, e.target.value)}
                                className="text-[11px] h-8 px-2 rounded-lg border border-border bg-surface focus:outline-none w-full"
                                style={{ color: sc.fg }}>
                                {PROJECT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                              </select>
                            </td>
                            <td className="data-td text-text-secondary text-[12px] text-right">{fmtCurrency(p.offer_amount)}</td>
                            <td className="data-td text-center">
                              <button className="bg-primary text-white rounded-lg h-7 px-2 text-[10px] font-medium">+ Pay</button>
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
        {showRelatedTabs && tab === 'jobs' && <ComingSoon />}
      </div>
    </div>
  )
}
