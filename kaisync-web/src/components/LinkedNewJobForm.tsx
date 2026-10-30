'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePortalHref, usePortalMode } from '@/lib/client-portal/portal-mode'
import { ClientPortalShell } from '@/components/ClientPortalShell'
import { createLinkedJob, linkedJobSites, type LinkedSite, type NewLinkedJob } from '@/lib/linked-jobs'

const field = 'w-full h-10 px-3 rounded-lg border border-divider bg-surface text-[13px] text-text-primary'

/** "New job" for a linked customer: becomes the provider's own job for us, open and unassigned. */
export function LinkedNewJobForm() {
  const mode = usePortalMode()
  const ph = usePortalHref()
  const router = useRouter()
  const [sites, setSites] = useState<LinkedSite[]>([])
  const [form, setForm] = useState<NewLinkedJob>({ title: '', description: '', priority: 'medium', preferredStart: '', siteId: '', address: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mode.kind !== 'linked') return
    void linkedJobSites(createClient(), mode.companyId, mode.linkId).then(res => { if (res.ok) setSites(res.data) })
  }, [mode])

  if (mode.kind !== 'linked') return null
  const linked = mode

  async function submit() {
    if (!form.title.trim()) { setError('Give the job a title.'); return }
    setBusy(true)
    setError(null)
    const res = await createLinkedJob(createClient(), linked.companyId, linked.linkId, form)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    router.push(ph(`/jobs/${res.data.id}`))
  }

  return (
    <ClientPortalShell session={linked.session}>
    <div className="px-4 py-4 md:px-6 md:py-5 max-w-2xl space-y-4 text-[13px]">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => router.push(ph('/home?tab=jobs'))} className="text-text-secondary hover:text-text-primary" aria-label="Back">
          <span className="material-icons">arrow_back</span>
        </button>
        <h1 className="text-text-primary text-[18px] font-bold">New job for {linked.providerName}</h1>
      </div>
      <p className="text-text-secondary">
        The job goes straight to {linked.providerName} as one of their jobs for you. It starts open and unassigned;
        they choose the team. You can cancel it until they assign someone.
      </p>
      <div className="bg-surface border border-divider rounded-xl p-4 space-y-3">
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-text-secondary uppercase">What needs doing *</span>
          <input className={field} value={form.title} maxLength={200} placeholder="e.g. Geyser leaking in block B"
            onChange={e => setForm({ ...form, title: e.target.value })} />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-semibold text-text-secondary uppercase">Details</span>
          <textarea className={`${field} h-auto min-h-[88px] py-2`} value={form.description} maxLength={5000}
            placeholder="Anything that helps the team: access, contact on site, what you have seen"
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-text-secondary uppercase">Priority</span>
            <select className={field} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as NewLinkedJob['priority'] })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-text-secondary uppercase">Preferred start</span>
            <input type="datetime-local" className={field} value={form.preferredStart}
              onChange={e => setForm({ ...form, preferredStart: e.target.value })} />
          </label>
        </div>
        {sites.length > 0 && (
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-text-secondary uppercase">Site</span>
            <select className={field} value={form.siteId} onChange={e => setForm({ ...form, siteId: e.target.value })}>
              <option value="">Another address (type it below)</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}{s.address ? ` — ${s.address}` : ''}</option>)}
            </select>
          </label>
        )}
        {!form.siteId && (
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold text-text-secondary uppercase">Address</span>
            <input className={field} value={form.address} maxLength={500} placeholder="Where the work is"
              onChange={e => setForm({ ...form, address: e.target.value })} />
          </label>
        )}
        {error && <p className="text-error">{error}</p>}
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => void submit()} className="btn-primary h-10 px-4 text-[13px]">
            {busy ? 'Creating…' : 'Create job'}
          </button>
          <button type="button" disabled={busy} onClick={() => router.push(ph('/home?tab=jobs'))} className="btn-outlined h-10 px-4 text-[13px]">Cancel</button>
        </div>
      </div>
    </div>
    </ClientPortalShell>
  )
}
