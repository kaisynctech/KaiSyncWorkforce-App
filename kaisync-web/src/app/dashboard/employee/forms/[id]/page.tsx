'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'textarea'
  is_required: boolean
  options?: string[]
}

interface FormTemplate {
  id: string
  name: string
  description: string | null
  fields: FieldDef[]
}

export default function FormFillPage() {
  const params   = useParams()
  const router   = useRouter()
  const tmplId   = params.id as string

  const [template,   setTemplate]   = useState<FormTemplate | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [notFound,   setNotFound]   = useState(false)
  const [values,     setValues]     = useState<Record<string, unknown>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [companyId,  setCompanyId]  = useState<string | null>(null)
  const [empId,      setEmpId]      = useState<string | null>(null)

  useEffect(() => { init() }, [tmplId])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setCompanyId(member.companyId)
    setEmpId(member.employeeId)

    try {
      const { data, error: qErr } = await supabase
        .from('workflow_form_templates')
        .select('id, name, description, fields')
        .eq('id', tmplId)
        .eq('company_id', member.companyId)
        .maybeSingle()
      if (qErr) throw qErr
      if (!data) { setNotFound(true); setLoading(false); return }
      const tmpl = data as FormTemplate
      setTemplate(tmpl)
      // Initialise values
      const init: Record<string, unknown> = {}
      for (const f of (tmpl.fields ?? [])) {
        if (f.type === 'boolean') init[f.key] = false
        else init[f.key] = ''
      }
      setValues(init)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load form.')
    }
    setLoading(false)
  }

  function setValue(key: string, val: unknown) {
    setValues(prev => ({ ...prev, [key]: val }))
  }

  async function submit() {
    if (!template || !empId || !companyId) return
    setError(null)

    // Validate required fields
    const missing: string[] = []
    for (const f of template.fields ?? []) {
      if (!f.is_required) continue
      if (f.type === 'boolean') continue
      const v = values[f.key]
      if (v == null || String(v).trim() === '') missing.push(f.label)
    }
    if (missing.length > 0) {
      setError(`Required: ${missing.join(', ')}`)
      return
    }

    setSubmitting(true)
    const supabase = createClient()
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_submit_workflow_form', {
        p_company_id:    companyId,
        p_employee_id:   empId,
        p_template_id:   tmplId,
        p_data:          values,
        p_job_id:        null,
        p_site_id:       null,
        p_session_token: token,
      })
      if (rpcErr) throw rpcErr
      alert(`Form '${template.name}' submitted successfully.`)
      router.push('/dashboard/employee/forms')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submission failed.')
    }
    setSubmitting(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )
  if (notFound) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Form not found.</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <button onClick={() => router.back()} className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons">arrow_back</span>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[18px] font-semibold text-text-primary truncate">{template?.name}</h1>
          {template?.description && (
            <p className="text-[12px] text-text-secondary truncate">{template.description}</p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl">
        {error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error font-semibold">{error}</p>
          </div>
        )}

        {(template?.fields ?? []).map(f => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
              {f.label}{f.is_required && <span className="text-error ml-0.5">*</span>}
            </label>
            {f.type === 'text' && (
              <input className="input" type="text" value={String(values[f.key] ?? '')}
                onChange={e => setValue(f.key, e.target.value)} />
            )}
            {f.type === 'number' && (
              <input className="input" type="number" value={String(values[f.key] ?? '')}
                onChange={e => setValue(f.key, e.target.value === '' ? '' : Number(e.target.value))} />
            )}
            {f.type === 'date' && (
              <input className="input" type="date" value={String(values[f.key] ?? '')}
                onChange={e => setValue(f.key, e.target.value)} />
            )}
            {f.type === 'textarea' && (
              <textarea className="input resize-none" rows={3} value={String(values[f.key] ?? '')}
                onChange={e => setValue(f.key, e.target.value)} />
            )}
            {f.type === 'boolean' && (
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="w-5 h-5 accent-primary"
                  checked={Boolean(values[f.key])}
                  onChange={e => setValue(f.key, e.target.checked)} />
                <span className="text-[13px] text-text-secondary">Yes</span>
              </label>
            )}
            {f.type === 'select' && (
              <select className="input" value={String(values[f.key] ?? '')}
                onChange={e => setValue(f.key, e.target.value)}>
                <option value="">Select…</option>
                {(f.options ?? []).map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            )}
          </div>
        ))}

        <button onClick={submit} disabled={submitting}
          className="w-full h-12 rounded-xl bg-primary text-white font-bold text-[15px] hover:bg-primary-dark transition-colors disabled:opacity-60 mt-2">
          {submitting ? 'Submitting…' : 'Submit Form'}
        </button>

        <div className="h-4" />
      </div>
    </div>
  )
}
