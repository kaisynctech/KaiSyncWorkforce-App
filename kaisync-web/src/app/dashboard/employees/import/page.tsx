'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import * as XLSX from 'xlsx'

interface PreviewEmployee {
  full_name: string
  email: string | null
  position: string | null
  employment_type: string | null
  raw: Record<string, unknown>
}

function normalise(row: Record<string, unknown>): PreviewEmployee {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
      if (v != null && String(v).trim()) return String(v).trim()
    }
    return null
  }
  const name = get('Name', 'First Name', 'FirstName') ?? ''
  const surname = get('Surname', 'Last Name', 'LastName') ?? ''
  return {
    full_name: ([name, surname].filter(Boolean).join(' ') || get('Full Name', 'FullName')) ?? '—',
    email: get('Email', 'Email Address'),
    position: get('Position', 'Job Title', 'JobTitle', 'Role'),
    employment_type: get('Employment Type', 'EmploymentType', 'Type'),
    raw: row,
  }
}

export default function ImportEmployeesPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<PreviewEmployee[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  async function downloadTemplate() {
    const supabase = createClient()
    try {
      const { data } = await supabase.rpc('get_employee_import_template_url')
      if (data?.download_url) window.open(data.download_url, '_blank')
      else {
        // Build a minimal template client-side
        const ws = XLSX.utils.aoa_to_sheet([
          ['Name', 'Surname', 'Email', 'ID Number', 'Position', 'Access Level', 'Employment Type', 'Department'],
        ])
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Employees')
        XLSX.writeFile(wb, 'employee_import_template.xlsx')
      }
    } catch {
      const ws = XLSX.utils.aoa_to_sheet([
        ['Name', 'Surname', 'Email', 'ID Number', 'Position', 'Access Level', 'Employment Type', 'Department'],
      ])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Employees')
      XLSX.writeFile(wb, 'employee_import_template.xlsx')
    }
  }

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
        const employees: PreviewEmployee[] = []

        rows.forEach((row, i) => {
          try {
            const emp = normalise(row)
            if (!emp.full_name || emp.full_name === '—') {
              errors.push(`Row ${i + 2}: No name found — row skipped.`)
              return
            }
            employees.push(emp)
          } catch {
            errors.push(`Row ${i + 2}: Could not parse row.`)
          }
        })

        if (!employees.some(e => e.email)) {
          warnings.push('No email addresses detected — employees will not receive invite emails.')
        }

        setParseWarnings(warnings)
        setParseErrors(errors)
        setPreview(employees)
        setShowPreview(employees.length > 0)
      } catch (e) {
        setErrorMessage('Failed to parse file. Make sure it is a valid .xlsx file.')
      }
    }
    reader.readAsBinaryString(file)
  }

  async function importEmployees() {
    setIsBusy(true)
    setErrorMessage(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setErrorMessage('Account not linked. Cannot import.'); setIsBusy(false); return }

    let imported = 0
    const errs: string[] = []

    for (const emp of preview) {
      const get = (...keys: string[]) => {
        for (const k of keys) {
          const v = emp.raw[k] ?? emp.raw[k.toLowerCase()] ?? emp.raw[k.toUpperCase()]
          if (v != null && String(v).trim()) return String(v).trim()
        }
        return null
      }
      const name    = get('Name', 'First Name', 'FirstName') ?? ''
      const surname = get('Surname', 'Last Name', 'LastName') ?? ''

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('employees') as any).insert({
        company_id:              member.companyId,
        name,
        surname,
        email:                   get('Email', 'Email Address') ?? null,
        id_number:               get('ID Number', 'IDNumber', 'ID') ?? null,
        position:                get('Position', 'Job Title', 'JobTitle', 'Role') ?? null,
        department:              get('Department') ?? null,
        access_level:            (get('Access Level', 'AccessLevel') ?? 'employee').toLowerCase(),
        employment_type:         (get('Employment Type', 'EmploymentType', 'Type') ?? 'permanent').toLowerCase(),
        worker_type:             'employee',
        is_active:               true,
        registration_status:     'active',
        hourly_rate:             0,
        daily_rate:              0,
        weekly_rate:             0,
        monthly_salary:          0,
        overtime_rate:           0,
        double_time_rate:        0,
        daily_hours:             8,
        work_days_weekly:        5,
        uif_exempt:              false,
        medical_aid_deduction:   0,
        pension_deduction:       0,
        union_deduction:         0,
        pay_full_monthly_salary: false,
        paye_fixed_amount:       0,
        uif_fixed_amount:        0,
        pin_reset_required:      false,
        pin_failed_attempts:     0,
        login_failed_attempts:   0,
        is_account_locked:       false,
      })
      if (error) {
        errs.push(`${name} ${surname}: ${error.message}`)
      } else {
        imported++
      }
    }

    setIsBusy(false)
    if (errs.length > 0) {
      setErrorMessage(`${imported} imported; ${errs.length} failed:\n${errs.slice(0, 3).join('\n')}`)
    } else {
      setPreview([])
      setShowPreview(false)
      setParseWarnings([])
      setParseErrors([])
      alert(`${imported} employee(s) imported successfully.`)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/employees"
          className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[18px] font-semibold text-text-primary flex-1">Import Employees</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl pb-24">

        {/* STEP 1 */}
        <div className="card p-4 space-y-3">
          <p className="section-label">STEP 1 — DOWNLOAD TEMPLATE</p>
          <p className="text-text-secondary text-sm">
            Download the blank Excel template, fill in your employees, then import the file.
          </p>
          <button onClick={downloadTemplate}
            className="btn-primary w-full h-[46px] text-[14px] font-semibold rounded-[10px]">
            📥  Download Blank Template
          </button>
        </div>

        {/* STEP 2 */}
        <div className="card p-4 space-y-3">
          <p className="section-label">STEP 2 — SELECT YOUR FILE</p>
          <p className="text-text-secondary text-sm">
            Select your completed .xlsx file — use our template or your own spreadsheet with
            similar column names (Name, Surname, ID Number, Access Level, etc.).
          </p>
          <button onClick={() => fileRef.current?.click()}
            className="w-full h-[46px] rounded-[10px] text-primary border border-divider bg-surface-elevated font-medium text-[14px] hover:opacity-80 transition-opacity">
            📂  Browse File
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
        </div>

        {/* Error banner */}
        {errorMessage && (
          <div className="rounded-[10px] px-3.5 py-2.5 border border-[#FCA5A5]"
            style={{ backgroundColor: '#FEE2E2' }}>
            <p className="text-error font-medium text-[13px]">{errorMessage}</p>
          </div>
        )}

        {/* Warnings banner */}
        {parseWarnings.length > 0 && (
          <div className="rounded-[10px] px-3.5 py-2.5 border border-[#93C5FD]"
            style={{ backgroundColor: '#EFF6FF' }}>
            <p className="text-[11px] font-semibold text-[#1D4ED8] mb-1">NOTES</p>
            {parseWarnings.map((w, i) => (
              <p key={i} className="text-[11px] text-[#1E40AF]">{w}</p>
            ))}
          </div>
        )}

        {/* Parse errors banner */}
        {parseErrors.length > 0 && (
          <div className="rounded-[10px] px-3.5 py-2.5 border border-[#FCD34D]"
            style={{ backgroundColor: '#FEF3C7' }}>
            <p className="text-[11px] font-semibold text-[#92400E] mb-1">ROWS SKIPPED OR ISSUES</p>
            {parseErrors.map((e, i) => (
              <p key={i} className="text-[11px] text-[#B45309]">{e}</p>
            ))}
          </div>
        )}

        {/* STEP 3 — PREVIEW */}
        {showPreview && (
          <div className="card p-4 space-y-3">
            <div className="grid grid-cols-[1fr_auto] items-center">
              <p className="section-label">STEP 3 — PREVIEW</p>
              <p className="text-xs text-primary">{preview.length} employee{preview.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {preview.map((emp, i) => (
                <div key={i}
                  className="bg-surface-elevated border border-divider rounded-lg px-3 py-2">
                  <div className="grid grid-cols-[1fr_auto] items-start">
                    <div>
                      <p className="font-medium text-[13px] text-text-primary">{emp.full_name}</p>
                      <div className="flex gap-2 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-text-secondary">
                          {emp.email ?? 'No email'}
                        </span>
                        {emp.position && (
                          <span className="text-[11px] text-text-secondary">{emp.position}</span>
                        )}
                      </div>
                    </div>
                    {emp.employment_type && (
                      <span className="text-[10px] rounded-md px-1.5 py-0.5 shrink-0"
                        style={{ backgroundColor: '#DCFCE7', color: '#166534' }}>
                        {emp.employment_type}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sticky import button */}
      {showPreview && (
        <div className="absolute bottom-0 left-[64px] right-0 px-4 py-2 border-t border-divider z-10"
          style={{ backgroundColor: 'var(--color-background)' }}>
          <button onClick={importEmployees} disabled={isBusy}
            className="w-full h-[52px] rounded-xl font-bold text-[16px] text-white disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: '#16A34A' }}>
            {isBusy ? 'Importing…' : `Import ${preview.length} Employee${preview.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}
