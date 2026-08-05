'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { createProject } from '@/lib/projects'
import { can, loadPermissions, PERM } from '@/lib/permissions'
import * as XLSX from 'xlsx'

interface PreviewProject {
  title: string
  client_name: string | null
  status: string
  notes: string | null
  raw: Record<string, unknown>
}

const TEMPLATE_HEADERS = [
  'Title',
  'Client Name',
  'Client Code',
  'Status',
  'Notes',
]

const ALLOWED_STATUS = new Set(['draft', 'sent', 'in_progress', 'negotiation', 'won', 'lost'])

function cell(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '')
  const wanted = keys.map(norm)
  for (const [key, val] of Object.entries(row)) {
    if (wanted.includes(norm(key)) && val != null && String(val).trim()) {
      return String(val).trim()
    }
  }
  return null
}

function normalizeStatus(raw: string | null | undefined): string {
  const v = (raw ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  if (ALLOWED_STATUS.has(v)) return v
  return 'draft'
}

function normalise(row: Record<string, unknown>): PreviewProject {
  return {
    title: cell(row, 'Title', 'Project', 'Project Name', 'Name') ?? '',
    client_name: cell(row, 'Client Name', 'Client', 'ClientName'),
    status: normalizeStatus(cell(row, 'Status', 'Stage')),
    notes: cell(row, 'Notes', 'Note', 'Comments'),
    raw: row,
  }
}

function downloadLocalTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['Site survey — Block A', 'Acme Corp', 'C28XXXX', 'draft', 'Initial quote'],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Projects')
  XLSX.writeFile(wb, 'project_import_template.xlsx')
}

