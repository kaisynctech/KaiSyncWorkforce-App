'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  CHANNEL_PROVIDERS,
  channelProviderLabel,
  createChannelConnection,
  deleteUnitChannelMapping,
  listChannelConnections,
  listUnitChannelMappings,
  upsertUnitChannelMapping,
} from '@/lib/property-channels'
import type {
  ChannelProvider,
  PropertyChannelConnection,
  PropertyUnitChannelMapping,
  Unit,
} from '@/types/database'

type Props = {
  companyId: string
  siteId: string
  employeeId: string | null
  canEdit: boolean
  units: Unit[]
}

export function ChannelSyncPanel({ companyId, siteId, employeeId, canEdit, units }: Props) {
  const [connections, setConnections] = useState<PropertyChannelConnection[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [mappings, setMappings] = useState<PropertyUnitChannelMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<ChannelProvider>('ical')
  const [icalUrl, setIcalUrl] = useState('')
  const [externalPropId, setExternalPropId] = useState('')

  const [mapUnitId, setMapUnitId] = useState('')
  const [mapExternalId, setMapExternalId] = useState('')
  const [mapExternalName, setMapExternalName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const res = await listChannelConnections(supabase, { companyId, siteId })
    if (!res.ok) {
      setError(res.message)
      setConnections([])
      setLoading(false)
      return
    }
    setConnections(res.data)
    setSelectedId(prev => {
      if (prev && res.data.some(c => c.id === prev)) return prev
      return res.data[0]?.id ?? ''
    })
    setLoading(false)
  }, [companyId, siteId])

  useEffect(() => { void load() }, [load])

  const loadMappings = useCallback(async (connectionId: string) => {
    if (!connectionId) { setMappings([]); return }
    const supabase = createClient()
    const res = await listUnitChannelMappings(supabase, { companyId, connectionId })
    if (!res.ok) {
      setError(res.message)
      setMappings([])
      return
    }
    setMappings(res.data)
  }, [companyId])

  useEffect(() => { void loadMappings(selectedId) }, [selectedId, loadMappings])

  const selected = connections.find(c => c.id === selectedId) ?? null

  async function createConnection() {
    if (!canEdit || !name.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const res = await createChannelConnection(supabase, {
      companyId,
      siteId,
      employeeId,
      provider,
      displayName: name.trim(),
      icalImportUrl: provider === 'ical' ? icalUrl : null,
      externalPropertyId: externalPropId || null,
    })
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setShowCreate(false)
    setName('')
    setIcalUrl('')
    setExternalPropId('')
    await load()
    setSelectedId(res.data.id)
  }

  async function saveMapping() {
    if (!canEdit || !selectedId || !mapUnitId || !mapExternalId.trim()) return
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const res = await upsertUnitChannelMapping(supabase, {
      companyId,
      connectionId: selectedId,
      unitId: mapUnitId,
      externalRoomId: mapExternalId,
      externalRoomName: mapExternalName || null,
    })
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setMapUnitId('')
    setMapExternalId('')
    setMapExternalName('')
    await loadMappings(selectedId)
  }

  async function removeMapping(id: string) {
    if (!canEdit) return
    setBusy(true)
    const supabase = createClient()
    const res = await deleteUnitChannelMapping(supabase, { companyId, mappingId: id })
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    await loadMappings(selectedId)
  }

  return (
    <div className="border border-divider rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-semibold text-text-primary">Channel sync foundations</h3>
          <p className="text-[11px] text-text-secondary mt-0.5">
            Prepare connections and room mappings for iCal / channel managers.
            Live pull from OTAs is not enabled yet — this stores the wiring only.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setShowCreate(true)} className="btn-outlined h-9 px-3 text-[12px]">
            + Connection
          </button>
        )}
      </div>

      {error && <p className="text-[12px] text-error">{error}</p>}

      {loading ? (
        <p className="text-[12px] text-text-secondary">Loading…</p>
      ) : connections.length === 0 ? (
        <p className="text-[12px] text-text-secondary">
          No channel connections yet. Add an iCal or channel-manager connection when you are ready to sync.
        </p>
      ) : (
        <>
          <label className="block text-[12px] text-text-secondary">
            Active connection
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
            >
              {connections.map(c => (
                <option key={c.id} value={c.id}>
                  {c.display_name} · {channelProviderLabel(c.provider)}
                  {!c.is_active ? ' (inactive)' : ''}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <div className="rounded-lg bg-surface-elevated border border-divider px-3 py-2 text-[11px] text-text-secondary space-y-0.5">
              <p>Provider: {channelProviderLabel(selected.provider)} · Sync: {selected.sync_status}</p>
              {selected.ical_import_url && (
                <p className="truncate">iCal URL saved (import will use this in a later wave)</p>
              )}
              {selected.external_property_id && (
                <p>External property id: {selected.external_property_id}</p>
              )}
              <p>
                Credentials: {selected.credentials_configured ? 'configured (vault)' : 'not stored in DB (by design)'}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[12px] font-medium text-text-primary">Room mappings</p>
            {mappings.length === 0 ? (
              <p className="text-[12px] text-text-secondary">No rooms mapped for this connection.</p>
            ) : (
              <table className="w-full" style={{ minWidth: 480 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">KaiSync room</th>
                    <th className="data-th text-left">External room id</th>
                    <th className="data-th text-left">External name</th>
                    <th className="data-th text-left" />
                  </tr>
                </thead>
                <tbody>
                  {mappings.map(m => (
                    <tr key={m.id} className="border-b border-divider">
                      <td className="data-td text-[12px]">{m.units?.unit_number ?? m.unit_id.slice(0, 8)}</td>
                      <td className="data-td text-[12px] font-mono">{m.external_room_id}</td>
                      <td className="data-td text-[12px] text-text-secondary">{m.external_room_name ?? '—'}</td>
                      <td className="data-td text-right">
                        {canEdit && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void removeMapping(m.id)}
                            className="text-[11px] text-error hover:underline disabled:opacity-40"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {canEdit && selectedId && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                <label className="block text-[11px] text-text-secondary">
                  Room
                  <select
                    value={mapUnitId}
                    onChange={e => setMapUnitId(e.target.value)}
                    className="mt-1 w-full h-9 px-2 border border-border rounded-md text-[12px] bg-background"
                  >
                    <option value="">Select…</option>
                    {units.map(u => (
                      <option key={u.id} value={u.id}>{u.unit_number}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px] text-text-secondary">
                  External room id
                  <input
                    value={mapExternalId}
                    onChange={e => setMapExternalId(e.target.value)}
                    placeholder="e.g. ROOM-101"
                    className="mt-1 w-full h-9 px-2 border border-border rounded-md text-[12px] bg-background"
                  />
                </label>
                <label className="block text-[11px] text-text-secondary">
                  External name
                  <input
                    value={mapExternalName}
                    onChange={e => setMapExternalName(e.target.value)}
                    placeholder="Optional"
                    className="mt-1 w-full h-9 px-2 border border-border rounded-md text-[12px] bg-background"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !mapUnitId || !mapExternalId.trim()}
                  onClick={() => void saveMapping()}
                  className="btn-outlined h-9 px-3 text-[12px] disabled:opacity-50"
                >
                  Save mapping
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="text-[15px] font-semibold text-text-primary">New channel connection</h3>
            <label className="block text-[12px] text-text-secondary">
              Name *
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Airbnb iCal · Main house"
                className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
              />
            </label>
            <label className="block text-[12px] text-text-secondary">
              Provider
              <select
                value={provider}
                onChange={e => setProvider(e.target.value as ChannelProvider)}
                className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
              >
                {CHANNEL_PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </label>
            {provider === 'ical' && (
              <label className="block text-[12px] text-text-secondary">
                iCal import URL (saved for later sync)
                <input
                  value={icalUrl}
                  onChange={e => setIcalUrl(e.target.value)}
                  placeholder="https://…"
                  className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
                />
              </label>
            )}
            {(provider === 'channex' || provider === 'siteminder' || provider === 'cloudbeds' || provider === 'other') && (
              <label className="block text-[12px] text-text-secondary">
                External property id
                <input
                  value={externalPropId}
                  onChange={e => setExternalPropId(e.target.value)}
                  className="mt-1 w-full h-10 px-3 border border-border rounded-md text-[13px] bg-background"
                />
              </label>
            )}
            <p className="text-[11px] text-text-disabled">
              API keys are not stored on this form — credentials will use a secure vault when live sync is enabled.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-outlined h-9 px-3 text-[13px]">Cancel</button>
              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={() => void createConnection()}
                className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
