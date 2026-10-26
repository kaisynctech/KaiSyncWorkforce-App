'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FormSelect } from '@/components/FormSelect'
import {
  addClientSite,
  addSiteArea,
  areaOptions,
  formatPrice,
  listClientServices,
  listClientSites,
  listJobServices,
  listSiteAreas,
  servicesOffered,
  type OfferedService,
  type SiteArea,
  type SiteRow,
} from '@/lib/job-services'

export type JobWhereValue = { siteId: string; areaId: string; serviceId: string }

type Props = {
  companyId: string
  clientId: string
  value: JobWhereValue
  onChange: (next: JobWhereValue) => void
  /** Called when a service is chosen, so the form can fill the title, cost, end time and checklist. */
  onServicePicked?: (service: OfferedService | null) => void
  /** Whether the person may add sites and areas from here (jobs.create or jobs.edit). */
  canAdd: boolean
  disabled?: boolean
  /** False when the form picks the service itself (New job asks for the service first). */
  showService?: boolean
}

const ADD = '__add__'

const smallInput =
  'flex-1 min-w-0 h-10 px-3 rounded-sm bg-surface-elevated border border-border text-[14px] text-text-primary ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30'

/**
 * Site → Area → Service for a job. Sites and areas belong to the job's client; services come from
 * the client's own list when it has one, otherwise the company's list (Jobs > Job services).
 * A site or area that is missing can be added on the spot and is saved to the client for next time.
 */
