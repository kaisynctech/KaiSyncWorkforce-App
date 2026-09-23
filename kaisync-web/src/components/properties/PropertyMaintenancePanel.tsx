'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  listPropertyMaintenanceJobs,
  logPropertyWork,
  type MaintenanceJobRow,
} from '@/lib/property-maintenance'

type ContractorOpt = { id: string; name: string; phone: string | null; profile_tier?: string | null }

type Props = {
  companyId: string
  siteId: string
  unitId?: string | null
  employeeId: string | null
  canEdit: boolean
  /** When true, show unit column (property-level view) */
  showUnitColumn?: boolean
  units?: { id: string; unit_number: string }[]
}

const fmtMoney = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 2 }).format(n)
}

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

export function PropertyMaintenancePanel({
  companyId,
  siteId,
  unitId,
  employeeId,
  canEdit,
  showUnitColumn,
  units = [],
}: Props) {
  const [jobs, setJobs] = useState<MaintenanceJobRow[]>([])
  const [contractors, setContractors] = useState<ContractorOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [busy, setBusy] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState('')
  const [workUnitId, setWorkUnitId] = useState(unitId ?? '')
  const [contractorMode, setContractorMode] = useState<'existing' | 'new' | 'none'>('existing')
  const [contractorId, setContractorId] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newTrade, setNewTrade] = useState('')
  const [done, setDone] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const [jobsRes, cRes] = await Promise.all([
      listPropertyMaintenanceJobs(supabase, {
        companyId,
        siteId,
        unitId: unitId || null,
        limit: 100,
      }),
      supabase
        .from('contractors')
        .select('id, name, phone, profile_tier')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .or('partner_kind.eq.contractor,partner_kind.eq.both,partner_kind.is.null')
        .order('name')
        .limit(500),
    ])
    if (!jobsRes.ok) setError(jobsRes.message)
    else setJobs(jobsRes.data)
    setContractors((cRes.data ?? []) as ContractorOpt[])
    setLoading(false)
  }, [companyId, siteId, unitId])

  useEffect(() => { void load() }, [load])

  function openLog() {
    setTitle('')
    setDescription('')
    setCost('')
    setWorkUnitId(unitId ?? '')
    setContractorMode('existing')
    setContractorId('')
    setNewName('')
    setNewPhone('')
    setNewTrade('')
    setDone(true)
    setError(null)
    setShowLog(true)
  }

  async function saveWork() {
    if (!canEdit || !title.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const costNum = cost.trim() ? parseFloat(cost) : null
    const result = await logPropertyWork(supabase, {
      companyId,
      employeeId,
      siteId,
      unitId: workUnitId || unitId || null,
      title,
      description,
      cost: Number.isFinite(costNum as number) ? costNum : null,
      contractorId: contractorMode === 'existing' ? (contractorId || null) : null,
      newContractor: contractorMode === 'new'
        ? { name: newName, phone: newPhone, trade: newTrade }
        : null,
      done,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setShowLog(false)
    await load()
  }

  const totalSpend = jobs.reduce((s, j) => s + (Number(j.actual_cost ?? j.contractor_cost) || 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[12px] text-text-secondary">
            Work on this {unitId ? 'unit' : 'property'} — full jobs or light trade contacts (roadside glass, plumber, etc.).
          </p>
          {jobs.length > 0 && (
            <p className="text-[11px] text-text-disabled mt-0.5">
              {jobs.length} job{jobs.length === 1 ? '' : 's'} · recorded spend {fmtMoney(totalSpend)}
            </p>
          )}
        </div>
        {canEdit && (
          <button type="button" onClick={openLog} className="btn-outlined h-9 px-3 text-[13px]">
            + Log work
          </button>
        )}
      </div>

      {error && <p className="text-[13px] text-error">{error}</p>}

      {loading ? (
        <p className="text-[13px] text-text-secondary">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No maintenance jobs yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: showUnitColumn ? 640 : 560 }}>
            <thead>
              <tr className="border-b border-divider">
                <th className="data-th text-left">Work</th>
                {showUnitColumn && <th className="data-th text-left">Unit</th>}
                <th className="data-th text-left">Contractor</th>
                <th className="data-th text-right">Cost</th>
                <th className="data-th text-left">Status</th>
                <th className="data-th text-left">Date</th>
                <th className="data-th text-left" />
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} className="border-b border-divider">
                  <td className="data-td text-[13px] font-medium">
                    <div>{j.title}</div>
                    {j.job_code && <div className="text-[10px] text-text-disabled">{j.job_code}</div>}
                  </td>
                  {showUnitColumn && (
                    <td className="data-td text-[12px] text-text-secondary">
                      {j.units?.unit_number ?? (j.unit_id ? '—' : 'Property')}
                    </td>
                  )}
                  <td className="data-td text-[12px]">
                    {j.contractors ? (
                      <>
                        {j.contractors.name}
                        {j.contractors.profile_tier === 'light' && (
                          <span className="ml-1 text-[10px] text-text-disabled">(light)</span>
                        )}
                        {j.contractors.phone && (
                          <div className="text-[10px] text-text-disabled">{j.contractors.phone}</div>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td className="data-td text-[13px] text-right">
                    {fmtMoney(j.actual_cost ?? j.contractor_cost)}
                  </td>
                  <td className="data-td text-[12px] capitalize">{j.status.replace(/_/g, ' ')}</td>
                  <td className="data-td text-[12px]">{fmtDate((j.closed_at ?? j.created_at)?.slice(0, 10))}</td>
                  <td className="data-td text-right">
                    <Link href={`/dashboard/jobs/${j.id}`} className="text-[12px] text-primary hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showLog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-text-primary">Log work</h2>
            <p className="text-[11px] text-text-secondary">
              Creates a job on this property{unitId ? ' / unit' : ''}. Roadside trades are saved as light contractors so you can call them again.
            </p>

            <label className="block text-[12px] text-text-secondary">What was done *
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Glass cut and fitted — bathroom window"
                className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
              />
            </label>
            <label className="block text-[12px] text-text-secondary">Notes
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                className="mt-1 w-full px-3 py-2 border border-border rounded-md text-[13px] bg-background"
              />
            </label>

            {!unitId && units.length > 0 && (
              <label className="block text-[12px] text-text-secondary">Unit (optional)
                <select
                  value={workUnitId}
                  onChange={e => setWorkUnitId(e.target.value)}
                  className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
                >
                  <option value="">— Whole property —</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
                </select>
              </label>
            )}

            <label className="block text-[12px] text-text-secondary">Cost (ZAR)
              <input
                type="number"
                step="0.01"
                value={cost}
                onChange={e => setCost(e.target.value)}
                placeholder="e.g. 350"
                className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
              />
            </label>

            <div className="space-y-2">
              <p className="text-[12px] text-text-secondary">Contractor</p>
              <div className="flex flex-wrap gap-2">
                {(['existing', 'new', 'none'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setContractorMode(m)}
                    className={`h-8 px-2 text-[11px] rounded-md border ${
                      contractorMode === m ? 'border-primary text-primary bg-primary/5' : 'border-border text-text-secondary'
                    }`}
                  >
                    {m === 'existing' ? 'Pick existing' : m === 'new' ? '+ Light trade' : 'None'}
                  </button>
                ))}
              </div>
              {contractorMode === 'existing' && (
                <select
                  value={contractorId}
                  onChange={e => setContractorId(e.target.value)}
                  className="w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
                >
                  <option value="">— Select —</option>
                  {contractors.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.profile_tier === 'light' ? ' (light)' : ''}{c.phone ? ` · ${c.phone}` : ''}
                    </option>
                  ))}
                </select>
              )}
              {contractorMode === 'new' && (
                <div className="grid grid-cols-1 gap-2 rounded-lg border border-divider p-3 bg-surface-elevated">
                  <label className="block text-[11px] text-text-secondary">Name *
                    <input value={newName} onChange={e => setNewName(e.target.value)} className="mt-1 w-full h-9 px-2 border border-border rounded-md text-[13px] bg-background" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] text-text-secondary">Phone
                      <input value={newPhone} onChange={e => setNewPhone(e.target.value)} className="mt-1 w-full h-9 px-2 border border-border rounded-md text-[13px] bg-background" />
                    </label>
                    <label className="block text-[11px] text-text-secondary">Trade
                      <input value={newTrade} onChange={e => setNewTrade(e.target.value)} placeholder="glass, plumbing…" className="mt-1 w-full h-9 px-2 border border-border rounded-md text-[13px] bg-background" />
                    </label>
                  </div>
                  <p className="text-[10px] text-text-disabled">Saved as a light contractor — no compliance pack required.</p>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-[13px] text-text-primary">
              <input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} />
              Work already completed
            </label>

            {error && <p className="text-[12px] text-error">{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowLog(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
              <button
                type="button"
                disabled={busy || !title.trim() || (contractorMode === 'new' && !newName.trim())}
                onClick={() => void saveWork()}
                className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
