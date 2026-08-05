'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import {
  normalizeAccountType,
  normalizePaymentMethod,
  normalizePaymentTerms,
  parseYesNo,
} from '@/lib/contractor-create-payload'
import { normalizeSupplierPartnerKind } from '@/lib/supplier-create-payload'
import { createSupplier } from '@/lib/suppliers'
import { PARTNER_KIND } from '@/lib/partner-kinds'
import { can, loadPermissions, PERM } from '@/lib/permissions'
import * as XLSX from 'xlsx'

interface PreviewSupplier {
  name: string
  contact_person: string | null
  email: string | null
  phone: string | null
  partner_kind: string
  raw: Record<string, unknown>
}

const TEMPLATE_HEADERS = [
  'Name',
  'Contact Person',
  'Phone',
  'Email',
  'Address',
  'Registration Number',
  'Tax Number',
  'VAT Registered',
  'VAT Number',
  'Partner Kind',
  'Account Holder',
  'Bank Name',
  'Bank Account',
  'Bank Branch Code',
  'Account Type',
  'Payment Terms',
  'Payment Method',
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

function normalise(row: Record<string, unknown>): PreviewSupplier {
  const name = cell(row, 'Name', 'Company Name', 'Company', 'Trading Name', 'Supplier') ?? ''
  const partnerRaw = cell(row, 'Partner Kind', 'PartnerKind', 'Type', 'Kind')
  return {
    name,
    contact_person: cell(row, 'Contact Person', 'ContactPerson', 'Contact'),
    email: cell(row, 'Email', 'Email Address'),
    phone: cell(row, 'Phone', 'Mobile', 'Telephone'),
    partner_kind: normalizeSupplierPartnerKind(partnerRaw),
    raw: row,
  }
}

function downloadLocalTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    [
      'Acme Supplies',
      'Jane Doe',
      '0820000000',
      'jane@acme.example',
      '1 Main Rd',
      '',
      '',
      'Yes',
      '4123456789',
      'supplier',
      '',
      '',
      '',
      '',
      'cheque',
      '30_days',
      'eft',
      '',
    ],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Suppliers')
  XLSX.writeFile(wb, 'supplier_import_template.xlsx')
}

