'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { UNITS_OF_MEASURE } from '@/lib/units'
import CatalogueSearchModal, { type CatalogueSearchResult } from '@/components/quotes/CatalogueSearchModal'
import type { ItemType } from '@/types/inventory'
import type { RequestLine } from '@/types/quotes'

// ─── Constants ─────────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  part:     'bg-blue-50 text-blue-600',
  service:  'bg-purple-50 text-purple-600',
  material: 'bg-green-50 text-green-600',
  labour:   'bg-amber-50 text-amber-600',
}

const TYPE_LABELS: Record<string, string> = {
  part: 'Part', service: 'Service', material: 'Material', labour: 'Labour',
}

// Unit select — grouped from UNITS_OF_MEASURE
const UNIT_GROUPS = (() => {
  const map = new Map<string, { value: string; label: string }[]>()
  for (const u of UNITS_OF_MEASURE) {
    if (!map.has(u.group)) map.set(u.group, [])
    map.get(u.group)!.push({ value: u.value, label: u.label })
  }
  return Array.from(map.entries())
})()

type CatalogueStatus = 'found' | 'not_found' | null

// ─── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  companyId: string
  lines: RequestLine[]
  onChange: (lines: RequestLine[]) => void
  onProcess: () => Promise<void>
  processing: boolean
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function RequestTab({ companyId, lines, onChange, onProcess, processing }: Props) {
  const supabase = createClient()

  // ── Entry row state ──────────────────────────────────────────────────────────
  const [newType,    setNewType]    = useState<ItemType>('part')
  const [newCode,    setNewCode]    = useState('')
  const [newName,    setNewName]    = useState('')
  const [newQty,     setNewQty]     = useState('1')
  const [newUnit,    setNewUnit]    = useState('each')

  // Catalogue check (entry row only)
  const [catalogueStatus, setCatalogueStatus] = useState<CatalogueStatus>(null)

  // Per-line catalogue status (set when check ran during entry)
  const [lineStatus, setLineStatus] = useState<Record<string, CatalogueStatus>>({})

  // Catalogue search modal
  const [showCatalogueSearch, setShowCatalogueSearch] = useState(false)

  // Validation shake state
  const [errorField, setErrorField] = useState<string | null>(null)

  // Refs for focus management
  const codeInputRef = useRef<HTMLInputElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const qtyInputRef  = useRef<HTMLInputElement | null>(null)

  // Debounce ref for catalogue check
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Type change handler ──────────────────────────────────────────────────────
  function handleTypeChange(type: string) {
    setNewType(type as ItemType)
    setNewCode('')
    setCatalogueStatus(null)
    if (type === 'service')       setNewUnit('job')
    else if (type === 'labour')   setNewUnit('hour')
    else                          setNewUnit('each')
    setTimeout(() => {
      if (type === 'part' || type === 'material') codeInputRef.current?.focus()
      else                                        nameInputRef.current?.focus()
    }, 0)
  }

  // ── Catalogue check (debounced, non-blocking) ────────────────────────────────
  function triggerCatalogueCheck(code: string) {
    if (checkTimer.current) clearTimeout(checkTimer.current)
    if (!code || code.length < 2) { setCatalogueStatus(null); return }
    if (newType !== 'part' && newType !== 'material') return

    checkTimer.current = setTimeout(async () => {
      const { data } = await supabase
        .from('quote_catalogue_items')
        .select('id, name')
        .eq('company_id', companyId)
        .or(`sku.ilike.${code}%,code.ilike.${code}%,name.ilike.${code}%`)
        .eq('is_active', true)
        .limit(1)
      if (data && data.length > 0) {
        setCatalogueStatus('found')
        if (!newName && data[0].name) setNewName(data[0].name)
      } else {
        setCatalogueStatus('not_found')
      }
    }, 400)
  }

  // ── Validation shake ─────────────────────────────────────────────────────────
  function focusWithShake(ref: React.RefObject<HTMLInputElement | null>, fieldId: string) {
    ref.current?.focus()
    setErrorField(fieldId)
    setTimeout(() => setErrorField(null), 600)
  }

  // ── Add line ─────────────────────────────────────────────────────────────────
  function addLine() {
    const code = newCode.trim()
    const name = newName.trim()

    if (newType === 'part' || newType === 'material') {
      if (!code && !name) { focusWithShake(codeInputRef, 'code'); return }
    } else {
      if (!name) { focusWithShake(nameInputRef, 'name'); return }
    }

    const qty = parseFloat(newQty)
    if (!qty || qty <= 0) { focusWithShake(qtyInputRef, 'qty'); return }

    const tempId = crypto.randomUUID()
    const line: RequestLine = {
      tempId,
      catalogue_item_id: null,
      variant_id:        null,
      item_name:         name || code,
      item_sku:          code || null,
      item_type:         newType,
      qty,
      unit_of_measure:   newUnit,
      service_delivery:  null,
      notes:             null,
      cost_price:        0,
      unit_sell_price:   0,
    }

    // Carry catalogue status to the line
    if (catalogueStatus !== null) {
      setLineStatus(prev => ({ ...prev, [tempId]: catalogueStatus }))
    }

    onChange([...lines, line])

    // Reset entry row — keep type for rapid same-type entry
    setNewCode('')
    setNewName('')
    setNewQty('1')
    setCatalogueStatus(null)

    setTimeout(() => {
      if (newType === 'part' || newType === 'material') codeInputRef.current?.focus()
      else                                              nameInputRef.current?.focus()
    }, 0)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); addLine() }
  }

  // ── Catalogue-select handler ──────────────────────────────────────────────────
  function handleCatalogueSelect(result: CatalogueSearchResult) {
    const line: RequestLine = {
      tempId:            crypto.randomUUID(),
      catalogue_item_id: result.id,
      variant_id:        result.variant_id,
      item_name:         result.name,
      item_sku:          result.sku,
      item_type:         result.item_type,
      qty:               1,
      unit_of_measure:   result.unit_of_measure,
      service_delivery:  null,
      notes:             null,
      cost_price:        0,
      unit_sell_price:   0,
    }
    onChange([...lines, line])
    // Modal stays open — user can keep picking more items
  }

  // ── Line mutations ────────────────────────────────────────────────────────────
  function updateLine(tempId: string, patch: Partial<RequestLine>) {
    onChange(lines.map(l => l.tempId === tempId ? { ...l, ...patch } : l))
  }

  function removeLine(tempId: string) {
    onChange(lines.filter(l => l.tempId !== tempId))
    setLineStatus(prev => { const next = { ...prev }; delete next[tempId]; return next })
  }

  function comingSoon() {
    alert('Coming soon — document upload and AI extraction in Phase 2.')
  }

  const hasCode = newType === 'part' || newType === 'material'

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">

      {/* ── Action bar ── */}
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <button
          type="button"
          onClick={comingSoon}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-divider text-[12px] text-text-secondary hover:bg-surface-elevated transition-colors"
        >
          <span className="material-icons text-[15px]">upload_file</span>
          Upload PO / PDF
        </button>
        <button
          type="button"
          onClick={comingSoon}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-divider text-[12px] text-text-secondary hover:bg-surface-elevated transition-colors"
        >
          <span className="material-icons text-[15px]">image</span>
          Upload image
        </button>
        <span className="text-[11px] text-text-secondary italic px-1.5 py-0.5 rounded-full bg-surface-elevated">
          AI extraction — Phase 2
        </span>
      </div>

      {/* ── Lines table (always rendered) ── */}
      <div className="flex-1 min-h-0 border border-divider rounded-t-xl overflow-hidden flex flex-col">
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-divider bg-surface-elevated text-text-secondary text-left">
                <th className="px-3 py-2.5 font-medium w-8">#</th>
                <th className="px-3 py-2.5 font-medium w-20">Type</th>
                <th className="px-3 py-2.5 font-medium w-28">Code</th>
                <th className="px-3 py-2.5 font-medium">Name / description</th>
                <th className="px-3 py-2.5 font-medium text-right w-20">Qty</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-text-secondary">
                    <p className="text-[13px] font-medium mb-1">Add items below</p>
                    <p className="text-[12px]">
                      Enter part numbers, services, materials, or labour that your customer is requesting
                    </p>
                  </td>
                </tr>
              ) : (
                lines.map((line, idx) => {
                  const showCode = line.item_type === 'part' || line.item_type === 'material'
                  return (
                    <tr key={line.tempId} className="border-b border-divider last:border-0 hover:bg-surface-elevated group">
                      <td className="px-3 py-2 text-text-secondary text-center">{idx + 1}</td>
                      <td className="px-3 py-2">
                        {line.item_type ? (
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', TYPE_COLOURS[line.item_type])}>
                            {TYPE_LABELS[line.item_type]}
                          </span>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-text-secondary font-mono">
                        {showCode && line.item_sku ? (
                          <span>{line.item_sku}</span>
                        ) : (
                          <span className="text-text-secondary">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          value={line.item_name}
                          onChange={e => updateLine(line.tempId, { item_name: e.target.value })}
                          className="w-full h-7 rounded border border-transparent bg-transparent px-1 text-[12px] text-text-primary focus:border-divider focus:bg-surface focus:outline-none transition-colors"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={line.qty}
                          onChange={e => updateLine(line.tempId, { qty: parseFloat(e.target.value) || 1 })}
                          className="w-full h-7 rounded border border-transparent bg-transparent px-1 text-[12px] text-text-primary focus:border-divider focus:bg-surface focus:outline-none text-right transition-colors"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(line.tempId)}
                          className="text-text-secondary hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <span className="material-icons text-[16px]">close</span>
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Entry row (fixed at bottom of table area) ── */}
        <div className="flex gap-2 items-center px-3 py-2.5 border-t border-divider bg-surface flex-wrap shrink-0">

          {/* Type selector */}
          <select
            value={newType}
            onChange={e => handleTypeChange(e.target.value)}
            className="h-8 w-28 shrink-0 rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary transition-colors"
          >
            <option value="part">Part</option>
            <option value="service">Service</option>
            <option value="material">Material</option>
            <option value="labour">Labour</option>
          </select>

          {/* Code field — part + material only */}
          {hasCode && (
            <div className="relative w-44 shrink-0">
              <input
                ref={codeInputRef}
                type="text"
                placeholder="Part number / SKU"
                value={newCode}
                onChange={e => { setNewCode(e.target.value); triggerCatalogueCheck(e.target.value) }}
                onKeyDown={handleKeyDown}
                className={cn(
                  'h-8 w-full rounded-md border bg-surface pl-2.5 pr-20 text-[12px] text-text-primary focus:outline-none focus:border-primary transition-colors',
                  errorField === 'code' ? 'border-red-400 bg-red-50' : 'border-divider',
                )}
              />
              {catalogueStatus === 'found' && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-green-600 font-medium whitespace-nowrap">
                  ✓ in catalogue
                </span>
              )}
              {catalogueStatus === 'not_found' && newCode.length > 2 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary whitespace-nowrap">
                  not found
                </span>
              )}
            </div>
          )}

          {/* Description — always shown */}
          <input
            ref={nameInputRef}
            type="text"
            placeholder={
              hasCode
                ? 'Name / description (optional)'
                : newType === 'service'
                ? 'Service description *'
                : 'Labour description *'
            }
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              'h-8 flex-1 min-w-[160px] rounded-md border bg-surface px-2.5 text-[12px] text-text-primary focus:outline-none focus:border-primary transition-colors',
              errorField === 'name' ? 'border-red-400 bg-red-50' : 'border-divider',
            )}
          />

          {/* Qty */}
          <input
            ref={qtyInputRef}
            type="number"
            placeholder="Qty"
            min={0.001}
            step="any"
            value={newQty}
            onChange={e => setNewQty(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              'h-8 w-16 shrink-0 rounded-md border bg-surface px-2 text-[12px] text-text-primary text-right focus:outline-none focus:border-primary transition-colors',
              errorField === 'qty' ? 'border-red-400 bg-red-50' : 'border-divider',
            )}
          />

          {/* Unit */}
          <select
            value={newUnit}
            onChange={e => setNewUnit(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 w-28 shrink-0 rounded-md border border-divider bg-surface px-2 text-[12px] text-text-primary focus:outline-none focus:border-primary transition-colors"
          >
            {UNIT_GROUPS.map(([group, units]) => (
              <optgroup key={group} label={group}>
                {units.map(u => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Add line button */}
          <button
            type="button"
            onClick={addLine}
            className="h-8 px-3 shrink-0 rounded-md bg-primary text-white text-[12px] font-medium hover:bg-primary/90 transition-colors flex items-center gap-1"
          >
            <span className="material-icons text-[15px]">add</span>
            Add line
          </button>

          {/* From catalogue button */}
          <button
            type="button"
            onClick={() => setShowCatalogueSearch(true)}
            title="Search your inventory"
            className="h-8 px-3 shrink-0 rounded-md border border-divider text-[12px] text-text-secondary font-medium hover:bg-surface-elevated hover:border-primary/30 hover:text-primary transition-colors flex items-center gap-1"
          >
            <span className="material-icons text-[15px]">search</span>
            From catalogue
          </button>
        </div>
      </div>

      {/* ── Footer — Process items ── */}
      <div className="flex items-center justify-end pt-3 shrink-0">
        <button
          type="button"
          onClick={() => void onProcess()}
          disabled={lines.length === 0 || processing}
          className="flex items-center gap-2 h-9 px-6 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {processing ? 'Processing…' : 'Process items'}
          {!processing && <span className="material-icons text-[16px]">arrow_forward</span>}
        </button>
      </div>

      {/* ── Catalogue search modal ── */}
      {showCatalogueSearch && (
        <CatalogueSearchModal
          companyId={companyId}
          onSelect={handleCatalogueSelect}
          onClose={() => setShowCatalogueSearch(false)}
        />
      )}

    </div>
  )
}
