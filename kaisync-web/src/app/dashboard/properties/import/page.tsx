'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM } from '@/lib/permissions'
import type { PropertyKind } from '@/types/database'
import * as XLSX from 'xlsx'

interface PreviewRow {
  name: string
  address: string | null
  property_kind: PropertyKind
  owner_name: string | null
  unit_number: string | null
  unit_type: string | null
  notes: string | null
  raw: Record<string, unknown>
}

const TEMPLATE_HEADERS = [
  'Property Name',
  'Address',
  'Kind',
  'Owner Client',
  'Unit Number',
  'Unit Type',
  'Notes',
]

const KINDS: PropertyKind[] = ['residential', 'commercial', 'mixed', 'other']

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

function normalizeKind(raw: string | null): PropertyKind {
  const v = (raw ?? '').trim().toLowerCase()
  if ((KINDS as string[]).includes(v)) return v as PropertyKind
  if (v.includes('comm')) return 'commercial'
  if (v.includes('mix')) return 'mixed'
  if (v.includes('other')) return 'other'
  return 'residential'
}

function normalise(row: Record<string, unknown>): PreviewRow {
  return {
    name: cell(row, 'Property Name', 'Name', 'Site', 'Property') ?? '',
    address: cell(row, 'Address', 'Location'),
    property_kind: normalizeKind(cell(row, 'Kind', 'Property Kind', 'Type')),
    owner_name: cell(row, 'Owner Client', 'Owner', 'Client', 'Client Name'),
    unit_number: cell(row, 'Unit Number', 'Unit', 'Unit No'),
    unit_type: cell(row, 'Unit Type', 'UnitType'),
    notes: cell(row, 'Notes', 'Note', 'Comments'),
    raw: row,
  }
}

function downloadLocalTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['Example Flat', '12 Main Rd', 'residential', 'Acme Pty', 'A1', 'flat', ''],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Properties')
  XLSX.writeFile(wb, 'property_import_template.xlsx')
}

