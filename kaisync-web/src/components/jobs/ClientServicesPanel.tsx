'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  addClientService,
  formatPrice,
  listClientServices,
  listJobServices,
  removeClientService,
  updateClientServicePrice,
  type ClientServiceRow,
  type JobService,
} from '@/lib/job-services'

type Props = { companyId: string; clientId: string; clientName: string; canEdit: boolean }

const input =
  'h-9 px-2.5 rounded-sm bg-surface-elevated border border-border text-[13px] text-text-primary ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30'

function priceOrNull(text: string): number | null | 'bad' {
  if (!text.trim()) return null
  const n = Number(text)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 'bad'
}

/**
 * The services that apply to one client, with an optional agreed price. When a client has none
 * here, the job form offers the company's whole list (Jobs > Job services).
 */
export function ClientServicesPanel({ companyId, clientId, clientName, canEdit }: Props) {
  const [all, setAll] = useState<JobService[]>([])
  const [rows, setRows] = useState<ClientServiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState('')
  const [price, setPrice] = useState('')
  const [prices, setPrices] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const supabase = createClient()
    const [a, r] = await Promise.all([
      listJobServices(supabase, companyId, { includeInactive: true }),
      listClientServices(supabase, companyId, clientId),
    ])
    setLoading(false)
    if (!a.ok) { setError(a.message); return }
    if (!r.ok) { setError(r.message); return }
    setAll(a.data)
    setRows(r.data)
    setPrices(Object.fromEntries(r.data.map(x => [x.id, x.agreed_price == null ? '' : String(x.agreed_price)])))
  }, [companyId, clientId])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  const byId = new Map(all.map(s => [s.id, s]))
  const chosen = new Set(rows.map(r => r.service_id))
  const addable = all.filter(s => s.is_active && !chosen.has(s.id))

  async function add() {
    const p = priceOrNull(price)
    if (p === 'bad') { setError('Enter a price of 0 or more, or leave it blank.'); return }
    if (!pick) return
    setBusy(true); setError(null)
    const res = await addClientService(createClient(), companyId, clientId, pick, p)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setPick(''); setPrice('')
    await load()
  }

  async function savePrice(row: ClientServiceRow) {
    const p = priceOrNull(prices[row.id] ?? '')
    if (p === 'bad') { setError('Enter a price of 0 or more, or leave it blank.'); return }
    if (p === row.agreed_price) return
    setBusy(true); setError(null)
    const res = await updateClientServicePrice(createClient(), companyId, row.id, p)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, agreed_price: p } : r))
  }

  async function remove(row: ClientServiceRow) {
    setBusy(true); setError(null)
    const res = await removeClientService(createClient(), companyId, row.id)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  const sorted = [...rows].sort((a, b) => (byId.get(a.service_id)?.name ?? '').localeCompare(byId.get(b.service_id)?.name ?? ''))

  return (
    <div className="space-y-2">
      <p className="section-label">JOB SERVICES</p>
      <div className="card p-3 space-y-2">
        <p className="text-[12px] text-text-secondary">
          {rows.length === 0
            ? <>No services chosen for {clientName}, so their jobs can use any of your services. Choose services here to show only those, with an agreed price if it differs.</>
            : <>Jobs for {clientName} show only these services. The agreed price replaces your usual price.</>}
        </p>
        {loading ? (
          <p className="text-[12px] text-text-secondary">Loading…</p>
        ) : all.length === 0 ? (
          <p className="text-[12px] text-text-secondary">
            You have no services yet. <Link href="/dashboard/jobs/services" className="text-primary hover:underline">Add them under Jobs › Job services</Link>.
          </p>
        ) : (
          <>
            {sorted.length > 0 && (
              <ul className="divide-y divide-divider rounded-sm border border-divider">
                {sorted.map(r => {
                  const s = byId.get(r.service_id)
                  return (
                    <li key={r.id} className="flex items-center gap-2 px-2 py-1.5 text-[13px] flex-wrap">
                      <span className={`flex-1 min-w-[140px] ${s?.is_active === false ? 'text-text-disabled' : 'text-text-primary'}`}>
                        {s?.name ?? 'Service'}
                        {s?.is_active === false && <span className="ml-1 text-[11px]">(hidden)</span>}
                        {s?.default_price != null && <span className="ml-2 text-[11px] text-text-secondary">usual {formatPrice(s.default_price)}</span>}
                      </span>
                      {canEdit ? (
                        <>
                          <label className="flex items-center gap-1 text-[12px] text-text-secondary">
                            Agreed R
                            <input className={`${input} w-28`} type="number" min="0" step="0.01" inputMode="decimal"
                              aria-label={`Agreed price for ${s?.name ?? 'service'}`}
                              value={prices[r.id] ?? ''} placeholder="Usual"
                              onWheel={e => e.currentTarget.blur()}
                              onChange={e => setPrices(prev => ({ ...prev, [r.id]: e.target.value }))}
                              onBlur={() => void savePrice(r)} />
                          </label>
                          <button type="button" className="text-error text-[11px]" disabled={busy} onClick={() => void remove(r)}>Remove</button>
                        </>
                      ) : (
                        <span className="text-[12px] text-text-secondary">{r.agreed_price != null ? formatPrice(r.agreed_price) : 'Usual price'}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {canEdit && addable.length > 0 && (
              <form className="flex flex-wrap gap-2 items-center" onSubmit={e => { e.preventDefault(); void add() }}>
                <select className={`${input} flex-1 min-w-[160px]`} aria-label="Service to add" value={pick} onChange={e => setPick(e.target.value)}>
                  <option value="">Add a service…</option>
                  {addable.map(s => <option key={s.id} value={s.id}>{s.name}{s.default_price != null ? ` · usual ${formatPrice(s.default_price)}` : ''}</option>)}
                </select>
                <input className={`${input} w-32`} type="number" min="0" step="0.01" inputMode="decimal" aria-label="Agreed price (optional)"
                  placeholder="Agreed R (optional)" value={price}
                  onWheel={e => e.currentTarget.blur()}
                  onChange={e => setPrice(e.target.value)} />
                <button type="submit" disabled={busy || !pick} className="btn-primary h-9 px-3 text-[12px] disabled:opacity-50">Add</button>
              </form>
            )}
          </>
        )}
        {error && <p className="text-[12px] text-error" role="alert">{error}</p>}
      </div>
    </div>
  )
}
