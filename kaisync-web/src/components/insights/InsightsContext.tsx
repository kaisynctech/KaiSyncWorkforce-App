'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { useDashboardCompany } from '@/components/DashboardCompanyContext'
import { describeRange, presetRange, rangeProblem, type DateRange, type PresetKey } from '@/lib/insights/period'

export type Exporter = {
  csv?: () => void | Promise<void>
  pdf?: () => void | Promise<void>
}

type Filters = { preset: PresetKey; range: DateRange; branch: string; department: string }

type Ctx = {
  companyId: string | null
  companyName: string
  companyCode: string | null
  filters: Filters
  setPreset: (k: Exclude<PresetKey, 'custom'>) => void
  setCustom: (r: DateRange) => void
  setBranch: (b: string) => void
  setDepartment: (d: string) => void
  /** Pages with people in them (People, Payroll, registers) switch the site and department filters on. */
  orgFilters: boolean
  setOrgFilters: (on: boolean) => void
  options: { branches: string[]; departments: string[] }
  setOptions: (o: { branches: string[]; departments: string[] }) => void
  exporter: Exporter | null
  setExporter: (e: Exporter | null) => void
  /** Bumps when the person presses Refresh. */
  refreshKey: number
  refresh: () => void
}

const InsightsCtx = createContext<Ctx | null>(null)
const STORE = 'kaisync.insights.filters.v1'
const DEFAULT_PRESET: Exclude<PresetKey, 'custom'> = 'last_30'

function loadFilters(): Filters {
  const fallback: Filters = { preset: DEFAULT_PRESET, range: presetRange(DEFAULT_PRESET), branch: '', department: '' }
  try {
    const raw = sessionStorage.getItem(STORE)
    if (!raw) return fallback
    const f = JSON.parse(raw) as Partial<Filters>
    const preset = (f.preset ?? DEFAULT_PRESET) as PresetKey
    // Presets are worked out again from today, so "This month" stays this month after midnight.
    const range = preset === 'custom' && f.range && !rangeProblem(f.range) ? f.range : presetRange(preset === 'custom' ? DEFAULT_PRESET : preset)
    return { preset: preset === 'custom' && f.range && !rangeProblem(f.range) ? 'custom' : preset === 'custom' ? DEFAULT_PRESET : preset, range, branch: f.branch ?? '', department: f.department ?? '' }
  } catch {
    return fallback
  }
}

export function InsightsProvider({ children }: { children: ReactNode }) {
  const { company } = useDashboardCompany()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(() => ({ preset: DEFAULT_PRESET, range: presetRange(DEFAULT_PRESET), branch: '', department: '' }))
  const [orgFilters, setOrgFilters] = useState(false)
  const [options, setOptionsState] = useState<{ branches: string[]; departments: string[] }>({ branches: [], departments: [] })
  const [exporter, setExporterState] = useState<Exporter | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const loaded = useRef(false)

  useEffect(() => {
    setFilters(loadFilters())
    loaded.current = true
  }, [])

  useEffect(() => {
    if (!loaded.current) return
    try { sessionStorage.setItem(STORE, JSON.stringify(filters)) } catch { /* private window: fine */ }
  }, [filters])

  useEffect(() => {
    let alive = true
    resolveCurrentMember(createClient()).then(m => { if (alive && m) setCompanyId(m.companyId) })
    return () => { alive = false }
  }, [])

  const setPreset = useCallback((k: Exclude<PresetKey, 'custom'>) => setFilters(f => ({ ...f, preset: k, range: presetRange(k) })), [])
  const setCustom = useCallback((r: DateRange) => setFilters(f => ({ ...f, preset: 'custom', range: r })), [])
  const setBranch = useCallback((b: string) => setFilters(f => ({ ...f, branch: b })), [])
  const setDepartment = useCallback((d: string) => setFilters(f => ({ ...f, department: d })), [])
  const setOptions = useCallback((o: { branches: string[]; departments: string[] }) => {
    setOptionsState(prev => (prev.branches.join('|') === o.branches.join('|') && prev.departments.join('|') === o.departments.join('|') ? prev : o))
  }, [])
  const setExporter = useCallback((e: Exporter | null) => setExporterState(() => e), [])
  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  const c = company as unknown as { name?: string; company_code?: string | null; code?: string | null } | null
  const value = useMemo<Ctx>(() => ({
    companyId,
    companyName: c?.name ?? '',
    companyCode: c?.company_code ?? c?.code ?? null,
    filters, setPreset, setCustom, setBranch, setDepartment,
    orgFilters, setOrgFilters, options, setOptions, exporter, setExporter, refreshKey, refresh,
  }), [companyId, c?.name, c?.company_code, c?.code, filters, setPreset, setCustom, setBranch, setDepartment, orgFilters, options, setOptions, exporter, setExporter, refreshKey, refresh])

  return <InsightsCtx.Provider value={value}>{children}</InsightsCtx.Provider>
}

export function useInsights(): Ctx {
  const v = useContext(InsightsCtx)
  if (!v) throw new Error('useInsights must be used inside InsightsProvider')
  return v
}

/** Lets a page put its CSV/PDF buttons in the filter bar. */
export function useExporter(e: Exporter | null, deps: unknown[]) {
  const { setExporter } = useInsights()
  useEffect(() => {
    setExporter(e)
    return () => setExporter(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Switches the site/department filters on for this page. */
export function useOrgFilters() {
  const { setOrgFilters } = useInsights()
  useEffect(() => {
    setOrgFilters(true)
    return () => setOrgFilters(false)
  }, [setOrgFilters])
}

/**
 * Calls one insights_* database function for the current filters. While new numbers load, the old
 * ones stay on screen (dimmed) so nothing jumps.
 */
export function useInsightsRpc<T>(fn: string, opts: { org?: boolean; extra?: Record<string, unknown> } = {}) {
  const { companyId, filters, refreshKey } = useInsights()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const extraKey = JSON.stringify(opts.extra ?? {})
  const branch = opts.org ? filters.branch : ''
  const department = opts.org ? filters.department : ''

  useEffect(() => {
    if (!companyId) return
    let alive = true
    setLoading(true)
    setError(null)
    const args: Record<string, unknown> = { p_company_id: companyId, p_from: filters.range.from, p_to: filters.range.to, ...JSON.parse(extraKey) }
    if (opts.org) { args.p_branch = branch || null; args.p_department = department || null }
    createClient().rpc(fn, args).then(({ data: d, error: e }) => {
      if (!alive) return
      if (e) {
        setError(/NOT_ALLOWED|permission|not allowed/i.test(e.message) ? 'You do not have access to these reports.' : 'The numbers could not be loaded. Try again.')
      } else {
        setData(d as T)
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [companyId, fn, filters.range.from, filters.range.to, branch, department, extraKey, refreshKey, opts.org])

  return { data, loading, error }
}

export function usePeriodText() {
  const { filters } = useInsights()
  return describeRange(filters.range)
}