export default function ImportProjectsPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<PreviewProject[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [permChecked, setPermChecked] = useState(false)
  const [canCreate, setCanCreate] = useState(false)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { setPermChecked(true); return }
      const { data: me } = await supabase
        .from('employees')
        .select('access_level')
        .eq('id', member.employeeId)
        .maybeSingle()
      const perms = await loadPermissions(supabase, member.companyId, me?.access_level)
      setCanCreate(can(perms, PERM.projectsCreate))
      setPermChecked(true)
    })()
  }, [])

  function handleFile(file: File) {
    setErrorMessage(null)
    setParseWarnings([])
    setParseErrors([])
    setShowPreview(false)

    const reader = new FileReader()
    reader.onload = evt => {
      try {
        const data = evt.target?.result
        const wb = XLSX.read(data, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[]

        if (rows.length === 0) {
          setErrorMessage('The file is empty or has no data rows.')
          return
        }

        const warnings: string[] = []
        const errors: string[] = []
        const projects: PreviewProject[] = []

        rows.forEach((row, i) => {
          try {
            const p = normalise(row)
            if (!p.title) {
              errors.push(`Row ${i + 2}: No title found — row skipped.`)
              return
            }
            if (!p.client_name && !cell(row, 'Client Code', 'ClientCode')) {
              warnings.push(`Row ${i + 2}: "${p.title}" has no client — will import unlinked.`)
            }
            projects.push(p)
          } catch {
            errors.push(`Row ${i + 2}: Could not parse row.`)
          }
        })

        setParseWarnings(warnings)
        setParseErrors(errors)
        setPreview(projects)
        setShowPreview(projects.length > 0)
      } catch {
        setErrorMessage('Failed to parse file. Make sure it is a valid .xlsx or .csv file.')
      }
    }
    reader.readAsBinaryString(file)
  }

  async function importProjects() {
    setIsBusy(true)
    setErrorMessage(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setErrorMessage('Account not linked. Cannot import.'); setIsBusy(false); return }
    if (!canCreate) { setErrorMessage('You do not have permission to create projects.'); setIsBusy(false); return }

    const [{ data: company }, { data: existing }, { data: clients }] = await Promise.all([
      supabase.from('companies').select('code').eq('id', member.companyId).maybeSingle(),
      supabase.from('client_deals').select('project_code').eq('company_id', member.companyId),
      supabase.from('clients').select('id, name, client_code').eq('company_id', member.companyId),
    ])
    const companyCode = (company as { code?: string | null } | null)?.code ?? ''
    const existingCodes = (existing ?? []).map(r => (r as { project_code: string | null }).project_code)
    const clientRows = (clients ?? []) as { id: string; name: string; client_code: string | null }[]

    let imported = 0
    const errs: string[] = []
    const warnings: string[] = []

    for (const row of preview) {
      const title = cell(row.raw, 'Title', 'Project', 'Project Name', 'Name') ?? row.title
      const clientCode = cell(row.raw, 'Client Code', 'ClientCode')
      const clientName = cell(row.raw, 'Client Name', 'Client', 'ClientName') ?? row.client_name

      let clientId: string | null = null
      if (clientCode) {
        const byCode = clientRows.find(c => (c.client_code ?? '').toLowerCase() === clientCode.toLowerCase())
        clientId = byCode?.id ?? null
        if (!clientId) warnings.push(`${title}: client code "${clientCode}" not found — imported unlinked`)
      }
      if (!clientId && clientName) {
        const byName = clientRows.find(c => c.name.toLowerCase() === clientName.toLowerCase())
        clientId = byName?.id ?? null
        if (!clientId) warnings.push(`${title}: client "${clientName}" not found — imported unlinked`)
      }

      const created = await createProject(supabase, {
        companyId: member.companyId,
        title,
        clientId,
        status: normalizeStatus(cell(row.raw, 'Status', 'Stage') ?? row.status),
        notes: cell(row.raw, 'Notes', 'Note', 'Comments'),
        assignCode: true,
        existingCodes,
        companyCode,
      })

      if (!created.ok) errs.push(`${title}: ${created.message}`)
      else imported++
    }

    setIsBusy(false)
    if (errs.length > 0) {
      setErrorMessage(`${imported} imported; ${errs.length} failed:\n${errs.slice(0, 8).join('\n')}`)
      if (warnings.length) setParseWarnings(warnings.slice(0, 8))
    } else {
      setPreview([])
      setShowPreview(false)
      setParseErrors([])
      setParseWarnings(warnings.slice(0, 8))
      alert(
        warnings.length > 0
          ? `${imported} project(s) imported. ${warnings.length} without matched client.`
          : `${imported} project(s) imported successfully.`,
      )
    }
  }

  if (!permChecked) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-text-secondary">
        Loading…
      </div>
    )
  }

  if (!canCreate) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center space-y-3 max-w-md">
          <span className="material-icons text-[48px] text-text-disabled">lock</span>
          <p className="text-[16px] font-semibold text-text-primary">Access denied</p>
          <p className="text-[13px] text-text-secondary">
            You do not have permission to create projects.
          </p>
          <Link href="/dashboard/projects" className="inline-block h-9 px-4 leading-9 rounded-md bg-primary text-white text-[13px] font-semibold">
            Back to Projects
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/projects"
          className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[18px] font-semibold text-text-primary flex-1">Import Projects</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl pb-24">
        <div className="card p-4 space-y-3">
          <p className="text-[14px] font-semibold text-text-primary">1. Download template</p>
          <p className="text-[13px] text-text-secondary">
            Title is required. Match clients by <code className="text-[12px]">Client Code</code> or exact{' '}
            <code className="text-[12px]">Client Name</code>. Status defaults to draft. Project codes are allocated automatically.
          </p>
          <button
            type="button"
            onClick={downloadLocalTemplate}
            className="h-10 px-4 rounded-sm bg-primary text-white text-[13px] font-medium hover:bg-primary-dark transition-colors"
          >
            Download template
          </button>
        </div>

        <div className="card p-4 space-y-3">
          <p className="text-[14px] font-semibold text-text-primary">2. Upload file</p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-10 px-4 rounded-sm border border-border text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors"
          >
            Choose .xlsx / .csv file
          </button>
        </div>

        {parseErrors.length > 0 && (
          <div className="rounded-sm border border-error/40 bg-error-dark/30 p-3 space-y-1">
            {parseErrors.map(e => (
              <p key={e} className="text-[12px] text-error">{e}</p>
            ))}
          </div>
        )}
        {parseWarnings.length > 0 && (
          <div className="rounded-sm border border-warning/40 bg-warning-dark/30 p-3 space-y-1">
            {parseWarnings.map(w => (
              <p key={w} className="text-[12px] text-warning">{w}</p>
            ))}
          </div>
        )}
        {errorMessage && (
          <div className="rounded-sm border border-error/40 bg-error-dark/30 p-3">
            <p className="text-[12px] text-error whitespace-pre-wrap">{errorMessage}</p>
          </div>
        )}

        {showPreview && (
          <div className="card p-4 space-y-3">
            <p className="text-[14px] font-semibold text-text-primary">
              3. Preview ({preview.length})
            </p>
            <div className="max-h-64 overflow-y-auto border border-divider rounded-sm divide-y divide-divider">
              {preview.map((p, i) => (
                <div key={`${p.title}-${i}`} className="px-3 py-2 text-[12px]">
                  <p className="font-medium text-text-primary">{p.title}</p>
                  <p className="text-text-secondary">
                    {[p.status, p.client_name].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void importProjects()}
              className="h-10 px-4 rounded-sm bg-primary text-white text-[13px] font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {isBusy ? 'Importing…' : `Import ${preview.length} project(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
