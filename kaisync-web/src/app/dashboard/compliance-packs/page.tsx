'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

// Real tables: contractor_compliance_packs + contractor_compliance_pack_items
// Items use text document_type (no UUID foreign key)
interface PackItem {
  document_type: string
  requirement: 'required' | 'recommended' | 'none'
}

interface CompliancePack {
  id: string
  company_id: string
  name: string
  description: string | null
  is_default: boolean
  items: PackItem[]
}

export default function CompliancePacksPage() {
  const [packs, setPacks] = useState<CompliancePack[]>([])
  const [allDocTypes, setAllDocTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editingPackId, setEditingPackId] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editItems, setEditItems] = useState<Record<string, 'required' | 'recommended' | 'none'>>({})
  const [newDocType, setNewDocType] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    const supabase = createClient()

    try {
      const member = await resolveCurrentMember(supabase)
      if (!member) { setError('not_linked'); setLoading(false); return }
      setCompanyId(member.companyId)

      const { data, error: qErr } = await supabase
        .from('contractor_compliance_packs')
        .select('id, company_id, name, description, is_default, items:contractor_compliance_pack_items(document_type, requirement)')
        .eq('company_id', member.companyId)
        .order('name')

      if (qErr) { setLoadError(true); setLoading(false); return }

      const loaded = (data ?? []) as CompliancePack[]
      setPacks(loaded)

      // Derive all known doc types from existing pack items
      const types = new Set<string>()
      for (const pack of loaded) {
        for (const item of (pack.items ?? [])) {
          if (item.document_type) types.add(item.document_type)
        }
      }
      setAllDocTypes([...types].sort())
    } catch {
      setLoadError(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function buildInitialItems(docTypes: string[], existingItems: PackItem[]) {
    const map: Record<string, 'required' | 'recommended' | 'none'> = {}
    for (const dt of docTypes) map[dt] = 'none'
    for (const item of existingItems) {
      if (item.document_type) map[item.document_type] = item.requirement
    }
    return map
  }

  function openCreate() {
    setEditingPackId(null)
    setEditName('')
    setEditDescription('')
    setEditItems(buildInitialItems(allDocTypes, []))
    setNewDocType('')
    setIsEditing(true)
  }

  function openEdit(pack: CompliancePack) {
    setEditingPackId(pack.id)
    setEditName(pack.name)
    setEditDescription(pack.description ?? '')
    setEditItems(buildInitialItems(allDocTypes, pack.items ?? []))
    setNewDocType('')
    setIsEditing(true)
  }

  function cancelEdit() { setIsEditing(false) }

  function addDocType() {
    const trimmed = newDocType.trim()
    if (!trimmed || editItems[trimmed] !== undefined) return
    setEditItems(prev => ({ ...prev, [trimmed]: 'none' }))
    if (!allDocTypes.includes(trimmed)) setAllDocTypes(prev => [...prev, trimmed].sort())
    setNewDocType('')
  }

  function toggleItem(dt: string, val: 'required' | 'recommended' | 'none') {
    setEditItems(prev => ({ ...prev, [dt]: val }))
  }

  async function savePack() {
    if (!editName.trim() || !companyId) return
    setIsBusy(true)
    const supabase = createClient()

    const itemsPayload = Object.entries(editItems)
      .filter(([, req]) => req !== 'none')
      .map(([document_type, requirement]) => ({ document_type, requirement }))

    const { error: rpcErr } = await supabase.rpc('hr_upsert_compliance_pack', {
      p_company_id: companyId,
      p_pack_id: editingPackId ?? null,
      p_name: editName.trim(),
      p_description: editDescription.trim() || null,
      p_items: itemsPayload,
    })
    if (rpcErr) console.error('upsert compliance pack:', rpcErr.message)

    setIsBusy(false)
    setIsEditing(false)
    load()
  }

  async function setDefault(packId: string) {
    if (!companyId) return
    const supabase = createClient()
    const { error: rpcErr } = await supabase.rpc('hr_set_default_compliance_pack', {
      p_company_id: companyId,
      p_pack_id: packId,
    })
    if (rpcErr) console.error('set default pack:', rpcErr.message)
    load()
  }

  async function deletePack(packId: string) {
    if (!window.confirm('Delete this compliance pack?')) return
    const supabase = createClient()
    await supabase.from('contractor_compliance_packs').delete().eq('id', packId)
    load()
  }

  const requiredCount = (pack: CompliancePack) =>
    (pack.items ?? []).filter(i => i.requirement === 'required').length
  const recommendedCount = (pack: CompliancePack) =>
    (pack.items ?? []).filter(i => i.requirement === 'recommended').length

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
      {/* Left panel */}
      <div className="flex flex-col border-r border-divider overflow-hidden">
        <div className="px-4 pt-4 pb-2 shrink-0">
          <p className="section-label">COMPLIANCE PACKS</p>
          <button onClick={openCreate} className="btn-primary w-full mt-2 h-9 text-[13px]">+ Create Pack</button>
        </div>

        {loadError && (
          <div className="mx-4 my-2 rounded-xl p-3 border" style={{ backgroundColor: '#FEE2E2', borderColor: '#EF4444' }}>
            <p className="text-error text-sm">Failed to load packs.</p>
            <button onClick={load} className="btn-outlined mt-2 h-8 px-3 text-[12px]">Retry</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {!loading && packs.length === 0 && !loadError && (
            <p className="text-text-secondary text-[13px] text-center py-6">No compliance packs yet. Create one above.</p>
          )}
          {packs.map(pack => (
            <div key={pack.id} className="card p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-text-primary truncate">{pack.name}</p>
                {pack.is_default && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0 font-medium" style={{ backgroundColor: '#14532D', color: '#22C55E' }}>
                    Default
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: '#7F1D1D', color: '#FCA5A5' }}>
                  {requiredCount(pack)} Required
                </span>
                {recommendedCount(pack) > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: '#292012', color: '#FCD34D' }}>
                    {recommendedCount(pack)} Recommended
                  </span>
                )}
              </div>
              <div className="flex gap-1.5">
                {!pack.is_default && (
                  <button onClick={() => setDefault(pack.id)}
                    className="h-[28px] px-2 rounded-md text-[10px]"
                    style={{ backgroundColor: '#1E293B', color: '#94A3B8' }}>
                    Set Default
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

      {/* Right panel */}
      <div className="overflow-hidden flex flex-col">
        {!isEditing ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary gap-2">
            <span className="material-icons text-[48px]">inbox</span>
            <p className="text-[15px] font-medium">Select a pack to edit</p>
            <p className="text-[12px]">or create a new pack using the button on the left.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <h2 className="text-[18px] font-semibold text-text-primary">
              {editingPackId ? 'Edit Compliance Pack' : 'Create Compliance Pack'}
            </h2>

            <div className="space-y-1">
              <label className="section-label">Pack Name *</label>
              <input value={editName} onChange={e => setEditName(e.target.value)}
                placeholder="e.g. Security Contractor" className="dark-entry w-full mt-1" />
            </div>

            <div className="space-y-1">
              <label className="section-label">Description</label>
              <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)}
                placeholder="Short description..."
                rows={2} className="dark-entry w-full mt-1 py-2 resize-none min-h-[60px]" />
            </div>

            <hr className="border-divider" />

            <div className="space-y-2">
              <p className="section-label">DOCUMENT REQUIREMENTS</p>
              <p className="text-xs text-text-secondary">
                Set each document type to Required, Recommended, or Exclude.
              </p>

              <div className="flex gap-2 mt-2">
                <input
                  value={newDocType}
                  onChange={e => setNewDocType(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDocType() } }}
                  placeholder="Add document type..."
                  className="dark-entry flex-1 text-[13px] h-9"
                />
                <button onClick={addDocType}
                  className="h-9 px-3 text-[12px] rounded-lg border border-primary text-primary hover:opacity-80 transition-opacity">
                  Add
                </button>
              </div>

              <div className="flex gap-2 mt-1">
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: '#7F1D1D', color: '#FCA5A5' }}>Required</span>
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: '#78350F', color: '#FCD34D' }}>Recommended</span>
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: '#1E293B', color: '#475569' }}>Exclude</span>
              </div>

              {Object.keys(editItems).length === 0 && (
                <p className="text-text-secondary text-[13px]">No document types yet -- add one above.</p>
              )}

              {Object.entries(editItems).map(([dt, current]) => (
                <div key={dt} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-1 py-1.5 border-b border-divider last:border-0">
                  <span className="text-sm text-text-primary">{dt}</span>
                  <button
                    onClick={() => toggleItem(dt, 'required')}
                    className="h-[28px] px-2.5 text-[10px] rounded-md transition-opacity"
                    style={{
                      backgroundColor: current === 'required' ? '#7F1D1D' : '#1E293B',
                      color: current === 'required' ? '#FCA5A5' : '#475569',
                      opacity: current === 'required' ? 1 : 0.7,
                    }}
                  >Required</button>
                  <button
                    onClick={() => toggleItem(dt, 'recommended')}
                    className="h-[28px] px-2.5 text-[10px] rounded-md transition-opacity"
                    style={{
                      backgroundColor: current === 'recommended' ? '#78350F' : '#1E293B',
                      color: current === 'recommended' ? '#FCD34D' : '#475569',
                      opacity: current === 'recommended' ? 1 : 0.7,
                    }}
                  >Recommend</button>
                  <button
                    onClick={() => toggleItem(dt, 'none')}
                    className="h-[28px] px-2.5 text-[10px] rounded-md transition-opacity"
                    style={{
                      backgroundColor: '#1E293B',
                      color: current === 'none' ? '#CBD5E1' : '#475569',
                      opacity: current === 'none' ? 1 : 0.7,
                    }}
                  >Exclude</button>
                </div>
              ))}
            </div>

            <hr className="border-divider" />

            <div className="flex justify-end gap-2.5 pb-4">
              <button onClick={cancelEdit} className="btn-outlined h-[42px] px-5 text-[13px]">Cancel</button>
              <button onClick={savePack} disabled={isBusy || !editName.trim()} className="btn-primary h-[42px] px-5 text-[13px] font-semibold">
                {isBusy ? 'Saving...' : 'Save Pack'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
