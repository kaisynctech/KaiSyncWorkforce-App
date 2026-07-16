'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface FormTemplate {
  id: string
  name: string
  description: string | null
  created_at: string
}

interface Submission {
  id: string
  template_id: string
  submitted_at: string
}

export default function FormsPage() {
  const [templates,   setTemplates]   = useState<FormTemplate[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = supabase.rpc as any

      const [tmplRes, subRes] = await Promise.all([
        rpc('employee_get_workflow_form_templates', {
          p_company_id:    member.companyId,
          p_employee_id:   member.employeeId,
          p_session_token: token,
        }),
        rpc('employee_get_workflow_form_submissions', {
          p_company_id:    member.companyId,
          p_employee_id:   member.employeeId,
          p_session_token: token,
        }),
      ])

      if (tmplRes.error) throw tmplRes.error
      setTemplates((tmplRes.data as FormTemplate[]) ?? [])
      setSubmissions((subRes.data as Submission[]) ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load forms.')
    }
    setLoading(false)
  }

  const templateMap = Object.fromEntries(templates.map(t => [t.id, t.name]))

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <h1 className="text-[18px] font-semibold text-text-primary">Forms</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error font-semibold">{error}</p>
          </div>
        )}

        {/* Available Forms */}
        <div>
          <p className="section-label mb-3">Available Forms</p>
          {templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-secondary">
              <span className="material-icons text-[48px] text-text-disabled">description</span>
              <p className="text-[14px]">No forms available.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map(t => (
                <div key={t.id} className="bg-surface border border-divider rounded-xl p-4 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-text-primary">{t.name}</p>
                    {t.description && (
                      <p className="text-[12px] text-text-secondary mt-0.5">{t.description}</p>
                    )}
                  </div>
                  <Link href={`/dashboard/employee/forms/${t.id}`}
                    className="bg-primary text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors shrink-0">
                    Fill Form
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Submissions */}
        {submissions.length > 0 && (
          <div>
            <p className="section-label mb-3">Recent Submissions</p>
            <div className="bg-surface border border-divider rounded-xl overflow-hidden divide-y divide-divider">
              {submissions.map(s => (
                <div key={s.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold text-text-primary">{templateMap[s.template_id] ?? 'Unknown Form'}</p>
                    <p className="text-[11px] text-text-disabled mt-0.5">
                      {new Date(s.submitted_at).toLocaleString('en-ZA', {
                        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-[2px] rounded-full bg-success/10 text-success">Submitted</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
