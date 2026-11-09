'use client'

import { useCallback, useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { ShiftTemplate } from '@/types/database'
import { templateHoursSummary } from '@/lib/shift-template-schedule'
import { StatusFilterTabs, TAB_ALL, MONEY_TH, MONEY_TD } from '@/components/ui/StatusFilterTabs'
import {
  ResetFiltersButton,
  TextHeaderFilter,
  matchText,
  statusTab,
} from '@/components/ui/MoneyListFilters'

const DEFAULT_TABS = [
  statusTab('default', 'Default', ['default'], 'green'),
  statusTab('other', 'Other', ['other'], 'slate'),
  TAB_ALL,
]

export default function TimeTemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [nameCol, setNameCol] = useState('')
  const [defaultFilter, setDefaultFilter] = useState<'default' | 'other' | ''>('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const { data, error: loadErr } = await supabase
      .from('employee_shift_templates')
      .select('*')
      .eq('company_id', member.companyId)
      .order('name')

    if (loadErr) {
      setError(loadErr.message)
      setTemplates([])
    } else {
      setTemplates((data ?? []) as ShiftTemplate[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function setDefault(id: string) {
    if (!companyId) return
    setError(null)
    setBusyId(id)
    const supabase = createClient()
    const { error: rpcErr } = await supabase.rpc('hr_set_default_shift_template', {
      p_company_id: companyId,
      p_template_id: id,
    })
    setBusyId(null)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    await load()
  }

  async function deleteTemplate(id: string) {
    if (!companyId || !window.confirm('Delete this template?')) return
    setError(null)
    setBusyId(id)
    const supabase = createClient()
    const { error: rpcErr } = await supabase.rpc('hr_delete_shift_template', {
      p_id: id,
      p_company_id: companyId,
    })
    setBusyId(null)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    setTemplates(prev => prev.filter(t => t.id !== id))
  }

  const filtered = useMemo(() => {
    return templates.filter(t => {
      if (defaultFilter === 'default' && !t.is_default) return false
      if (defaultFilter === 'other' && t.is_default) return false
      if (!matchText(t.name, search) && !matchText(templateHoursSummary(t), search)) return false
      if (!matchText(t.name, nameCol)) return false
      return true
    })
  }, [templates, defaultFilter, search, nameCol])

  const filtersActive = !!(search || nameCol || defaultFilter)

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
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Time Templates</h1>
          <p className="text-[13px] text-text-secondary mt-0.5">{templates.length} total</p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/dashboard/time-templates/new')}
          className="flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark transition-colors"
        >
          <span className="material-icons text-[18px]">add</span>
          Add Template
        </button>
      </div>

      {error && error !== 'not_linked' && (
        <p className="mb-3 text-error text-[13px]">{error}</p>
      )}

      {!loading && templates.length > 0 && !templates.some(t => t.is_default) && (
        <p className="mb-3 text-[13px] text-text-primary rounded-md border border-warning/30 bg-warning-dark/20 px-3 py-2">
          Choose a company default. Payroll uses it for anyone who does not have their own template.
        </p>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-[180px]">
          <span className="material-icons text-text-disabled text-[16px]">search</span>
          <input
            type="search"
            placeholder="Search templates…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
          />
        </div>
        <ResetFiltersButton
          disabled={!filtersActive}
          onReset={() => { setSearch(''); setNameCol(''); setDefaultFilter('') }}
        />
        <StatusFilterTabs
          tabs={DEFAULT_TABS}
          value={defaultFilter || 'all'}
          counts={{
            all: templates.length,
            default: templates.filter(t => t.is_default).length,
            other: templates.filter(t => !t.is_default).length,
          }}
          onChange={id => setDefaultFilter(id === 'all' ? '' : id as 'default' | 'other')}
        />
      </div>

      <div className="bg-surface rounded-lg border border-divider overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 640 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter
                    label="Name"
                    value={nameCol}
                    onChange={setNameCol}
                    placeholder="Template name…"
                  />
                </th>
                <th className={`${MONEY_TH} text-left`}>Hours</th>
                <th style={{ width: 90 }} className={`${MONEY_TH} text-left`}>Default</th>
                <th style={{ width: 220 }} className={`${MONEY_TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-[12px] text-text-disabled">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center">
                    <span className="material-icons text-[40px] text-text-disabled block mb-2">access_time</span>
                    <p className="text-[13px] text-text-secondary">
                      {templates.length === 0 ? 'No templates yet.' : 'No templates match your filters.'}
                    </p>
                    {templates.length === 0 && (
                      <button
                        type="button"
                        onClick={() => router.push('/dashboard/time-templates/new')}
                        className="mt-2 text-primary text-[12px] hover:underline"
                      >
                        + Add your first template
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map(t => (
                  <tr key={t.id} className="border-b border-divider last:border-0 hover:bg-background">
                    <td className={`${MONEY_TD} font-medium text-text-primary`}>{t.name}</td>
                    <td className={`${MONEY_TD} text-text-secondary`}>
                      {(t.start_time || t.end_time) ? templateHoursSummary(t) : '—'}
                    </td>
                    <td className={MONEY_TD}>
                      {t.is_default ? (
                        <span className="flex items-center gap-1 text-[11px] font-medium text-success w-fit">
                          <span className="w-1.5 h-1.5 rounded-full bg-success" />
                          Default
                        </span>
                      ) : (
                        <span className="text-[11px] text-text-disabled">—</span>
                      )}
                    </td>
                    <td className={`${MONEY_TD} text-right`}>
                      <div className="inline-flex gap-1.5">
                        {!t.is_default && (
                          <button
                            type="button"
                            disabled={busyId === t.id}
                            onClick={() => void setDefault(t.id)}
                            className="h-7 px-2 rounded-md text-[11px] font-medium text-text-secondary hover:text-primary hover:bg-surface-elevated disabled:opacity-50"
                          >
                            {busyId === t.id ? '…' : 'Set default'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => router.push(`/dashboard/time-templates/${t.id}/edit`)}
                          className="h-7 px-2 rounded-md text-[11px] font-medium text-primary hover:bg-primary/10"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busyId === t.id}
                          onClick={() => void deleteTemplate(t.id)}
                          className="h-7 px-2 rounded-md text-[11px] font-medium bg-error-dark text-error hover:bg-red-100 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