export default function ImportPropertiesPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<PreviewRow[]>([])
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
      setCanCreate(can(perms, PERM.propertiesEdit))
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
        const items: PreviewRow[] = []

        rows.forEach((row, i) => {
          const c = normalise(row)
          if (!c.name) {
            errors.push(`Row ${i + 2}: No property name — skipped.`)
            return
          }
          items.push(c)
        })

        if (items.some(r => r.unit_number) && items.some(r => !r.unit_number)) {
          warnings.push('Some rows have units and some do not — units are only created when Unit Number is set.')
        }

        setParseWarnings(warnings)
        setParseErrors(errors)
        setPreview(items)
        setShowPreview(items.length > 0)
      } catch {
        setErrorMessage('Failed to parse file. Use a valid .xlsx or .csv.')
      }
    }
    reader.readAsBinaryString(file)
  }

  async function importRows() {
    setIsBusy(true)
    setErrorMessage(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setErrorMessage('Account not linked.'); setIsBusy(false); return }
    if (!canCreate) { setErrorMessage('No permission to edit properties.'); setIsBusy(false); return }

    const { data: clients } = await supabase
      .from('clients')
      .select('id, name')
      .eq('company_id', member.companyId)
      .limit(2000)

    const clientByName = new Map(
      ((clients ?? []) as { id: string; name: string }[]).map(c => [c.name.trim().toLowerCase(), c.id]),
    )

    // Group by property name so multiple unit rows share one site
    const groups = new Map<string, PreviewRow[]>()
    for (const row of preview) {
      const key = row.name.trim().toLowerCase()
      const list = groups.get(key) ?? []
      list.push(row)
      groups.set(key, list)
    }

    let importedSites = 0
    let importedUnits = 0
    const errs: string[] = []

    for (const [, rows] of groups) {
      const primary = rows[0]
      const ownerId = primary.owner_name
        ? clientByName.get(primary.owner_name.toLowerCase()) ?? null
        : null
      if (primary.owner_name && !ownerId) {
        errs.push(`${primary.name}: owner client "${primary.owner_name}" not found — importing without owner.`)
      }

      const { data: site, error: siteErr } = await supabase.from('sites').insert({
        company_id: member.companyId,
        name: primary.name.trim(),
        address: primary.address,
        property_kind: primary.property_kind,
        client_id: ownerId,
        notes: primary.notes,
        is_active: true,
        radius_meters: 200,
      }).select('id').single()

      if (siteErr || !site) {
        errs.push(`${primary.name}: ${siteErr?.message ?? 'failed to create property'}`)
        continue
      }
      importedSites++

      const unitNums = new Set<string>()
      for (const row of rows) {
        const un = row.unit_number?.trim()
        if (!un || unitNums.has(un.toLowerCase())) continue
        unitNums.add(un.toLowerCase())
        const { error: uErr } = await supabase.from('units').insert({
          company_id: member.companyId,
          site_id: site.id,
          unit_number: un,
          unit_type: row.unit_type,
          is_occupied: false,
        })
        if (uErr) errs.push(`${primary.name} / ${un}: ${uErr.message}`)
        else importedUnits++
      }
    }

    setIsBusy(false)
    if (errs.length > 0) {
      setErrorMessage(
        `${importedSites} properties, ${importedUnits} units imported; ${errs.length} issue(s):\n${errs.slice(0, 10).join('\n')}`,
      )
    } else {
      setPreview([])
      setShowPreview(false)
      setParseWarnings([])
      setParseErrors([])
      alert(`${importedSites} property(ies) and ${importedUnits} unit(s) imported.`)
    }
  }

  if (!permChecked) {
    return <div className="flex items-center justify-center h-full text-[13px] text-text-secondary">Loading…</div>
  }

  if (!canCreate) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center space-y-3 max-w-md">
          <span className="material-icons text-[48px] text-text-disabled">lock</span>
          <p className="text-[16px] font-semibold text-text-primary">Access denied</p>
          <Link href="/dashboard/properties" className="inline-block h-9 px-4 leading-9 rounded-md bg-primary text-white text-[13px] font-semibold">
            Back to Properties
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/properties" className="text-text-secondary hover:text-text-primary">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[18px] font-semibold text-text-primary flex-1">Import Properties</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl pb-24">
        <div className="card p-4 space-y-3">
          <p className="text-[14px] font-semibold text-text-primary">1. Download template</p>
          <p className="text-[13px] text-text-secondary">
            Property Name is required. Kind: residential, commercial, mixed, other.
            Same property name on multiple rows creates one site with multiple units.
            Owner Client must match an existing client name.
          </p>
          <button type="button" onClick={downloadLocalTemplate} className="btn-outlined h-9 px-3 text-[13px]">
            Download Excel template
          </button>
        </div>

        <div className="card p-4 space-y-3">
          <p className="text-[14px] font-semibold text-text-primary">2. Upload file</p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="text-[13px]"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
        </div>

        {errorMessage && (
          <pre className="text-[12px] text-error whitespace-pre-wrap bg-red-50 dark:bg-red-950/20 p-3 rounded-md">{errorMessage}</pre>
        )}
        {parseErrors.map(e => <p key={e} className="text-[12px] text-error">{e}</p>)}
        {parseWarnings.map(w => <p key={w} className="text-[12px] text-amber-700 dark:text-amber-300">{w}</p>)}

        {showPreview && (
          <div className="card p-4 space-y-3">
            <p className="text-[14px] font-semibold text-text-primary">3. Preview ({preview.length} rows)</p>
            <div className="overflow-x-auto max-h-64 border border-divider rounded-md">
              <table className="w-full" style={{ minWidth: 480 }}>
                <thead>
                  <tr className="border-b border-divider">
                    <th className="data-th text-left">Property</th>
                    <th className="data-th text-left">Kind</th>
                    <th className="data-th text-left">Unit</th>
                    <th className="data-th text-left">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-b border-divider">
                      <td className="data-td text-[12px]">{r.name}</td>
                      <td className="data-td text-[12px] capitalize">{r.property_kind}</td>
                      <td className="data-td text-[12px]">{r.unit_number ?? '—'}</td>
                      <td className="data-td text-[12px]">{r.owner_name ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              disabled={isBusy || preview.length === 0}
              onClick={() => void importRows()}
              className="btn-primary h-10 px-4 text-[13px] disabled:opacity-50"
            >
              {isBusy ? 'Importing…' : `Import ${preview.length} row(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
