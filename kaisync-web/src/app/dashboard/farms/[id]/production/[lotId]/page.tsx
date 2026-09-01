'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { recordProductionEvent } from '@/lib/farms'
import { KpiTile } from '@/components/ui/KpiTile'
import {
  PRODUCTION_EVENT_LABELS,
  type Farm,
  type FarmProductionEvent,
  type FarmProductionLot,
  type ProductionEventType,
  type ProductionLotStatus,
} from '@/types/farms'

export default function ProductionLotDetailPage() {
  const { id: farmId, lotId } = useParams<{ id: string; lotId: string }>()
  const router = useRouter()

  const [farm, setFarm] = useState<Farm | null>(null)
  const [lot, setLot] = useState<FarmProductionLot | null>(null)
  const [events, setEvents] = useState<FarmProductionEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [showEvent, setShowEvent] = useState(false)
  const [eType, setEType] = useState<ProductionEventType>('collect')
  const [eQty, setEQty] = useState('1')
  const [eDate, setEDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [eNotes, setENotes] = useState('')

  const canEdit = can(perms, PERM.farmsEdit)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    setEmployeeId(member.employeeId)
    const { data: me } = await supabase
      .from('employees')
      .select('access_level')
      .eq('id', member.employeeId)
      .maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const [fRes, lRes, eRes] = await Promise.all([
      supabase.from('farms').select('*').eq('id', farmId).eq('company_id', member.companyId).maybeSingle(),
      supabase
        .from('farm_production_lots')
        .select('*, farm_land_units(name), farm_livestock_groups(name)')
        .eq('id', lotId)
        .eq('farm_id', farmId)
        .eq('company_id', member.companyId)
        .maybeSingle(),
      supabase
        .from('farm_production_events')
        .select('*')
        .eq('lot_id', lotId)
        .eq('company_id', member.companyId)
        .order('event_date', { ascending: false })
        .limit(200),
    ])

    if (!fRes.data || !lRes.data) {
      router.replace(`/dashboard/farms/${farmId}?tab=production`)
      return
    }

    setFarm(fRes.data as Farm)
    setLot(lRes.data as FarmProductionLot)
    setEvents((eRes.data ?? []) as FarmProductionEvent[])
    setLoading(false)
  }, [farmId, lotId, router])

  useEffect(() => { void load() }, [load])

  async function submitEvent() {
    if (!companyId || !canEdit || !lot) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const result = await recordProductionEvent(supabase, {
      companyId,
      farmId,
      lotId: lot.id,
      employeeId,
      eventType: eType,
      quantity: Number(eQty) || 1,
      eventDate: eDate,
      notes: eNotes,
    })
    setBusy(false)
    if (!result.ok) { setError(result.message); return }
    setShowEvent(false)
    setENotes('')
    setEQty('1')
    await load()
  }

  async function setStatus(status: ProductionLotStatus) {
    if (!companyId || !canEdit || !lot) return
    setBusy(true)
    const supabase = createClient()
    const { error: e } = await supabase
      .from('farm_production_lots')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', lot.id)
      .eq('company_id', companyId)
    setBusy(false)
    if (e) { setError(e.message); return }
    await load()
  }

  if (loading) {
    return <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
  }
  if (!farm || !lot) return null

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 space-y-4 pb-12">
        <button
          type="button"
          onClick={() => router.push(`/dashboard/farms/${farmId}?tab=production`)}
          className="flex items-center gap-1 text-[13px] text-primary hover:underline"
        >
          <span className="material-icons text-[16px]">arrow_back</span>{farm.name}
        </button>

        <div className="bg-surface border border-divider rounded-xl p-4 space-y-1">
          <h1 className="text-[20px] font-semibold text-text-primary">{lot.name}</h1>
          <p className="text-[13px] text-text-secondary capitalize">
            {lot.product_type}
            {lot.farm_livestock_groups?.name ? ` · ${lot.farm_livestock_groups.name}` : ''}
            {lot.farm_land_units?.name ? ` · ${lot.farm_land_units.name}` : ''}
            {' · '}
            <span className="capitalize">{lot.status}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <KpiTile
            value={Number(lot.quantity_total)}
            label={`On hand (${lot.unit})`}
            bg="#0F2918"
            valueFg="#22C55E"
            labelFg="#4ADE80"
          />
          <KpiTile
            value={events.filter(e => e.event_type === 'collect').reduce((s, e) => s + Number(e.quantity), 0)}
            label={`Collected (${lot.unit})`}
            bg="#1E293B"
            valueFg="#FCD34D"
            labelFg="#64748B"
          />
          <KpiTile
            value={events.length}
            label="Events"
            bg="#1E293B"
            valueFg="#94A3B8"
            labelFg="#64748B"
          />
        </div>

        {error && <p className="text-[13px] text-error">{error}</p>}

        <div className="flex gap-2 flex-wrap">
          {canEdit && (
            <>
              <button type="button" onClick={() => setShowEvent(true)} className="btn-primary h-9 px-3 text-[13px]">
                Record event
              </button>
              {lot.status === 'open' && (
                <button type="button" disabled={busy} onClick={() => void setStatus('closed')} className="btn-outlined h-9 px-3 text-[13px] disabled:opacity-50">
                  Close lot
                </button>
              )}
              {lot.status !== 'sold' && (
                <button type="button" disabled={busy} onClick={() => void setStatus('sold')} className="btn-outlined h-9 px-3 text-[13px] disabled:opacity-50">
                  Mark sold
                </button>
              )}
            </>
          )}
        </div>

        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold text-text-primary uppercase tracking-wide">Activity</h2>
          {events.length === 0 ? (
            <p className="text-[13px] text-text-secondary">No production events yet.</p>
          ) : (
            <div className="overflow-x-auto border border-divider rounded-xl">
              <table className="w-full" style={{ minWidth: 520 }}>
                <thead>
                  <tr className="bg-surface-elevated border-b border-divider">
                    <th className="data-th text-left">Date</th>
                    <th className="data-th text-left">Type</th>
                    <th className="data-th text-right">Qty</th>
                    <th className="data-th text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} className="border-b border-divider last:border-0">
                      <td className="data-td text-[13px]">{ev.event_date}</td>
                      <td className="data-td text-[13px]">{PRODUCTION_EVENT_LABELS[ev.event_type]}</td>
                      <td className="data-td text-[13px] text-right font-medium">{ev.quantity}</td>
                      <td className="data-td text-[13px] text-text-secondary">{ev.notes ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {showEvent && (
        <Modal title={`Record event · ${lot.name}`} onClose={() => setShowEvent(false)}>
          <label className="block text-[12px] text-text-secondary">Event
            <select value={eType} onChange={e => setEType(e.target.value as ProductionEventType)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              {(Object.keys(PRODUCTION_EVENT_LABELS) as ProductionEventType[]).map(k => (
                <option key={k} value={k}>{PRODUCTION_EVENT_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">
              {eType === 'adjust' ? 'New total' : 'Quantity'}
              <input type="number" min={0.001} step="any" value={eQty} onChange={e => setEQty(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Date
              <input type="date" value={eDate} onChange={e => setEDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
          </div>
          <p className="text-[11px] text-text-secondary">Unit: {lot.unit}</p>
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={eNotes} onChange={e => setENotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowEvent(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void submitEvent()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-text-primary">{title}</h2>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
