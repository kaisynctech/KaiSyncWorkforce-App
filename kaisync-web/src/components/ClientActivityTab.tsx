'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type AppEvent = {
  id: number | string
  created_at: string
  action: string
  screen: string
  level: string
  auth_user_id?: string | null
  meta: Record<string, unknown> | null
}

type Filter = 'all' | 'profile' | 'portal' | 'sites'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'profile', label: 'Profile' },
  { key: 'portal', label: 'Portal' },
  { key: 'sites', label: 'Sites' },
]

function eventLabel(action: string): string {
  const map: Record<string, string> = {
    client_created: 'Client Created',
    client_profile_updated: 'Profile Updated',
    client_portal_enabled: 'Portal Enabled',
    client_portal_disabled: 'Portal Disabled',
    client_site_added: 'Site Added',
  }
  if (map[action]) return map[action]
  const s = action.replace(/^client_/, '').replace(/_/g, ' ')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : action
}

function badgeColors(action: string): { bg: string; fg: string } {
  if (action.includes('enabled') || action === 'client_created')
    return { bg: '#14532D', fg: '#22C55E' }
  if (action.includes('disabled'))
    return { bg: '#7F1D1D', fg: '#FCA5A5' }
  if (action.includes('site'))
    return { bg: '#1E3A5F', fg: '#60A5FA' }
  if (action.includes('profile'))
    return { bg: '#292012', fg: '#FCD34D' }
  return { bg: '#1E293B', fg: '#94A3B8' }
}

function mStr(meta: Record<string, unknown> | null, key: string): string {
  if (!meta) return ''
  const v = meta[key]
  return v == null ? '' : String(v)
}

function trunc(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

function formatFieldChanges(meta: Record<string, unknown> | null): string {
  const raw = meta?.field_changes
  if (!Array.isArray(raw) || raw.length === 0) return ''
  const changes = raw
    .map(item => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const label = String(row.label ?? '')
      if (!label) return null
      return { label, from: String(row.from ?? ''), to: String(row.to ?? '') }
    })
    .filter((c): c is { label: string; from: string; to: string } => c != null)

  if (changes.length === 0) return ''
  if (changes.length > 2) {
    return `${changes.map(c => c.label).join(', ')} updated`
  }
  return changes.map(c => {
    const from = trunc(c.from, 28)
    const to = trunc(c.to, 28)
    if (!from && to) return `${c.label} set to ${to}`
    if (from && !to) return `${c.label} cleared`
    if (!from && !to) return `${c.label} updated`
    return `${c.label}: ${from} → ${to}`
  }).join('  ·  ')
}

function description(action: string, meta: Record<string, unknown> | null): string {
  const fieldChanges = formatFieldChanges(meta)
  if (action === 'client_profile_updated' && fieldChanges) return fieldChanges

  if (action === 'client_created') return mStr(meta, 'name')
  if (action === 'client_site_added') {
    const site = mStr(meta, 'site_name') || mStr(meta, 'name')
    return site ? `Site: ${site}` : ''
  }
  return mStr(meta, 'description') || mStr(meta, 'name') || ''
}

function category(action: string): Exclude<Filter, 'all'> | 'other' {
  if (action.includes('portal')) return 'portal'
  if (action.includes('site')) return 'sites'
  if (action.includes('profile') || action === 'client_created') return 'profile'
  return 'other'
}

function roleFromScreen(screen: string): string {
  if (screen === 'ClientPortal') return 'Client'
  if (screen.toLowerCase().includes('hr')) return 'HR'
  return 'System'
}

function actorDisplay(
  screen: string,
  meta: Record<string, unknown> | null,
  authNameByUserId: Map<string, string>,
  authUserId?: string | null,
): string {
  const named =
    mStr(meta, 'actor_name') ||
    mStr(meta, 'employee_name') ||
    mStr(meta, 'user_name') ||
    mStr(meta, 'changed_by_name')
  if (named) return named

  if (authUserId) {
    const fromAuth = authNameByUserId.get(authUserId)
    if (fromAuth) return fromAuth
  }

  if (screen === 'ClientPortal') {
    return mStr(meta, 'client_name') || 'Client'
  }
  return roleFromScreen(screen)
}

function source(screen: string): string {
  if (screen === 'ClientPortal') return 'Portal'
  if (screen.toLowerCase().includes('hr')) return 'HR Portal'
  return screen || 'System'
}

export function ClientActivityTab({
  companyId,
  clientId,
}: {
  companyId: string
  clientId: string
}) {
  const [events, setEvents] = useState<AppEvent[]>([])
  const [actorNames, setActorNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: rpcErr } = await (supabase.rpc as any)('get_client_activity_feed', {
      p_company_id: companyId,
      p_client_id: clientId,
      p_limit: 200,
    })
    if (rpcErr) setError(rpcErr.message)
    const rows = (data ?? []) as AppEvent[]
    setEvents(rows)

    const authIds = [...new Set(
      rows.map(e => e.auth_user_id).filter((id): id is string => Boolean(id)),
    )]
    if (authIds.length > 0) {
      const { data: emps } = await supabase
        .from('employees')
        .select('user_id, name, surname')
        .eq('company_id', companyId)
        .in('user_id', authIds)
      const map = new Map<string, string>()
      for (const e of emps ?? []) {
        const uid = (e as { user_id?: string | null }).user_id
        if (!uid) continue
        const name = `${(e as { name?: string }).name ?? ''} ${(e as { surname?: string }).surname ?? ''}`.trim()
        if (name) map.set(uid, name)
      }
      setActorNames(map)
    } else {
      setActorNames(new Map())
    }

    setLoading(false)
  }, [companyId, clientId])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    return events.filter(e => {
      if (filter === 'all') return true
      if (filter === 'portal') return e.screen === 'ClientPortal' || category(e.action) === 'portal'
      return category(e.action) === filter
    })
  }, [events, filter])

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`h-8 px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
                filter === f.key ? 'bg-primary text-white' : 'bg-surface border border-border text-text-secondary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button onClick={load} className="text-[12px] text-primary hover:opacity-70">Refresh</button>
      </div>

      {error && <p className="text-[13px] text-error">{error}</p>}
      {loading ? (
        <p className="text-[13px] text-text-secondary py-8 text-center">Loading activity…</p>
      ) : filtered.length === 0 ? (
        <p className="text-[13px] text-text-secondary py-8 text-center">No activity yet.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => {
            const colors = badgeColors(e.action)
            const desc = description(e.action, e.meta)
            const who = actorDisplay(e.screen, e.meta, actorNames, e.auth_user_id)
            return (
              <div key={String(e.id)} className="card p-3 flex gap-3 items-start">
                <span
                  className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: colors.bg, color: colors.fg }}
                >
                  {eventLabel(e.action)}
                </span>
                <div className="min-w-0 flex-1">
                  {desc && <p className="text-[13px] text-text-primary">{desc}</p>}
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    {new Date(e.created_at).toLocaleString('en-ZA')} · {who} · {source(e.screen)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
