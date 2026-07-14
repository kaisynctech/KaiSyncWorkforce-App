'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { CompliancePack, CompliancePackItem } from '@/types/database'

interface DocType { id: string; name: string }

export default function CompliancePacksPage() {
  const [packs, setPacks] = useState<CompliancePack[]>([])
  const [docTypes, setDocTypes] = useState<DocType[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editingPackId, setEditingPackId] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editIsDefault, setEditIsDefault] = useState(false)
  const [editItems, setEditItems] = useState<Record<string, 'required' | 'recommended' | 'none'>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const supabase = createClient()

    try {
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('not_linked'); setLoading(false); return }

      const [packsRes, dtRes] = await Promise.all([
        supabase.from('compliance_packs')
          .select('*, items:compliance_pack_items(doc_type_id, requirement, doc_type:document_types(name))')
          .eq('company_id', member.companyId)
          .order('name'),
        supabase.from('document_types').select('id, name').eq('company_id', member.companyId).order('name'),
      ])

      if (packsRes.error) { setLoadError(true); setLoading(false); return }
      setPacks((packsRes.data ?? []) as CompliancePack[])
      setDocTypes((dtRes.data ?? []) as DocType[])
    } catch {
      setLoadError(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openCreate() {
    setEditingPackId(null)
    setEditName('')
    setEditDescription('')
    setEditIsDefault(false)
    const initial: Record<string, 'required' | 'recommended' | 'none'> = {}
    docTypes.forEach(dt => { initial[dt.id] = 'none' })
    setEditItems(initial)
    setIsEditing(true)
  }

  function openEdit(pack: CompliancePack) {
    setEditingPackId(pack.id)
    setEditName(pack.name)
    setEditDescription(pack.description ?? '')
    setEditIsDefault(pack.is_default)
    const initial: Record<string, 'required' | 'recommended' | 'none'> = {}
    docTypes.forEach(dt => { initial[dt.id] = 'none' })
    ;(pack.items ?? []).forEach(item => { initial[item.doc_type_id] = item.requirement })
    setEditItems(initial)
    setIsEditing(true)
  }

  function cancelEdit() { setIsEditing(false) }

  async function savePack() {
    if (!editName.trim()) return
    setIsBusy(true)
    const supabase = createClient()
    const itemsPayload = Object.entries(editItems).map(([doc_type_id, requirement]) => ({ doc_type_id, requirement }))
    try {
      await supabase.rpc('upsert_compliance_pack', {
        pack: { id: editingPackId, name: editName.trim(), description: editDescription.trim() || null, is_default: editIsDefault },
        items: itemsPayload,
      })
    } catch {}
    setIsBusy(false)
    setIsEditing(false)
    load()
  }

  async function setDefault(packId: string) {
    const supabase = createClient()
    try { await supabase.rpc('set_default_compliance_pack', { pack_id: packId }) } catch {}
    load()
  }

  async function deletePack(packId: string) {
    if (!window.confirm('Delete this compliance pack?')) return
    const supabase = createClient()
    await supabase.from('compliance_packs').delete().eq('id', packId)
    load()
  }

  function toggleItem(dtId: string, val: 'required' | 'recommended' | 'none') {
    setEditItems(prev => ({ ...prev, [dtId]: val }))
  }

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  return (
    <div className="grid grid-cols-[300px_1fr] gap-0 h-full overflow-hidden">
      {/* ── Left panel ── */}
      <div className="flex flex-col border-r border-divider overflow-hidden">
        <div className="px-4 pt-4 pb-2 shrink-0">
          <p className="section-label">COMPLIANCE PACKS</p>
          <button onClick={openCreate} className="btn-primary w-full mt-2 h-9 text-[13px]">+ Create Pack</button>
        </div>

        {/* Error state */}
        {loadError && (
          <div className="mx-4 my-2 rounded-xl p-3 border" style={{ backgroundColor: '#FEE2E2', borderColor: '#EF4444' }}>
            <p className="text-error text-sm">Failed to load packs.</p>
            <button onClick={load} className="btn-outlined mt-2 h-8 px-3 text-[12px]">Retry</button>
          </div>
        )}

        {/* Pack list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {!loading && packs.length === 0 && !loadError && (
            <p className="text-text-secondary text-[13px] text-center py-6">No compliance packs yet. Create one above.</p>
          )}
          {packs.map(pack => (
            <div key={pack.id} className="card p-3 space-y-1.5">
              {/* Row 1: name + default badge */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-text-primary truncate">{pack.name}</p>
                {pack.is_default && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0 font-medium" style={{ backgroundColor: '#14532D', color: '#22C55E' }}>
                    ★ Default
                  </span>
                )}
              </div>
              {/* Row 2: counts */}
              <div className="flex gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: '#7F1D1D', color: '#FCA5A5' }}>
                  {pack.required_count ?? 0} Required
                </span>
                {(pack.recommended_count ?? 0) > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: '#292012', color: '#FCD34D' }}>
                    {pack.recommended_count} Recommended
                  </span>
                )}
              </div>
              {/* Row 3: actions */}
              <div className="flex gap-1.5">
                {!pack.is_default && (
                  <button onClick={() => setDefault(pack.id)}
                    className="h-[28px] px-2 rounded-md text-[10px]"
                    style={{ backgroundColor: '#1E293B', color: '#94A3B8' }}>
                    ★ Set Default
                  </button>
                )}
                <button onClick={() => openEdit(pack)}
                  className="h-[28px] px-2 rounded-md text-[10px] text-white"
                  style={{ backgroundColor: '#3B82F6' }}>
                  Edit
                </button>
                <button onClick={() => deletePack(pack.id)}
                  className="h-[28px] px-2 rounded-md text-[10px] text-error bg-transparent">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="overflow-hidden flex flex-col">
        {!isEditing ? (
          /* Idle state */
          <div className="flex flex-col items-center justify-center h-full text-text-secondary gap-2">
            <span className="material-icons text-[48px]">inbox</span>
            <p className="text-[15px] font-medium">Select a pack to edit</p>
            <p className="text-[12px]">or create a new pack using the button on the left.</p>
          </div>
        ) : (
          /* Edit / create form */
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <h2 className="text-[18px] font-semibold text-text-primary">
              {editingPackId ? 'Edit Compliance Pack' : 'Create Compliance Pack'}
            </h2>

            {/* Pack name */}
            <div className="space-y-1">
              <label className="section-label">Pack Name *</label>
              <input value={editName} onChange={e => setEditName(e.target.value)}
                placeholder="e.g. Security Contractor" className="dark-entry w-full mt-1" />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="section-label">Description</label>
              <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)}
                placeholder="Short description of when to use this pack…"
                rows={2} className="dark-entry w-full mt-1 py-2 resize-none min-h-[60px]" />
            </div>

            {/* Default toggle */}
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div>
                <p className="text-sm text-text-primary">Set as Company Default</p>
                <p className="text-xs text-text-secondary">Auto-assigned to new contractors when no pack is selected.</p>
              </div>
              <button
                role="switch"
                aria-checked={editIsDefault}
                onClick={() => setEditIsDefault(v => !v)}
                className="relative w-[44px] h-[26px] rounded-full transition-colors shrink-0"
                style={{ backgroundColor: editIsDefault ? '#3B82F6' : 'var(--color-border)' }}
              >
                <span
                  className="absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white transition-transform"
                  style={{ transform: editIsDefault ? 'translateX(18px)' : 'translateX(0)' }}
                />
              </button>
            </div>

            <hr className="border-divider" />

            {/* Document requirements */}
            <div className="space-y-2">
              <p className="section-label">DOCUMENT REQUIREMENTS</p>
              <p className="text-xs text-text-secondary">
                Set each document type to Required (counts toward score), Recommended (advisory), or Exclude (not shown).
              </p>
              {/* Legend */}
              <div className="flex gap-2 mt-1">
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: '#7F1D1D', color: '#FCA5A5' }}>Required</span>
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: '#78350F', color: '#FCD34D' }}>Recommended</span>
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: '#1E293B', color: '#475569' }}>Exclude</span>
              </div>

              {docTypes.length === 0 && (
                <p className="text-text-secondary text-[13px]">No document types configured.</p>
              )}

              {docTypes.map(dt => {
                const current = editItems[dt.id] ?? 'none'
                return (
                  <div key={dt.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 py-1.5 border-b border-divider last:border-0">
                    <span className="text-sm text-text-primary">{dt.name}</span>
                    <button
                      onClick={() => toggleItem(dt.id, 'required')}
                      className="h-[28px] px-2.5 text-[10px] rounded-md transition-opacity"
                      style={{
                        backgroundColor: current === 'required' ? '#7F1D1D' : '#1E293B',
                        color: current === 'required' ? '#FCA5A5' : '#475569',
                        opacity: current === 'required' ? 1 : 0.7,
                      }}
                    >
                      Required
                    </button>
                    <button
                      onClick={() => toggleItem(dt.id, 'recommended')}
                      className="h-[28px] px-2.5 text-[10px] rounded-md transition-opacity"
                      style={{
                        backgroundColor: current === 'recommended' ? '#78350F' : '#1E293B',
                        color: current === 'recommended' ? '#FCD34D' : '#475569',
                        opacity: current === 'recommended' ? 1 : 0.7,
                      }}
                    >
                      Recommend
                    </button>
                    <button
                      onClick={() => toggleItem(dt.id, 'none')}
                      className="h-[28px] px-2.5 text-[10px] rounded-md transition-opacity"
                      style={{
                        backgroundColor: '#1E293B',
                        color: current === 'none' ? '#CBD5E1' : '#475569',
                        opacity: current === 'none' ? 1 : 0.7,
                      }}
                    >
                      Exclude
                    </button>
                  </div>
                )
              })}
            </div>

            <hr className="border-divider" />

            {/* Save/Cancel */}
            <div className="flex justify-end gap-2.5 pb-4">
              <button onClick={cancelEdit} className="btn-outlined h-[42px] px-5 text-[13px]">Cancel</button>
              <button onClick={savePack} disabled={isBusy || !editName.trim()} className="btn-primary h-[42px] px-5 text-[13px] font-semibold">
                {isBusy ? 'Saving…' : 'Save Pack'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
