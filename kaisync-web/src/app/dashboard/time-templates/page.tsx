'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { ShiftTemplate } from '@/types/database'

export default function TimeTemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    // employee_shift_templates is the UUID-based table used by hr_ RPCs
    const { data } = await supabase
      .from('employee_shift_templates')
      .select('*')
      .eq('company_id', member.companyId)
      .order('name')

    setTemplates((data ?? []) as ShiftTemplate[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function setDefault(id: string) {
    if (!companyId) return
    const supabase = createClient()
    const { error: rpcErr } = await supabase.rpc('hr_set_default_shift_template', {
      p_company_id: companyId,
      p_template_id: id,
    })
    if (rpcErr) console.error('set default template:', rpcErr.message)
    load()
  }

  async function deleteTemplate(id: string) {
    if (!window.confirm('Delete this template?')) return
    const supabase = createClient()
    await supabase.from('employee_shift_templates').delete().eq('id', id)
    setTemplates(prev => prev.filter(t => t.id !== id))
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
          <p className="text-text-secondary text-[13px] text-center py-8">Loading...</p>
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
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text-primary flex-1">{t.name}</span>
                {t.is_default && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: '#DCFCE7', color: '#166534' }}>
                    Default
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {!t.is_default && (
                  <button onClick={() => setDefault(t.id)}
                    className="h-[30px] px-3 text-sm rounded-md bg-surface-dark text-text-secondary hover:text-text-primary transition-colors">
                    Default
                  </button>
                )}
                <button onClick={() => router.push('/dashboard/time-templates/' + t.id + '/edit')}
                  className="text-primary text-sm px-2 hover:opacity-70 transition-opacity">
                  Edit
                </button>
                <button onClick={() => deleteTemplate(t.id)}
                  className="h-[30px] px-3 text-sm rounded-md"
                  style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                  Delete
                </button>
              </div>
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
