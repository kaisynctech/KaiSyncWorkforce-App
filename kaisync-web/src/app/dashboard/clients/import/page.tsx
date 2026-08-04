'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { normalizeClientType } from '@/lib/client-create-payload'
import { createClientRecord } from '@/lib/clients'
import { can, loadPermissions, PERM } from '@/lib/permissions'
import * as XLSX from 'xlsx'

interface PreviewClient {
  name: string
  type: string
  contact_person: string | null
  email: string | null
  phone: string | null
  raw: Record<string, unknown>
}

const TEMPLATE_HEADERS = [
  'Name',
  'Type',
  'Contact Person',
  'Phone',
  'Email',
  'Address',
  'Notes',
]

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

function normalise(row: Record<string, unknown>): PreviewClient {
  const name = cell(row, 'Name', 'Client Name', 'Company Name', 'Company', 'Client') ?? ''
  return {
    name,
    type: normalizeClientType(cell(row, 'Type', 'Client Type', 'ClientType')),
    contact_person: cell(row, 'Contact Person', 'ContactPerson', 'Contact'),
    email: cell(row, 'Email', 'Email Address'),
    phone: cell(row, 'Phone', 'Mobile', 'Telephone'),
    raw: row,
  }
}

function downloadLocalTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Clients')
  XLSX.writeFile(wb, 'client_import_template.xlsx')
}

export default function ImportClientsPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<PreviewClient[]>([])
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
      if (!member) { setPermChecked(true); setCanCreate(false); return }
      const { data: me } = await supabase
        .from('employees')
        .select('access_level')
        .eq('id', member.employeeId)
        .maybeSingle()
      const perms = await loadPermissions(supabase, member.companyId, me?.access_level)
      setCanCreate(can(perms, PERM.clientsEdit))
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
        const clients: PreviewClient[] = []
        const seenNames = new Set<string>()

        rows.forEach((row, i) => {
          try {
            const c = normalise(row)
            if (!c.name) {
              errors.push(`Row ${i + 2}: No name found — row skipped.`)
              return
            }
            const key = c.name.toLowerCase()
            if (seenNames.has(key)) {
              warnings.push(`Duplicate name in file: "${c.name}" (row ${i + 2}) — both will be imported.`)
            }
            seenNames.add(key)
            clients.push(c)
          } catch {
            errors.push(`Row ${i + 2}: Could not parse row.`)
          }
        })

        if (clients.some(c => !c.email) && clients.some(c => c.email)) {
          warnings.push('Some rows have no email — contact email will be blank for those clients.')
        }

        setParseWarnings(warnings)
        setParseErrors(errors)
        setPreview(clients)
        setShowPreview(clients.length > 0)
      } catch {
        setErrorMessage('Failed to parse file. Make sure it is a valid .xlsx or .csv file.')
      }
    }
    reader.readAsBinaryString(file)
  }

  async function importClients() {
    setIsBusy(true)
    setErrorMessage(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setErrorMessage('Account not linked. Cannot import.'); setIsBusy(false); return }
    if (!canCreate) { setErrorMessage('You do not have permission to edit clients.'); setIsBusy(false); return }

    const [{ data: company }, { data: existing }] = await Promise.all([
      supabase.from('companies').select('code').eq('id', member.companyId).maybeSingle(),
      supabase.from('clients').select('client_code').eq('company_id', member.companyId),
    ])
    const companyCode = (company as { code?: string | null } | null)?.code ?? ''
    const existingCodes = (existing ?? []).map(r => (r as { client_code: string | null }).client_code)

    let imported = 0
    const errs: string[] = []

    for (const row of preview) {
      const name = cell(row.raw, 'Name', 'Client Name', 'Company Name', 'Company', 'Client') ?? row.name

      const created = await createClientRecord(supabase, {
        companyId: member.companyId,
        name,
        type: normalizeClientType(cell(row.raw, 'Type', 'Client Type', 'ClientType')),
        contactPerson: cell(row.raw, 'Contact Person', 'ContactPerson', 'Contact'),
        phone: cell(row.raw, 'Phone', 'Mobile', 'Telephone'),
        email: cell(row.raw, 'Email', 'Email Address'),
        address: cell(row.raw, 'Address'),
        notes: cell(row.raw, 'Notes', 'Note', 'Comments'),
        assignCode: true,
        existingCodes,
        companyCode,
      })

      if (!created.ok) {
        errs.push(`${name}: ${created.message}`)
      } else {
        imported++
      }
    }

    setIsBusy(false)
    if (errs.length > 0) {
      setErrorMessage(`${imported} imported; ${errs.length} failed:\n${errs.slice(0, 8).join('\n')}`)
    } else {
      setPreview([])
      setShowPreview(false)
      setParseWarnings([])
      setParseErrors([])
      alert(`${imported} client(s) imported successfully.`)
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
            You do not have permission to edit clients.
          </p>
          <Link href="/dashboard/clients" className="inline-block h-9 px-4 leading-9 rounded-md bg-primary text-white text-[13px] font-semibold">
            Back to Clients
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/clients"
          className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[18px] font-semibold text-text-primary flex-1">Import Clients</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl pb-24">

        <div className="card p-4 space-y-3">
          <p className="text-[14px] font-semibold text-text-primary">1. Download template</p>
          <p className="text-[13px] text-text-secondary">
            Name is required. Type may be individual, company, government, ngo, or property
            (defaults to individual). Portal access stays off until enabled on each record;
            a permanent client code is assigned on import.
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
              {preview.map((c, i) => (
                <div key={`${c.name}-${i}`} className="px-3 py-2 text-[12px]">
                  <p className="font-medium text-text-primary">{c.name}</p>
                  <p className="text-text-secondary">
                    {[c.type, c.contact_person, c.email, c.phone]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void importClients()}
              className="h-10 px-4 rounded-sm bg-primary text-white text-[13px] font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {isBusy ? 'Importing…' : `Import ${preview.length} client(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
