'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { MONEY_TH, MONEY_TD } from '@/components/ui/StatusFilterTabs'
import { ResetFiltersButton, TextHeaderFilter, matchText } from '@/components/ui/MoneyListFilters'
import { ResponsiveDataView, DataCard, DataCardTitle, DataCardMeta } from '@/components/ui/ResponsiveDataView'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { useEmployeeModuleGate } from '@/lib/employee-module-gate'

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
  const allowed = useEmployeeModuleGate('paperless')
  const [templates, setTemplates] = useState<FormTemplate[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (allowed !== true) return
    void init()
  }, [allowed])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    try {
      const token = member.sessionToken
        ?? (await supabase.auth.getSession()).data.session?.access_token
        ?? null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)

      const [tmplRes, subRes] = await Promise.all([
        rpc('employee_get_workflow_form_templates', {
          p_company_id: member.companyId,
          p_employee_id: member.employeeId,
          p_session_token: token,
        }),
        rpc('employee_get_workflow_form_submissions', {
          p_company_id: member.companyId,
          p_employee_id: member.employeeId,
          p_session_token: token,
        }),
      ])

      if (tmplRes.error) throw tmplRes.error
      setTemplates((tmplRes.data as FormTemplate[]) ?? [])
      const subs = ((subRes.data as Submission[]) ?? [])
        .slice()
        .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
        .slice(0, 20)
      setSubmissions(subs)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load forms.')
    }
    setLoading(false)
  }

  const templateMap = Object.fromEntries(templates.map(t => [t.id, t.name]))

  const [formFilter, setFormFilter] = useState('')
  const [subFilter, setSubFilter] = useState('')

  const filteredTemplates = useMemo(
    () => templates.filter(t => matchText(t.name, formFilter)),
    [templates, formFilter],
  )
  const filteredSubmissions = useMemo(
    () => submissions.filter(s => matchText(templateMap[s.template_id] ?? 'Form', subFilter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [submissions, templates, subFilter],
  )
  const hasFilters = formFilter !== '' || subFilter !== ''
  function resetFilters() { setFormFilter(''); setSubFilter('') }

  function fmtSubmitted(iso: string): string {
    return new Date(iso).toLocaleString('en-ZA', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  if (allowed === null || (allowed && loading)) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
    )
  }
  if (allowed === false) return null

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

        <div className="flex items-center gap-2">
          <ResetFiltersButton disabled={!hasFilters} onReset={resetFilters} />
        </div>

        <div>
          <p className="section-label mb-3">Available Forms</p>
          {templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-text-secondary">
              <span className="material-icons text-[48px] text-text-disabled">description</span>
              <p className="text-[14px]">No forms available.</p>
            </div>
          ) : (
            <div className="bg-surface border border-divider rounded-xl">
              {filteredTemplates.length === 0 ? (
                <p className="text-center text-[13px] text-text-secondary py-8">No forms match the current filter.</p>
              ) : (
                <ResponsiveDataView
                  className="md:min-h-[220px]"
                  table={
                    <table className="w-full" style={{ minWidth: 560 }}>
                      <thead>
                        <tr className="bg-surface-elevated border-b border-divider">
                          <th className={`${MONEY_TH} text-left`}>
                            <TextHeaderFilter label="Form" value={formFilter} onChange={setFormFilter} placeholder="Form name…" />
                          </th>
                          <th className={`${MONEY_TH} text-left`}>Description</th>
                          <th className={`${MONEY_TH} text-right`} />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-divider">
                        {filteredTemplates.map(t => (
                          <tr key={t.id} className="hover:bg-surface-elevated transition-colors">
                            <td className={`${MONEY_TD} font-semibold text-text-primary`}>{t.name}</td>
                            <td className={`${MONEY_TD} text-text-secondary`}>{t.description ?? '—'}</td>
                            <td className={`${MONEY_TD} text-right whitespace-nowrap`}>
                              <Link
                                href={`/dashboard/employee/forms/${t.id}`}
                                className="bg-primary text-white text-[12px] font-semibold px-3 py-1 rounded-md hover:bg-primary-dark transition-colors"
                              >
                                Fill Form
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  }
                  mobile={filteredTemplates.map(t => (
                    <DataCard key={t.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <DataCardTitle className="whitespace-normal">{t.name}</DataCardTitle>
                          {t.description && <DataCardMeta>{t.description}</DataCardMeta>}
                        </div>
                        <Link
                          href={`/dashboard/employee/forms/${t.id}`}
                          className="bg-primary text-white text-[12px] font-semibold px-3 py-1.5 rounded-md hover:bg-primary-dark transition-colors shrink-0"
                        >
                          Fill Form
                        </Link>
                      </div>
                    </DataCard>
                  ))}
                />
              )}
            </div>
          )}
        </div>

        {submissions.length > 0 && (
          <div>
            <p className="section-label mb-3">Recent Submissions</p>
            <div className="bg-surface border border-divider rounded-xl">
              {filteredSubmissions.length === 0 ? (
                <p className="text-center text-[13px] text-text-secondary py-8">No submissions match the current filter.</p>
              ) : (
                <ResponsiveDataView
                  className="md:min-h-[220px]"
                  table={
                    <table className="w-full" style={{ minWidth: 480 }}>
                      <thead>
                        <tr className="bg-surface-elevated border-b border-divider">
                          <th className={`${MONEY_TH} text-left`}>
                            <TextHeaderFilter label="Form" value={subFilter} onChange={setSubFilter} placeholder="Form name…" />
                          </th>
                          <th className={`${MONEY_TH} text-left`}>Submitted</th>
                          <th className={`${MONEY_TH} text-left`}>Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-divider">
                        {filteredSubmissions.map(s => (
                          <tr key={s.id} className="hover:bg-surface-elevated transition-colors">
                            <td className={`${MONEY_TD} font-semibold text-text-primary`}>
                              {templateMap[s.template_id] ?? 'Form'}
                            </td>
                            <td className={`${MONEY_TD} text-text-secondary whitespace-nowrap`}>{fmtSubmitted(s.submitted_at)}</td>
                            <td className={MONEY_TD}>
                              <span className="text-[11px] font-semibold px-2 py-[2px] rounded-full bg-success/10 text-success">
                                Submitted
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  }
                  mobile={filteredSubmissions.map(s => (
                    <DataCard key={s.id}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <DataCardTitle>{templateMap[s.template_id] ?? 'Form'}</DataCardTitle>
                          <p className="text-[11px] text-text-disabled mt-0.5">{fmtSubmitted(s.submitted_at)}</p>
                        </div>
                        <span className="text-[11px] font-semibold px-2 py-[2px] rounded-full bg-success/10 text-success">
                          Submitted
                        </span>
                      </div>
                    </DataCard>
                  ))}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
