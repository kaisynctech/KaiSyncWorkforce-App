'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { ShiftTemplate } from '@/types/database'

export default function TimeTemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: me } = await supabase.from('employees').select('company_id').eq('user_id', user.id).maybeSingle()
    if (!me) { setLoading(false); return }

    const { data } = await supabase
      .from('shift_templates')
      .select('*, breaks:shift_template_breaks(*)')
      .eq('company_id', me.company_id)
      .order('name')

    setTemplates((data ?? []) as ShiftTemplate[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function setDefault(id: string) {
    const supabase = createClient()
    try { await supabase.rpc('set_default_shift_template', { template_id: id }) } catch {}
    load()
  }

  async function deleteTemplate(id: string) {
    if (!window.confirm('Delete this template?')) return
    const supabase = createClient()
    await supabase.from('shift_templates').delete().eq('id', id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[20px] font-semibold text-text-primary">Time Templates</h1>
        <button onClick={() => router.push('/dashboard/time-templates/new')} className="btn-primary h-9 px-3 text-[13px]">
          + Add Template
        </button>
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-2">
            <span className="material-icons text-[48px] text-text-disabled">access_time</span>
            <p className="text-text-secondary text-[14px]">No templates yet.</p>
            <button onClick={() => router.push('/dashboard/time-templates/new')} className="btn-primary h-9 px-4 text-[13px] mt-2">
              + Add Template
            </button>
          </div>
        ) : (
          templates.map(t => (
            <div key={t.id} className="card p-4 space-y-2">
              {/* Row 1: name + default badge */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text-primary flex-1">{t.name}</span>
                {t.is_default && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#DCFCE7', color: '#166534' }}>
                    Default
                  </span>
                )}
              </div>
              {/* Row 2: actions */}
              <div className="flex gap-2">
                {!t.is_default && (
                  <button onClick={() => setDefault(t.id)}
                    className="h-[30px] px-3 text-sm rounded-md bg-surface-dark text-text-secondary hover:text-text-primary transition-colors">
                    Default
                  </button>
                )}
                <button onClick={() => router.push(`/dashboard/time-templates/${t.id}/edit`)}
                  className="text-primary text-sm px-2 hover:opacity-70 transition-opacity">
                  Edit
                </button>
                <button onClick={() => deleteTemplate(t.id)}
                  className="h-[30px] px-3 text-sm rounded-md"
                  style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                  Delete
                </button>
              </div>
              {/* Row 3: summary */}
              {t.summary && (
                <p className="text-xs text-text-secondary">{t.summary}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