export default function ImportSuppliersPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<PreviewSupplier[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [parseWarnings, setParseWarnings] = useState<string[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [permChecked, setPermChecked] = useState(false)
  const [canEditSuppliers, setCanEditSuppliers] = useState(false)
  const [canCreateDual, setCanCreateDual] = useState(false)

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
      setCanEditSuppliers(can(perms, PERM.suppliersEdit))
      setCanCreateDual(can(perms, PERM.contractorsCreate))
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
        const suppliers: PreviewSupplier[] = []
        const seenNames = new Set<string>()

        rows.forEach((row, i) => {
          try {
            const partnerCell = cell(row, 'Partner Kind', 'PartnerKind', 'Type', 'Kind')
            const partnerNorm = (partnerCell ?? '').trim().toLowerCase()
            if (partnerNorm === PARTNER_KIND.contractor) {
              errors.push(`Row ${i + 2}: Partner Kind "contractor" is not allowed here — use Contractors. Row skipped.`)
              return
            }

            const s = normalise(row)
            if (!s.name) {
              errors.push(`Row ${i + 2}: No name found — row skipped.`)
              return
            }
            if (s.partner_kind === PARTNER_KIND.both && !canCreateDual) {
              errors.push(
                `Row ${i + 2}: Partner Kind "both" requires contractors.create — row skipped.`,
              )
              return
            }
            const key = s.name.toLowerCase()
            if (seenNames.has(key)) {
              warnings.push(`Duplicate name in file: "${s.name}" (row ${i + 2}) — both will be imported.`)
            }
            seenNames.add(key)
            suppliers.push(s)
          } catch {
            errors.push(`Row ${i + 2}: Could not parse row.`)
          }
        })

        if (suppliers.some(s => !s.email) && suppliers.some(s => s.email)) {
          warnings.push('Some rows have no email — contact email will be blank for those suppliers.')
        }
        if (suppliers.some(s => s.partner_kind === PARTNER_KIND.both)) {
          warnings.push('Some rows are Partner Kind "both" — they will also appear under Contractors with a CT code.')
        }

        setParseWarnings(warnings)
        setParseErrors(errors)
        setPreview(suppliers)
        setShowPreview(suppliers.length > 0)
      } catch {
        setErrorMessage('Failed to parse file. Make sure it is a valid .xlsx or .csv file.')
      }
    }
    reader.readAsBinaryString(file)
  }

  async function importSuppliers() {
    setIsBusy(true)
    setErrorMessage(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setErrorMessage('Account not linked. Cannot import.'); setIsBusy(false); return }
    if (!canEditSuppliers) { setErrorMessage('You do not have permission to create suppliers.'); setIsBusy(false); return }

    const [{ data: company }, { data: existing }] = await Promise.all([
      supabase.from('companies').select('code').eq('id', member.companyId).maybeSingle(),
      supabase.from('contractors').select('contractor_code').eq('company_id', member.companyId),
    ])
    const companyCode = (company as { code?: string | null } | null)?.code ?? ''
    const existingCodes = (existing ?? []).map(r => (r as { contractor_code: string | null }).contractor_code)

    let imported = 0
    const errs: string[] = []

    for (const row of preview) {
      if (row.partner_kind === PARTNER_KIND.both && !canCreateDual) {
        errs.push(`${row.name}: dual partners require contractors.create`)
        continue
      }

      const name = cell(row.raw, 'Name', 'Company Name', 'Company', 'Trading Name', 'Supplier') ?? row.name
      const vatRegistered = parseYesNo(cell(row.raw, 'VAT Registered', 'VATRegistered', 'Is VAT Registered'))
      const vatNumber = cell(row.raw, 'VAT Number', 'VATNumber', 'VAT')

      const created = await createSupplier(supabase, {
        companyId: member.companyId,
        name,
        partnerKind: row.partner_kind,
        contactPerson: cell(row.raw, 'Contact Person', 'ContactPerson', 'Contact'),
        phone: cell(row.raw, 'Phone', 'Mobile', 'Telephone'),
        email: cell(row.raw, 'Email', 'Email Address'),
        address: cell(row.raw, 'Address'),
        registrationNumber: cell(row.raw, 'Registration Number', 'RegistrationNumber', 'Reg Number', 'Company Reg'),
        taxNumber: cell(row.raw, 'Tax Number', 'TaxNumber', 'Tax'),
        isVatRegistered: vatRegistered || Boolean(vatNumber),
        vatNumber,
        notes: cell(row.raw, 'Notes', 'Note', 'Comments'),
        accountHolderName: cell(row.raw, 'Account Holder', 'AccountHolder', 'Account Holder Name'),
        bankName: cell(row.raw, 'Bank Name', 'BankName'),
        bankAccount: cell(row.raw, 'Bank Account', 'BankAccount', 'Account Number'),
        bankBranchCode: cell(row.raw, 'Bank Branch Code', 'Branch Code', 'BankBranchCode'),
        accountType: normalizeAccountType(cell(row.raw, 'Account Type', 'AccountType')),
        paymentTerms: normalizePaymentTerms(cell(row.raw, 'Payment Terms', 'PaymentTerms')),
        preferredPaymentMethod: normalizePaymentMethod(cell(row.raw, 'Payment Method', 'PaymentMethod')),
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
      alert(`${imported} supplier(s) imported successfully.`)
    }
  }

  if (!permChecked) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-text-secondary">
        Loading…
      </div>
    )
  }

  if (!canEditSuppliers) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center space-y-3 max-w-md">
          <span className="material-icons text-[48px] text-text-disabled">lock</span>
          <p className="text-[16px] font-semibold text-text-primary">Access denied</p>
          <p className="text-[13px] text-text-secondary">
            You do not have permission to create suppliers.
          </p>
          <Link href="/dashboard/suppliers" className="inline-block h-9 px-4 leading-9 rounded-md bg-primary text-white text-[13px] font-semibold">
            Back to Suppliers
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/suppliers"
          className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[18px] font-semibold text-text-primary flex-1">Import Suppliers</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl pb-24">

        <div className="card p-4 space-y-3">
          <p className="text-[14px] font-semibold text-text-primary">1. Download template</p>
          <p className="text-[13px] text-text-secondary">
            Name is required. Partner Kind may be <code className="text-[12px]">supplier</code> or{' '}
            <code className="text-[12px]">both</code>. Pure contractors belong under Contractors.
            Dual rows require contractors.create and receive a CT code.
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
              {preview.map((s, i) => (
                <div key={`${s.name}-${i}`} className="px-3 py-2 text-[12px]">
                  <p className="font-medium text-text-primary">{s.name}</p>
                  <p className="text-text-secondary">
                    {[s.partner_kind, s.contact_person, s.email, s.phone]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </p>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void importSuppliers()}
              className="h-10 px-4 rounded-sm bg-primary text-white text-[13px] font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {isBusy ? 'Importing…' : `Import ${preview.length} supplier(s)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
