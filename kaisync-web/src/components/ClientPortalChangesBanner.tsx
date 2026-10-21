'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Change = { label: string; from: string; to: string }
type Item = { at: string; changes: Change[] }

const DAYS = 60

function parseChanges(meta: unknown): Change[] {
  const raw = (meta as { field_changes?: unknown } | null)?.field_changes
  if (!Array.isArray(raw)) return []
  return raw
    .map(r => r as Record<string, unknown>)
    .filter(r => r && r.label)
    .map(r => ({ label: String(r.label), from: String(r.from ?? ''), to: String(r.to ?? '') }))
}

/**
 * On the HR client record: "This client changed their details" with old → new, for
 * changes the client made in the portal in the last 60 days. Full history is on Activity.
 */
export function ClientPortalChangesBanner({
  companyId,
  clientId,
  onOpenActivity,
}: {
  companyId: string
  clientId: string
  onOpenActivity: () => void
}) {
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase.rpc as any)('get_client_activity_feed', { p_company_id: companyId, p_client_id: clientId, p_limit: 50 })
      .then(({ data }: { data: { action: string; screen: string; created_at: string; meta: unknown }[] | null }) => {
        if (cancelled || !data) return
        const since = Date.now() - DAYS * 86400000
        setItems(
          data
            .filter(e => e.action === 'client_profile_updated' && e.screen === 'ClientPortal' && new Date(e.created_at).getTime() >= since)
            .slice(0, 3)
            .map(e => ({ at: e.created_at, changes: parseChanges(e.meta) }))
            .filter(i => i.changes.length > 0),
        )
      })
    return () => { cancelled = true }
  }, [companyId, clientId])

  if (items.length === 0) return null

  return (
    <div className="card p-4 space-y-2 border border-warning/40">
      <div className="flex items-center justify-between gap-2">
        <p className="section-label">CLIENT UPDATED THEIR DETAILS (PORTAL)</p>
        <button type="button" onClick={onOpenActivity} className="text-[12px] text-primary hover:underline">Full history</button>
      </div>
      {items.map((it, idx) => (
        <div key={idx} className="text-[12px] space-y-0.5">
          <p className="text-text-secondary">
            {new Date(it.at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
          {it.changes.map((c, j) => (
            <p key={j} className="text-text-primary">
              <span className="font-semibold">{c.label}:</span>{' '}
              <span className="text-text-secondary line-through">{c.from || '(empty)'}</span>{' → '}
              <span>{c.to || '(empty)'}</span>
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}
