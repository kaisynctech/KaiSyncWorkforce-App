'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchPlatformAudit } from '@/lib/platform-api'

type AuditRow = {
  id: string
  action: string
  target_type: string | null
  target_id: string | null
  company_id: string | null
  created_at: string
  detail_json: Record<string, unknown> | null
}

export default function PlatformAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const data = await fetchPlatformAudit(supabase, 50)
    setRows(data as AuditRow[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0">
        <p className="text-[13px] text-text-secondary">Last 50 platform audit events</p>
        <button onClick={load} className="text-[13px] text-primary">Refresh</button>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-[13px] text-text-secondary py-10">No audit events</p>
        ) : (
          <div className="divide-y divide-divider">
            {rows.map(r => (
              <div key={r.id} className="px-4 py-3 flex justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-text-primary">{r.action}</p>
                  <p className="text-[12px] text-text-secondary">
                    {r.target_type ?? '—'}
                    {r.target_id ? ` · ${String(r.target_id).slice(0, 8)}` : ''}
                    {r.detail_json?.status != null ? ` · status=${String(r.detail_json.status)}` : ''}
                  </p>
                </div>
                <p className="text-[12px] text-text-secondary shrink-0">
                  {r.created_at?.slice(0, 19).replace('T', ' ')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
