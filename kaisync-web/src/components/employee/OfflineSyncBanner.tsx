'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { flushEmployeeOffline } from '@/lib/offline/flush'
import {
  formatLastSynced,
  getLastSyncedAt,
  getOfflinePendingCounts,
  onOfflineChanged,
  type OfflinePendingCounts,
} from '@/lib/offline/meta'

export function OfflineSyncBanner() {
  const [counts, setCounts] = useState<OfflinePendingCounts>({
    punches: 0,
    incidents: 0,
    jobActions: 0,
    total: 0,
  })
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    setCounts(await getOfflinePendingCounts())
    setLastSynced(await getLastSyncedAt())
  }, [])

  useEffect(() => {
    void refresh()
    return onOfflineChanged(() => { void refresh() })
  }, [refresh])

  useEffect(() => {
    const run = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) return
      const tok = member.sessionToken
        ?? (await supabase.auth.getSession()).data.session?.access_token
        ?? null
      const pending = await getOfflinePendingCounts()
      // Always refresh pack when coming online; also flush queues.
      setBusy(true)
      const result = await flushEmployeeOffline(supabase, {
        companyId: member.companyId,
        employeeId: member.employeeId,
        sessionToken: tok,
        refreshPack: true,
      })
      setBusy(false)
      if (!result.ok && result.message) setMessage(result.message)
      else setMessage(null)
      await refresh()
      if (pending.total === 0 && !result.packUpdated && result.ok) {
        /* quiet */
      }
    }
    const onOnline = () => { void run() }
    window.addEventListener('online', onOnline)
    // First mount: pull pack if online so jobs are ready before they leave signal.
    void run()
    return () => window.removeEventListener('online', onOnline)
  }, [refresh])

  async function syncNow() {
    setBusy(true)
    setMessage(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) {
      setBusy(false)
      setMessage('Sign in again to sync.')
      return
    }
    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    const result = await flushEmployeeOffline(supabase, {
      companyId: member.companyId,
      employeeId: member.employeeId,
      sessionToken: tok,
      refreshPack: true,
    })
    setBusy(false)
    if (!result.ok) setMessage(result.message)
    else if (result.message) setMessage(result.message)
    else setMessage(result.flushed > 0 ? `Synced ${result.flushed} item(s).` : 'Jobs pack updated.')
    await refresh()
  }

  const parts: string[] = []
  if (counts.punches) parts.push(`${counts.punches} punch${counts.punches === 1 ? '' : 'es'}`)
  if (counts.incidents) parts.push(`${counts.incidents} incident${counts.incidents === 1 ? '' : 's'}`)
  if (counts.jobActions) parts.push(`${counts.jobActions} job update${counts.jobActions === 1 ? '' : 's'}`)

  if (counts.total === 0 && online && !message) {
    return (
      <div className="px-4 py-1.5 border-b border-divider bg-surface text-[11px] text-text-secondary flex items-center justify-between gap-2">
        <span>Last synced {formatLastSynced(lastSynced)}</span>
        <button type="button" disabled={busy} onClick={() => void syncNow()} className="text-primary hover:underline disabled:opacity-50">
          {busy ? 'Syncing…' : 'Sync jobs'}
        </button>
      </div>
    )
  }

  return (
    <div className={`px-4 py-2 border-b ${!online || counts.total > 0 ? 'bg-warning/10 border-warning/30' : 'bg-surface border-divider'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {!online ? (
            <p className="text-[12px] font-semibold text-warning">Offline — clock, jobs, and incidents save on this device</p>
          ) : counts.total > 0 ? (
            <p className="text-[12px] font-semibold text-warning">
              {parts.join(' · ')} waiting to upload
            </p>
          ) : (
            <p className="text-[12px] font-semibold text-text-primary">Synced</p>
          )}
          <p className="text-[11px] text-text-secondary">Last synced {formatLastSynced(lastSynced)}</p>
          {message && <p className="text-[11px] text-error mt-0.5">{message}</p>}
        </div>
        <button
          type="button"
          disabled={busy || !online}
          onClick={() => void syncNow()}
          className="shrink-0 text-[12px] font-semibold text-primary border border-primary/40 px-3 py-1.5 rounded-lg disabled:opacity-50"
        >
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    </div>
  )
}
