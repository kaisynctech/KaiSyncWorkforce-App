'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { recordInputUsage } from '@/lib/farms'
import {
  HEALTH_EVENT_LABELS,
  INPUT_UNITS,
  INPUT_USAGE_LABELS,
  type FarmAnimal,
  type FarmDiaryEntry,
  type FarmHealthEvent,
  type FarmHealthEventType,
  type FarmInputUnit,
  type FarmInputUsage,
  type FarmInputUsageType,
  type FarmLandUnit,
  type FarmLivestockGroup,
  type FarmPlanting,
} from '@/types/farms'

export type InventoryOption = {
  id: string
  name: string
  unit_of_measure: string | null
  quantity_on_hand: number | null
}

type Props = {
  tab: 'diary' | 'health' | 'inputs'
  farmId: string
  companyId: string
  employeeId: string | null
  canEdit: boolean
  diary: FarmDiaryEntry[]
  health: FarmHealthEvent[]
  inputs: FarmInputUsage[]
  groups: FarmLivestockGroup[]
  animals: FarmAnimal[]
  landUnits: FarmLandUnit[]
  plantings: FarmPlanting[]
  inventoryItems: InventoryOption[]
  onChanged: () => Promise<void>
  onError: (msg: string | null) => void
}

export function FarmWave3aPanels(props: Props) {
  const {
    tab, farmId, companyId, employeeId, canEdit,
    diary, health, inputs, groups, animals, landUnits, plantings, inventoryItems,
    onChanged, onError,
  } = props

  const [busy, setBusy] = useState(false)
  const [showDiary, setShowDiary] = useState(false)
  const [showHealth, setShowHealth] = useState(false)
  const [showInput, setShowInput] = useState(false)

  const [dDate, setDDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dTitle, setDTitle] = useState('')
  const [dBody, setDBody] = useState('')
  const [dGroup, setDGroup] = useState('')
  const [dLand, setDLand] = useState('')

  const [hType, setHType] = useState<FarmHealthEventType>('treatment')
  const [hDate, setHDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [hGroup, setHGroup] = useState('')
  const [hAnimal, setHAnimal] = useState('')
  const [hProduct, setHProduct] = useState('')
  const [hItem, setHItem] = useState('')
  const [hDosage, setHDosage] = useState('')
  const [hWithdraw, setHWithdraw] = useState('')
  const [hNotes, setHNotes] = useState('')

  const [iType, setIType] = useState<FarmInputUsageType>('feed')
  const [iDate, setIDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [iQty, setIQty] = useState('1')
  const [iUnit, setIUnit] = useState<FarmInputUnit>('kg')
  const [iProduct, setIProduct] = useState('')
  const [iItem, setIItem] = useState('')
  const [iDeduct, setIDeduct] = useState(false)
  const [iGroup, setIGroup] = useState('')
  const [iPlanting, setIPlanting] = useState('')
  const [iWithdraw, setIWithdraw] = useState('')
  const [iNotes, setINotes] = useState('')

  async function saveDiary() {
    if (!canEdit || !dBody.trim()) return
    setBusy(true)
    onError(null)
    const supabase = createClient()
    const { error } = await supabase.from('farm_diary_entries').insert({
      company_id: companyId,
      farm_id: farmId,
      entry_date: dDate,
      title: dTitle.trim() || null,
      body: dBody.trim(),
      group_id: dGroup || null,
      land_unit_id: dLand || null,
      recorded_by: employeeId,
    })
    setBusy(false)
    if (error) { onError(error.message); return }
    setShowDiary(false)
    setDTitle('')
    setDBody('')
    setDGroup('')
    setDLand('')
    await onChanged()
  }

  async function saveHealth() {
    if (!canEdit) return
    setBusy(true)
    onError(null)
    const supabase = createClient()
    const { error } = await supabase.from('farm_health_events').insert({
      company_id: companyId,
      farm_id: farmId,
      event_type: hType,
      event_date: hDate,
      group_id: hGroup || null,
      animal_id: hAnimal || null,
      product_label: hProduct.trim() || null,
      inventory_item_id: hItem || null,
      dosage: hDosage.trim() || null,
      withdrawal_until: hWithdraw || null,
      notes: hNotes.trim() || null,
      recorded_by: employeeId,
    })
    setBusy(false)
    if (error) { onError(error.message); return }
    setShowHealth(false)
    setHProduct('')
    setHItem('')
    setHDosage('')
    setHWithdraw('')
    setHNotes('')
    setHAnimal('')
    await onChanged()
  }

  async function saveInput() {
    if (!canEdit) return
    setBusy(true)
    onError(null)
    const supabase = createClient()
    const result = await recordInputUsage(supabase, {
      companyId,
      farmId,
      employeeId,
      usageType: iType,
      quantity: Number(iQty) || 1,
      unit: iUnit,
      usageDate: iDate,
      productLabel: iProduct,
      inventoryItemId: iItem || null,
      deductFromStock: iDeduct,
      groupId: iGroup || null,
      plantingId: iPlanting || null,
      withdrawalUntil: iWithdraw || null,
      notes: iNotes,
    })
    setBusy(false)
    if (!result.ok) { onError(result.message); return }
    setShowInput(false)
    setIQty('1')
    setIProduct('')
    setIItem('')
    setIDeduct(false)
    setIGroup('')
    setIPlanting('')
    setIWithdraw('')
    setINotes('')
    await onChanged()
  }

  if (tab === 'diary') {
    return (
      <div className="space-y-3">
        {canEdit && (
          <button type="button" onClick={() => setShowDiary(true)} className="btn-primary h-9 px-3 text-[13px]">+ Diary entry</button>
        )}
        <p className="text-[12px] text-text-secondary">Daily notes — replace the farm notebook.</p>
        {diary.length === 0 ? (
          <p className="text-[13px] text-text-secondary">No diary entries yet.</p>
        ) : (
          <table className="w-full" style={{ minWidth: 560 }}>
            <thead>
              <tr className="border-b border-divider">
                <th className="data-th text-left">Date</th>
                <th className="data-th text-left">Title / note</th>
                <th className="data-th text-left">Context</th>
              </tr>
            </thead>
            <tbody>
              {diary.map(e => (
                <tr key={e.id} className="border-b border-divider align-top">
                  <td className="data-td text-[13px] whitespace-nowrap">{e.entry_date}</td>
                  <td className="data-td text-[13px]">
                    {e.title && <div className="font-medium">{e.title}</div>}
                    <div className="text-text-secondary whitespace-pre-wrap">{e.body}</div>
                  </td>
                  <td className="data-td text-[12px] text-text-secondary">
                    {e.farm_livestock_groups?.name ?? e.farm_land_units?.name ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {showDiary && (
          <Modal title="Diary entry" onClose={() => setShowDiary(false)}>
            <label className="block text-[12px] text-text-secondary">Date
              <input type="date" value={dDate} onChange={e => setDDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Title (optional)
              <input value={dTitle} onChange={e => setDTitle(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Note
              <textarea value={dBody} onChange={e => setDBody(e.target.value)} rows={4} className="mt-1 w-full px-3 py-2 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Group (optional)
              <select value={dGroup} onChange={e => setDGroup(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                <option value="">— None —</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label className="block text-[12px] text-text-secondary">Land unit (optional)
              <select value={dLand} onChange={e => setDLand(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                <option value="">— None —</option>
                {landUnits.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowDiary(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
              <button type="button" disabled={busy || !dBody.trim()} onClick={() => void saveDiary()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save</button>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  if (tab === 'health') {
    return (
      <div className="space-y-3">
        {canEdit && (
          <button type="button" onClick={() => setShowHealth(true)} className="btn-primary h-9 px-3 text-[13px]">+ Health event</button>
        )}
        <p className="text-[12px] text-text-secondary">Medicine / health book — treatments, vaccines, illness, withdrawal dates.</p>
        {health.length === 0 ? (
          <p className="text-[13px] text-text-secondary">No health events yet.</p>
        ) : (
          <table className="w-full" style={{ minWidth: 680 }}>
            <thead>
              <tr className="border-b border-divider">
                <th className="data-th text-left">Date</th>
                <th className="data-th text-left">Type</th>
                <th className="data-th text-left">Group / animal</th>
                <th className="data-th text-left">Product</th>
                <th className="data-th text-left">Withdraw until</th>
              </tr>
            </thead>
            <tbody>
              {health.map(h => {
                const animal = h.farm_animals
                const animalLabel = animal
                  ? (animal.tag_number ?? animal.name ?? '—')
                  : null
                return (
                  <tr key={h.id} className="border-b border-divider">
                    <td className="data-td text-[13px]">{h.event_date}</td>
                    <td className="data-td text-[13px]">{HEALTH_EVENT_LABELS[h.event_type]}</td>
                    <td className="data-td text-[13px] text-text-secondary">
                      {h.farm_livestock_groups?.name ?? '—'}
                      {animalLabel ? ` · ${animalLabel}` : ''}
                    </td>
                    <td className="data-td text-[13px]">{h.product_label ?? '—'}{h.dosage ? ` (${h.dosage})` : ''}</td>
                    <td className="data-td text-[13px]">{h.withdrawal_until ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {showHealth && (
          <Modal title="Health event" onClose={() => setShowHealth(false)}>
            <label className="block text-[12px] text-text-secondary">Type
              <select value={hType} onChange={e => setHType(e.target.value as FarmHealthEventType)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                {(Object.keys(HEALTH_EVENT_LABELS) as FarmHealthEventType[]).map(k => (
                  <option key={k} value={k}>{HEALTH_EVENT_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] text-text-secondary">Date
              <input type="date" value={hDate} onChange={e => setHDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Group
              <select value={hGroup} onChange={e => setHGroup(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                <option value="">— None —</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            <label className="block text-[12px] text-text-secondary">Animal (optional)
              <select value={hAnimal} onChange={e => setHAnimal(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                <option value="">— None —</option>
                {animals.filter(a => !hGroup || a.group_id === hGroup).map(a => (
                  <option key={a.id} value={a.id}>{a.tag_number ?? a.name ?? a.id.slice(0, 8)}</option>
                ))}
              </select>
            </label>
            <label className="block text-[12px] text-text-secondary">Product / medicine
              <input value={hProduct} onChange={e => setHProduct(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            {inventoryItems.length > 0 && (
              <label className="block text-[12px] text-text-secondary">Inventory item (optional)
                <select value={hItem} onChange={e => setHItem(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                  <option value="">— None —</option>
                  {inventoryItems.map(it => (
                    <option key={it.id} value={it.id}>{it.name} ({Number(it.quantity_on_hand ?? 0)} on hand)</option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[12px] text-text-secondary">Dosage
                <input value={hDosage} onChange={e => setHDosage(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
              <label className="block text-[12px] text-text-secondary">Withdraw until
                <input type="date" value={hWithdraw} onChange={e => setHWithdraw(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
              </label>
            </div>
            <label className="block text-[12px] text-text-secondary">Notes
              <input value={hNotes} onChange={e => setHNotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowHealth(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void saveHealth()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save</button>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // inputs
  return (
    <div className="space-y-3">
      {canEdit && (
        <button type="button" onClick={() => setShowInput(true)} className="btn-primary h-9 px-3 text-[13px]">+ Feed / input</button>
      )}
      <p className="text-[12px] text-text-secondary">Feed, meds, fertilizer — optionally deduct from inventory stock.</p>
      {inputs.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No input usages yet.</p>
      ) : (
        <table className="w-full" style={{ minWidth: 680 }}>
          <thead>
            <tr className="border-b border-divider">
              <th className="data-th text-left">Date</th>
              <th className="data-th text-left">Type</th>
              <th className="data-th text-left">Product</th>
              <th className="data-th text-right">Qty</th>
              <th className="data-th text-left">Target</th>
              <th className="data-th text-left">Stock</th>
            </tr>
          </thead>
          <tbody>
            {inputs.map(u => (
              <tr key={u.id} className="border-b border-divider">
                <td className="data-td text-[13px]">{u.usage_date}</td>
                <td className="data-td text-[13px]">{INPUT_USAGE_LABELS[u.usage_type]}</td>
                <td className="data-td text-[13px]">{u.inventory_items?.name ?? u.product_label ?? '—'}</td>
                <td className="data-td text-[13px] text-right">{Number(u.quantity)} {u.unit}</td>
                <td className="data-td text-[12px] text-text-secondary">
                  {u.farm_livestock_groups?.name ?? u.farm_plantings?.name ?? '—'}
                </td>
                <td className="data-td text-[12px]">{u.deducted_from_stock ? 'Deducted' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showInput && (
        <Modal title="Feed / input usage" onClose={() => setShowInput(false)}>
          <label className="block text-[12px] text-text-secondary">Type
            <select value={iType} onChange={e => setIType(e.target.value as FarmInputUsageType)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              {(Object.keys(INPUT_USAGE_LABELS) as FarmInputUsageType[]).map(k => (
                <option key={k} value={k}>{INPUT_USAGE_LABELS[k]}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] text-text-secondary">Quantity
              <input type="number" min={0.001} step="any" value={iQty} onChange={e => setIQty(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
            </label>
            <label className="block text-[12px] text-text-secondary">Unit
              <select value={iUnit} onChange={e => setIUnit(e.target.value as FarmInputUnit)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                {INPUT_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-[12px] text-text-secondary">Date
            <input type="date" value={iDate} onChange={e => setIDate(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Product label
            <input value={iProduct} onChange={e => setIProduct(e.target.value)} placeholder="e.g. Broiler starter" className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          {inventoryItems.length > 0 && (
            <>
              <label className="block text-[12px] text-text-secondary">Inventory item (optional)
                <select value={iItem} onChange={e => setIItem(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
                  <option value="">— Log only —</option>
                  {inventoryItems.map(it => (
                    <option key={it.id} value={it.id}>{it.name} ({Number(it.quantity_on_hand ?? 0)} on hand)</option>
                  ))}
                </select>
              </label>
              {iItem && (
                <label className="flex items-center gap-2 text-[13px] text-text-primary">
                  <input type="checkbox" checked={iDeduct} onChange={e => setIDeduct(e.target.checked)} />
                  Deduct from inventory stock
                </label>
              )}
            </>
          )}
          <label className="block text-[12px] text-text-secondary">Livestock group
            <select value={iGroup} onChange={e => setIGroup(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">— None —</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">Planting
            <select value={iPlanting} onChange={e => setIPlanting(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background">
              <option value="">— None —</option>
              {plantings.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block text-[12px] text-text-secondary">Withdraw until (meds)
            <input type="date" value={iWithdraw} onChange={e => setIWithdraw(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <label className="block text-[12px] text-text-secondary">Notes
            <input value={iNotes} onChange={e => setINotes(e.target.value)} className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowInput(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
            <button type="button" disabled={busy} onClick={() => void saveInput()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">Save</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
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