export function JobWherePicker({ companyId, clientId, value, onChange, onServicePicked, canAdd, disabled, showService = true }: Props) {
  const [sites, setSites] = useState<SiteRow[]>([])
  const [areas, setAreas] = useState<SiteArea[]>([])
  const [services, setServices] = useState<OfferedService[]>([])
  const [serviceNames, setServiceNames] = useState<Map<string, string>>(new Map())
  const [clientHasList, setClientHasList] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<'site' | 'area' | null>(null)
  const [newName, setNewName] = useState('')
  const [newParent, setNewParent] = useState('')
  const [busy, setBusy] = useState(false)
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value })

  // Sites and services for this client.
  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    void (async () => {
      const [all, rows, siteRes] = await Promise.all([
        listJobServices(supabase, companyId, { includeInactive: true }),
        clientId ? listClientServices(supabase, companyId, clientId) : Promise.resolve({ ok: true as const, data: [] }),
        clientId ? listClientSites(supabase, companyId, clientId) : Promise.resolve({ ok: true as const, data: [] as SiteRow[] }),
      ])
      if (cancelled) return
      if (!all.ok) { setError(all.message); return }
      if (!rows.ok) { setError(rows.message); return }
      if (!siteRes.ok) { setError(siteRes.message); return }
      setError(null)
      setServices(servicesOffered(all.data, rows.data))
      setServiceNames(new Map(all.data.map(s => [s.id, s.name])))
      setClientHasList(rows.data.length > 0)
      setSites(siteRes.data)
      // A client with one site: pick it.
      const v = valueRef.current
      if (clientId && !v.siteId && siteRes.data.length === 1) onChange({ ...v, siteId: siteRes.data[0].id, areaId: '' })
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, clientId])

  // Areas for the chosen site.
  useEffect(() => {
    let cancelled = false
    if (!value.siteId) { void Promise.resolve().then(() => { if (!cancelled) setAreas([]) }); return () => { cancelled = true } }
    void listSiteAreas(createClient(), companyId, [value.siteId]).then(res => {
      if (cancelled) return
      if (res.ok) setAreas(res.data)
      else setError(res.message)
    })
    return () => { cancelled = true }
  }, [companyId, value.siteId])

  const options = useMemo(() => areaOptions(areas), [areas])

  function pickService(id: string) {
    onChange({ ...value, serviceId: id })
    onServicePicked?.(services.find(s => s.id === id) ?? null)
  }

  async function saveNew() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    if (adding === 'site') {
      const res = await addClientSite(supabase, companyId, clientId, name)
      setBusy(false)
      if (!res.ok) { setError(res.message); return }
      setSites(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
      onChange({ ...value, siteId: res.data.id, areaId: '' })
    } else if (adding === 'area') {
      const res = await addSiteArea(supabase, companyId, { siteId: value.siteId, name, parentAreaId: newParent || null })
      setBusy(false)
      if (!res.ok) { setError(res.message); return }
      setAreas(prev => [...prev, res.data])
      onChange({ ...value, areaId: res.data.id })
    }
    setAdding(null)
    setNewName('')
    setNewParent('')
  }

  const addRow = adding && (
    <div className="flex flex-col gap-2 rounded-sm border border-divider p-2">
      <div className="flex gap-2">
        <input
          className={smallInput}
          autoFocus
          aria-label={adding === 'site' ? 'New site name' : 'New area name'}
          placeholder={adding === 'site' ? 'Site name, e.g. Rosslyn plant' : 'Area name, e.g. Service Room'}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveNew() } }}
        />
        <button type="button" disabled={busy || !newName.trim()} onClick={() => void saveNew()} className="btn-primary h-10 px-3 text-[13px] disabled:opacity-50">
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button type="button" onClick={() => { setAdding(null); setNewName('') }} className="btn-outlined h-10 px-3 text-[13px]">Cancel</button>
      </div>
      {adding === 'area' && options.length > 0 && (
        <FormSelect label="Inside" value={newParent} onChange={e => setNewParent(e.target.value)}>
          <option value="">Not inside another area</option>
          {options.map(a => <option key={a.id} value={a.id}>{a.path}</option>)}
        </FormSelect>
      )}
      <p className="text-[11px] text-text-secondary">Saved to this client, so it is in the list next time.</p>
    </div>
  )

  const selected = services.find(s => s.id === value.serviceId)

  return (
    <div className="space-y-3">
      {!clientId ? (
        <p className="text-[12px] text-text-secondary">Choose a client to pick their site and area.</p>
      ) : (
        <>
          <FormSelect
            label="Site"
            value={value.siteId}
            disabled={disabled}
            onChange={e => {
              if (e.target.value === ADD) { setAdding('site'); setNewName(''); return }
              onChange({ ...value, siteId: e.target.value, areaId: '' })
            }}
          >
            <option value="">{sites.length ? 'Choose a site' : 'No sites for this client yet'}</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            {canAdd && <option value={ADD}>+ Add a site…</option>}
          </FormSelect>
          {adding === 'site' && addRow}

          {value.siteId && (
            <>
              <FormSelect
                label="Area"
                value={value.areaId}
                disabled={disabled}
                onChange={e => {
                  if (e.target.value === ADD) { setAdding('area'); setNewName(''); setNewParent(value.areaId); return }
                  onChange({ ...value, areaId: e.target.value })
                }}
              >
                <option value="">{options.length ? 'Choose an area (optional)' : 'No areas for this site yet'}</option>
                {options.map(a => (
                  <option key={a.id} value={a.id}>
                    {`${'  '.repeat(a.depth)}${a.name}${a.priority ? ` (priority ${a.priority})` : ''}`}
                  </option>
                ))}
                {canAdd && <option value={ADD}>+ Add an area…</option>}
              </FormSelect>
              {adding === 'area' && addRow}
            </>
          )}
        </>
      )}

      {showService && <>
      <FormSelect
        label="Service"
        value={value.serviceId}
        disabled={disabled}
        hint={services.length === 0
          ? 'No services yet. Add them under Jobs > Job services.'
          : clientHasList ? 'Showing the services agreed for this client.' : undefined}
        onChange={e => pickService(e.target.value)}
      >
        <option value="">No service</option>
        {value.serviceId && !services.some(s => s.id === value.serviceId) && (
          <option value={value.serviceId}>{serviceNames.get(value.serviceId) ?? 'Current service'} (not in the list any more)</option>
        )}
        {services.map(s => (
          <option key={s.id} value={s.id}>
            {s.name}{s.price != null ? ` · ${formatPrice(s.price)}` : ''}
          </option>
        ))}
      </FormSelect>
      {selected?.description && <p className="text-[12px] text-text-secondary -mt-1">{selected.description}</p>}
      </>}
      {error && <p className="text-[12px] text-error" role="alert">{error}</p>}
    </div>
  )
}
