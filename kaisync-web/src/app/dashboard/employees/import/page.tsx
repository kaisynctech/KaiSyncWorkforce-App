'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  normalizeAccessLevel,
  normalizeEmploymentType,
  normalizeWorkerType,
} from '@/lib/employee-taxonomy'
import { resolveBranchIdByName, resolveManagerIdByName } from '@/lib/employee-org'
import { createEmployee } from '@/lib/employees'
import * as XLSX from 'xlsx'

interface PreviewEmployee {
  full_name: string
  email: string | null
  position: string | null
  employment_type: string | null
  department: string | null
  branch: string | null
  manager: string | null
  raw: Record<string, unknown>
}

const TEMPLATE_HEADERS = [
  'Name',
  'Surname',
  'Email',
  'ID Number',
  'Position',
  'Access Level',
  'Employment Type',
  'Worker Type',
  'Department',
  'Branch',
  'Manager',
  'Monthly Salary',
  'Hourly Rate',
  'Daily Rate',
  'Bank Name',
  'Bank Account',
  'Bank Branch Code',
  'Account Type',
]

function parseNum(raw: string | null): number {
  if (!raw) return 0
  const n = Number(String(raw).replace(/[,\sR]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function cell(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return null
}

function normalise(row: Record<string, unknown>): PreviewEmployee {
  const name = cell(row, 'Name', 'First Name', 'FirstName') ?? ''
  const surname = cell(row, 'Surname', 'Last Name', 'LastName') ?? ''
  return {
    full_name: ([name, surname].filter(Boolean).join(' ') || cell(row, 'Full Name', 'FullName')) ?? '—',
    email: cell(row, 'Email', 'Email Address'),
    position: cell(row, 'Position', 'Job Title', 'JobTitle', 'Role'),
    employment_type: cell(row, 'Employment Type', 'EmploymentType', 'Type'),
    department: cell(row, 'Department'),
    branch: cell(row, 'Branch', 'Branch Name'),
    manager: cell(row, 'Manager', 'Reports To', 'ReportsTo'),
    raw: row,
  }
}

function downloadLocalTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Employees')
  XLSX.writeFile(wb, 'employee_import_template.xlsx')
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
      const { data, error } = await supabase.rpc('get_employee_import_template_url')
      if (error) {
        downloadLocalTemplate()
        return
      }
      if (data?.download_url) window.open(data.download_url, '_blank')
      else downloadLocalTemplate()
    } catch {
      downloadLocalTemplate()
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
        if (employees.some(e => e.branch) && !employees.every(e => e.branch)) {
          warnings.push('Some rows have Branch blank — those employees will have no branch assigned.')
        }
        if (employees.some(e => e.manager) && !employees.every(e => e.manager)) {
          warnings.push('Some rows have Manager blank — those employees will have no reports-to link.')
        }

        setParseWarnings(warnings)
        setParseErrors(errors)
        setPreview(employees)
        setShowPreview(employees.length > 0)
      } catch {
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
      const name = cell(emp.raw, 'Name', 'First Name', 'FirstName') ?? ''
      const surname = cell(emp.raw, 'Surname', 'Last Name', 'LastName') ?? ''
      const branchLabel = cell(emp.raw, 'Branch', 'Branch Name')
      const managerLabel = cell(emp.raw, 'Manager', 'Reports To', 'ReportsTo')

      let branchId: string | null = null
      let branchName: string | null = null
      if (branchLabel) {
        const branch = await resolveBranchIdByName(supabase, member.companyId, branchLabel)
        if (!branch) {
          errs.push(`${name} ${surname}: Branch "${branchLabel}" not found`)
          continue
        }
        branchId = branch.id
        branchName = branch.name
      }

      let managerId: string | null = null
      if (managerLabel) {
        managerId = await resolveManagerIdByName(supabase, member.companyId, managerLabel)
        if (!managerId) {
          errs.push(`${name} ${surname}: Manager "${managerLabel}" not found`)
          continue
        }
      }

      const created = await createEmployee(supabase, {
        companyId: member.companyId,
        name,
        surname,
        email: cell(emp.raw, 'Email', 'Email Address'),
        idNumber: cell(emp.raw, 'ID Number', 'IDNumber', 'ID'),
        position: cell(emp.raw, 'Position', 'Job Title', 'JobTitle', 'Role'),
        department: cell(emp.raw, 'Department'),
        branchId,
        branchName,
        managerId,
        accessLevel: normalizeAccessLevel(cell(emp.raw, 'Access Level', 'AccessLevel')),
        employmentType: normalizeEmploymentType(cell(emp.raw, 'Employment Type', 'EmploymentType', 'Type')),
        workerType: normalizeWorkerType(cell(emp.raw, 'Worker Type', 'WorkerType', 'Worker Category')),
        monthlySalary: parseNum(cell(emp.raw, 'Monthly Salary', 'MonthlySalary', 'Salary')),
        hourlyRate: parseNum(cell(emp.raw, 'Hourly Rate', 'HourlyRate')),
        dailyRate: parseNum(cell(emp.raw, 'Daily Rate', 'DailyRate')),
        bankName: cell(emp.raw, 'Bank Name', 'BankName'),
        bankAccount: cell(emp.raw, 'Bank Account', 'BankAccount', 'Account Number'),
        bankBranchCode: cell(emp.raw, 'Bank Branch Code', 'Branch Code', 'BankBranchCode'),
        accountType: cell(emp.raw, 'Account Type', 'AccountType'),
        payByHour: parseNum(cell(emp.raw, 'Hourly Rate', 'HourlyRate')) > 0
          && parseNum(cell(emp.raw, 'Monthly Salary', 'MonthlySalary', 'Salary')) <= 0,
        workDaysWeekly: 5,
        dailyHours: 8,
        medicalAidDeduction: 0,
        pensionDeduction: 0,
        unionDeduction: 0,
        uifExempt: false,
      })

      if (!created.ok) {
        errs.push(`${name} ${surname}: ${created.message}`)
      } else {
        imported++
      }
    }

    setIsBusy(false)
    if (errs.length > 0) {
      setErrorMessage(`${imported} imported; ${errs.length} failed:\n${errs.slice(0, 5).join('\n')}`)
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
          <p className="text-[14px] font-semibold text-text-primary">1. Download template</p>
          <p className="text-[13px] text-text-secondary">
            Include Branch, Manager, pay rates, and banking columns for payroll readiness.
          </p>
          <button
            type="button"
            onClick={() => void downloadTemplate()}
            className="h-10 px-4 rounded-sm bg-primary text-white text-[13px] font-medium hover:bg-primary-dark transition-colors"
          >
            Download template
          </button>
        </div>

        {/* STEP 2 */}
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
            Choose .xlsx file
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
              {preview.map((emp, i) => (
                <div key={`${emp.full_name}-${i}`} className="px-3 py-2 text-[12px]">
                  <p className="font-medium text-text-primary">{emp.full_name}</p>
                  <p className="text-text-secondary">
                    {[emp.email, emp.position, emp.department, emp.branch, emp.manager]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void importEmployees()}
              className="h-10 px-4 rounded-sm bg-primary text-white text-[13px] font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {isBusy ? 'Importing…' : `Import ${preview.length} employee(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
