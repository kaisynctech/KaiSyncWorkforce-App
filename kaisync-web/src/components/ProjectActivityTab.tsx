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

type DealUpdate = {
  id: string
  created_at: string
  body: string
  status_from: string | null
  status_to: string | null
}

type TimelineEntry = {
  key: string
  created_at: string
  kind: 'event' | 'update'
  action: string
  desc: string
  who: string
  source: string
}

type Filter = 'all' | 'pipeline' | 'quotation' | 'payments' | 'documents'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'quotation', label: 'Quotation' },
  { key: 'payments', label: 'Payments' },
  { key: 'documents', label: 'Documents' },
]

function eventLabel(action: string): string {
  const map: Record<string, string> = {
    project_created: 'Project Created',
    project_updated: 'Project Updated',
    quotation_sent: 'Quotation Sent',
    payment_recorded: 'Payment Recorded',
    payment_deleted: 'Payment Deleted',
    document_uploaded: 'Document Uploaded',
    document_deleted: 'Document Deleted',
    stage_changed: 'Stage Changed',
    project_note: 'Note Added',
  }
  if (map[action]) return map[action]
  const s = action.replace(/^project_/, '').replace(/_/g, ' ')
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : action
}

function badgeColors(action: string): { bg: string; fg: string } {
  if (action === 'project_created' || action === 'quotation_sent')
    return { bg: '#14532D', fg: '#22C55E' }
  if (action.includes('deleted'))
    return { bg: '#7F1D1D', fg: '#FCA5A5' }
  if (action.includes('payment'))
    return { bg: '#292012', fg: '#FCD34D' }
  if (action.includes('stage') || action.includes('status'))
    return { bg: '#1E3A5F', fg: '#60A5FA' }
  return { bg: '#1E293B', fg: '#94A3B8' }
}

function mStr(meta: Record<string, unknown> | null, key: string): string {
  if (!meta) return ''
  const v = meta[key]
  return v == null ? '' : String(v)
}

function category(action: string): Exclude<Filter, 'all'> | 'other' {
  if (action.includes('quotation')) return 'quotation'
  if (action.includes('payment')) return 'payments'
  if (action.includes('document')) return 'documents'
  if (action.includes('stage') || action.includes('status') || action === 'project_created') return 'pipeline'
  return 'other'
}

function description(action: string, meta: Record<string, unknown> | null): string {
  if (action === 'project_created') return mStr(meta, 'title')
  if (action === 'quotation_sent') return mStr(meta, 'summary') || 'Quotation sent to client'
  if (action === 'payment_recorded' || action === 'payment_deleted') {
    const amount = mStr(meta, 'amount')
    return amount ? `Amount: R ${amount}` : ''
  }
  if (action === 'document_uploaded' || action === 'document_deleted') {
    return mStr(meta, 'document_name')
  }
  if (action === 'project_updated') {
    const fields = meta?.field_changes
    if (Array.isArray(fields) && fields.length > 0) {
      return fields.map(f => (f as { label?: string }).label).filter(Boolean).join(', ') + ' updated'
    }
  }
  return mStr(meta, 'description') || ''
}

function roleFromScreen(screen: string): string {
  if (screen === 'ClientPortal') return 'Client'
  if (screen.toLowerCase().includes('hr')) return 'HR'
  return 'System'
}

export function ProjectActivityTab({
  companyId,
  projectId,
}: {
  companyId: string
  projectId: string
}) {
  const [events, setEvents] = useState<AppEvent[]>([])
  const [updates, setUpdates] = useState<DealUpdate[]>([])
  const [actorNames, setActorNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [feedRes, updatesRes] = await Promise.all([
      (supabase.rpc as any)('get_project_activity_feed', {
        p_company_id: companyId,
        p_project_id: projectId,
        p_limit: 200,
      }),
      supabase
        .from('client_deal_updates')
        .select('id, created_at, body, status_from, status_to')
        .eq('deal_id', projectId)
        .order('created_at', { ascending: false }),
    ])

    if (feedRes.error) setError(feedRes.error.message)
    const rows = (feedRes.data ?? []) as AppEvent[]
    setEvents(rows)
    setUpdates((updatesRes.data ?? []) as DealUpdate[])

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
  }, [companyId, projectId])

  useEffect(() => { void load() }, [load])

  const timeline: TimelineEntry[] = useMemo(() => {
    const fromEvents: TimelineEntry[] = events.map(e => ({
      key: `event-${e.id}`,
      created_at: e.created_at,
      kind: 'event',
      action: e.action,
      desc: description(e.action, e.meta),
      who: mStr(e.meta, 'actor_name') || (e.auth_user_id ? actorNames.get(e.auth_user_id) ?? roleFromScreen(e.screen) : roleFromScreen(e.screen)),
      source: e.screen === 'ClientPortal' ? 'Portal' : 'HR Portal',
    }))
    const fromUpdates: TimelineEntry[] = updates.map(u => ({
      key: `update-${u.id}`,
      created_at: u.created_at,
      kind: 'update',
      action: u.status_to ? 'stage_changed' : 'project_note',
      desc: u.status_from && u.status_to
        ? `${u.body} (${u.status_from.replace(/_/g, ' ')} → ${u.status_to.replace(/_/g, ' ')})`
        : u.body,
      who: 'HR',
      source: 'HR Portal',
    }))
    return [...fromEvents, ...fromUpdates].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [events, updates, actorNames])

  const filtered = useMemo(() => {
    return timeline.filter(e => {
      if (filter === 'all') return true
      return category(e.action) === filter
    })
  }, [timeline, filter])

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
        <button onClick={() => void load()} className="text-[12px] text-primary hover:opacity-70">Refresh</button>
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
            return (
              <div key={e.key} className="card p-3 flex gap-3 items-start">
                <span
                  className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: colors.bg, color: colors.fg }}
                >
                  {eventLabel(e.action)}
                </span>
                <div className="min-w-0 flex-1">
                  {e.desc && <p className="text-[13px] text-text-primary whitespace-pre-wrap">{e.desc}</p>}
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    {new Date(e.created_at).toLocaleString('en-ZA')} · {e.who} · {e.source}
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
