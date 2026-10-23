'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { listBranches, listShiftTemplates } from '@/lib/employees'
import { getEmployeeNumberSettings, nextEmployeeNumberPreview } from '@/lib/employee-numbers'
import {
  IMPORT_COLUMNS, chunk, formatDuration, isAlreadyInCompany, managerIsInFile, parseImportSheet, problemsCsv,
  type ImportRow, type ParsedRow,
} from '@/lib/employee-import'

/** Rows per database call. 500 rows take about half a second on the server. */
const CHECK_BATCH = 500
const IMPORT_BATCH = 250
const LINK_BATCH = 2000

type ServerRow = { row: number; status: 'ready' | 'created' | 'error'; id?: string; employee_number?: string; errors?: string[]; manager_pending?: string }
type ServerResult = { created: number; failed: number; rows: ServerRow[] }
type Problem = { row: number; name: string; problem: string }
type Phase = 'idle' | 'reading' | 'checking' | 'checked' | 'importing' | 'linking' | 'done'

const btnPrimary = 'h-10 px-4 rounded-sm bg-primary text-white text-[13px] font-medium hover:bg-primary-dark transition-colors disabled:opacity-50'
const btnSecondary = 'h-10 px-4 rounded-sm border border-border text-[13px] font-medium text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-50'

function personName(r: ImportRow) {
  return `${r.name} ${r.surname}`.trim() || '(no name)'
}

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ImportEmployeesPage() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [branchNames, setBranchNames] = useState<string[]>([])
  const [templateNames, setTemplateNames] = useState<string[]>([])
  const [nextNumber, setNextNumber] = useState<string | null>(null)

  const [phase, setPhase] = useState<Phase>('idle')
  const [fileName, setFileName] = useState<string | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [parsed, setParsed] = useState<ParsedRow[]>([])
  const [problems, setProblems] = useState<Problem[]>([])
  const [warnings, setWarnings] = useState<Problem[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<{ created: number; failed: number; linked: number; seconds: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    resolveCurrentMember(supabase).then(async member => {
      if (!member || cancelled) return
      const [br, tm, num] = await Promise.all([
        listBranches(supabase, member.companyId),
        listShiftTemplates(supabase, member.companyId),
        getEmployeeNumberSettings(supabase, member.companyId),
      ])
      if (cancelled) return
      setCompanyId(member.companyId)
      if (br.ok) setBranchNames(br.data.map(b => b.name))
      if (tm.ok) setTemplateNames(tm.data.map(t => t.name))
      if (num.ok) setNextNumber(nextEmployeeNumberPreview(num.data))
    })
    return () => { cancelled = true }
  }, [])

  // Warn before closing the tab while people are being imported.
  useEffect(() => {
    if (phase !== 'importing' && phase !== 'linking') return
    const stop = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', stop)
    return () => window.removeEventListener('beforeunload', stop)
  }, [phase])

  function downloadTemplate() {
    const wb = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([IMPORT_COLUMNS.map(c => c.header)])
    sheet['!cols'] = IMPORT_COLUMNS.map(c => ({ wch: Math.max(14, c.header.length + 2) }))
    XLSX.utils.book_append_sheet(wb, sheet, 'Employees')

    const example = XLSX.utils.aoa_to_sheet([
      IMPORT_COLUMNS.map(c => c.header),
      ['Thandi', 'Mokoena', '', 'thandi.mokoena@example.com', '082 123 4567', '9001015009087', 'Site Supervisor', 'Site Labour',
        branchNames[0] ?? '', '', 'Manager', 'Permanent', '2023-03-01', templateNames[0] ?? '', 5, 8, 'Monthly', 28500, '', '',
        '', 'No', 0, 0, 0, 'Capitec', '1234567890', '470010', 'Savings'],
      ['Sipho', 'Dube', '', '', '', '9203045008081', 'General Worker', 'Site Labour',
        branchNames[0] ?? '', 'Thandi Mokoena', 'Employee', 'Contract', '2024-06-10', templateNames[0] ?? '', 6, 8.25, 'Hourly', '', 52.5, '',
        '', 'No', 0, 0, 0, '', '', '', ''],
    ])
    XLSX.utils.book_append_sheet(wb, example, 'Example')

    const help = XLSX.utils.aoa_to_sheet([
      ['Column', 'What to enter'],
      ...IMPORT_COLUMNS.map(c => [c.header.replace(' *', ''), c.help]),
      [],
      ['Tips', 'Fill in the Employees sheet (one person per row). The Example sheet is not imported.'],
      ['', 'People can report to someone further down the same file.'],
      ['', 'Rows with problems are listed before anything is saved, and are skipped if you continue.'],
      ['', 'Someone already in your company (same ID number, email or employee number) is not added twice.'],
    ])
    help['!cols'] = [{ wch: 22 }, { wch: 100 }]
    XLSX.utils.book_append_sheet(wb, help, 'Instructions')

    const longest = Math.max(branchNames.length, templateNames.length, 4)
    const lists = XLSX.utils.aoa_to_sheet([
      ['Branch', 'Time template', 'Access level', 'Employment type', 'Pay basis', 'Account type'],
      ...Array.from({ length: longest }, (_, i) => [
        branchNames[i] ?? '', templateNames[i] ?? '',
        ['Employee', 'Manager', 'HR', 'Admin'][i] ?? '', ['Permanent', 'Contract', 'Part-time', 'Student'][i] ?? '',
        ['Monthly', 'Hourly', 'Daily'][i] ?? '', ['Cheque', 'Savings', 'Transmission'][i] ?? '',
      ]),
    ])
    lists['!cols'] = [{ wch: 34 }, { wch: 40 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, lists, 'Lists')
    XLSX.writeFile(wb, 'employee_import_template.xlsx')
  }

  function reset() {
    setPhase('idle'); setFatal(null); setNotes([]); setParsed([]); setProblems([]); setWarnings([])
    setProgress(null); setSummary(null); setFileName(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleFile(file: File) {
    reset()
    setFileName(file.name)
    setPhase('reading')
    let result: ReturnType<typeof parseImportSheet>
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'employees') ?? wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const headers = ((XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 })[0] ?? []) as unknown[]).map(h => String(h ?? ''))
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[]
      result = parseImportSheet(rows, headers)
    } catch {
      setFatal('This file could not be read. Save it as .xlsx or .csv and try again.')
      setPhase('idle')
      return
    }
    if (result.missingColumns.length > 0) {
      setFatal(`The file has no ${result.missingColumns.join(' or ')} column. Use the template, or rename your column headings.`)
      setPhase('idle')
      return
    }
    if (result.rows.length === 0) {
      setFatal('There are no people in this file.')
      setPhase('idle')
      return
    }
    setNotes(result.unknownHeaders.length > 0 ? [`These columns were not recognised and will be ignored: ${result.unknownHeaders.join(', ')}.`] : [])
    setParsed(result.rows)
    await check(result.rows)
  }

  /** Asks the server about branches, templates, managers, roles and duplicates, without saving. */
  async function check(rows: ParsedRow[]) {
    if (!companyId) { setFatal('Your company could not be loaded. Refresh the page.'); setPhase('idle'); return }
    setPhase('checking')
    const toCheck = rows.filter(p => p.errors.length === 0).map(p => p.row)
    setProgress({ done: 0, total: toCheck.length })
    const serverErrors = new Map<number, string[]>()
    const supabase = createClient()
    for (const batch of chunk(toCheck, CHECK_BATCH)) {
      const { data, error } = await supabase.rpc('hr_import_employees', { p_company_id: companyId, p_rows: batch, p_dry_run: true })
      if (error) {
        setFatal(`The file could not be checked: ${error.message.replace(/^[A-Z_]+: /, '')}`)
        setPhase('idle')
        return
      }
      for (const r of (data as ServerResult).rows) {
        const errs = [...(r.errors ?? [])]
        if (r.manager_pending && !managerIsInFile(r.manager_pending, toCheck)) {
          errs.push(`Reports to "${r.manager_pending}" was not found in your company or in this file.`)
        }
        if (errs.length) serverErrors.set(r.row, errs)
      }
      setProgress(p => p && { ...p, done: Math.min(p.total, p.done + batch.length) })
    }
    const merged = rows.map(p => ({ ...p, errors: [...p.errors, ...(serverErrors.get(p.row.row) ?? [])] }))
    setParsed(merged)
    setProblems(merged.flatMap(p => p.errors.map(problem => ({ row: p.row.row, name: personName(p.row), problem }))))
    setWarnings(merged.flatMap(p => p.warnings.map(problem => ({ row: p.row.row, name: personName(p.row), problem }))))
    setProgress(null)
    setPhase('checked')
  }

  async function runImport() {
    if (!companyId) return
    const ready = parsed.filter(p => p.errors.length === 0).map(p => p.row)
    if (ready.length === 0) return
    const started = performance.now()
    setPhase('importing')
    setProgress({ done: 0, total: ready.length })
    const supabase = createClient()
    const created = new Map<number, string>()
    const failed: Problem[] = []
    const byRow = new Map(ready.map(r => [r.row, r]))

    for (const batch of chunk(ready, IMPORT_BATCH)) {
      const { data, error } = await supabase.rpc('hr_import_employees', { p_company_id: companyId, p_rows: batch, p_dry_run: false })
      if (error) {
        const left = ready.length - created.size - failed.length
        setFatal(`The import stopped after ${created.size} people: ${error.message.replace(/^[A-Z_]+: /, '')}. ` +
          `${left} were not imported. Check the file again to import the rest; people already added are skipped when they have an ID number, email or employee number.`)
        break
      }
      for (const r of (data as ServerResult).rows) {
        if (r.status === 'created' && r.id) created.set(r.row, r.id)
        else for (const problem of r.errors ?? ['Not imported.']) failed.push({ row: r.row, name: personName(byRow.get(r.row)!), problem })
      }
      setProgress(p => p && { ...p, done: Math.min(p.total, p.done + batch.length) })
    }

    // Second pass: reporting lines, now that everyone in the file exists.
    let linked = 0
    const links = ready.filter(r => r.manager && created.has(r.row)).map(r => ({ id: created.get(r.row)!, manager: r.manager!, row: r.row }))
    if (links.length > 0) {
      setPhase('linking')
      setProgress({ done: 0, total: links.length })
      const rowById = new Map(links.map(l => [l.id, l.row]))
      for (const batch of chunk(links, LINK_BATCH)) {
        const { data, error } = await supabase.rpc('hr_import_link_managers', {
          p_company_id: companyId, p_links: batch.map(({ id, manager }) => ({ id, manager })),
        })
        if (error) {
          failed.push(...batch.map(l => ({ row: l.row, name: personName(byRow.get(l.row)!), problem: `Added, but "Reports to" was not set: ${error.message}` })))
        } else {
          const res = data as { linked: number; problems: { id: string; problem: string }[] }
          linked += res.linked
          for (const p of res.problems) {
            const row = rowById.get(p.id) ?? 0
            failed.push({ row, name: personName(byRow.get(row)!), problem: `Added, but "Reports to" was not set: ${p.problem}` })
          }
        }
        setProgress(p => p && { ...p, done: Math.min(p.total, p.done + batch.length) })
      }
    }

    setProblems(failed)
    setSummary({ created: created.size, failed: failed.filter(f => !f.problem.startsWith('Added,')).length, linked, seconds: (performance.now() - started) / 1000 })
    setProgress(null)
    setPhase('done')
  }

  const readyCount = parsed.filter(p => p.errors.length === 0).length
  const alreadyCount = parsed.filter(p => isAlreadyInCompany(p.errors)).length
  const problemRows = parsed.length - readyCount - alreadyCount
  const busy = phase === 'reading' || phase === 'checking' || phase === 'importing' || phase === 'linking'
  const progressLabel = phase === 'checking' ? 'Checking' : phase === 'linking' ? 'Setting reporting lines' : 'Importing'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/employees" aria-label="Back to employees" className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]" aria-hidden="true">arrow_back</span>
        </Link>
        <h1 className="text-[18px] font-semibold text-text-primary flex-1">Import employees</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl pb-24">
        <div className="card p-4 space-y-3">
          <p className="text-[14px] font-semibold text-text-primary">1. Download the template</p>
          <p className="text-[13px] text-text-secondary">
            One person per row. It includes pay, start date, time template, branch, who they report to and banking,
            plus a Lists sheet with your branches and time templates.
            {nextNumber && ` Leave Employee number blank to number people automatically from ${nextNumber}.`}
          </p>
          <button type="button" onClick={downloadTemplate} disabled={!companyId} className={btnPrimary}>Download template</button>
        </div>

        <div className="card p-4 space-y-3">
          <p className="text-[14px] font-semibold text-text-primary">2. Choose your file</p>
          <p className="text-[13px] text-text-secondary">We check every row first. Nothing is saved until you press Import.</p>
          <input
            ref={fileRef}
            id="employee-import-file"
            type="file"
            accept=".xlsx,.xls,.csv"
            className="sr-only"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || !companyId} className={btnSecondary}>
              Choose .xlsx or .csv file
            </button>
            {fileName && <span className="text-[13px] text-text-secondary truncate">{fileName}</span>}
          </div>
        </div>

        {fatal && (
          <div role="alert" className="rounded-sm border border-error/40 bg-error-dark/30 p-3">
            <p className="text-[13px] text-error whitespace-pre-wrap">{fatal}</p>
          </div>
        )}
        {notes.map(n => (
          <div key={n} className="rounded-sm border border-warning/40 bg-warning-dark/30 p-3">
            <p className="text-[12px] text-warning">{n}</p>
          </div>
        ))}

        {progress && (
          <div className="card p-4 space-y-2" aria-live="polite">
            <div className="flex justify-between text-[13px] text-text-primary">
              <span>{progressLabel}…</span>
              <span>{progress.done.toLocaleString()} of {progress.total.toLocaleString()}</span>
            </div>
            <div
              role="progressbar"
              aria-label={progressLabel}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="h-2 rounded-full bg-surface-elevated overflow-hidden"
            >
              <div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            {phase === 'importing' && <p className="text-[12px] text-text-secondary">Please keep this page open until it finishes.</p>}
          </div>
        )}

        {phase === 'checked' && (
          <div className="card p-4 space-y-3">
            <p className="text-[14px] font-semibold text-text-primary">3. Check and import</p>
            <ul className="text-[13px] text-text-primary space-y-1">
              <li><strong>{readyCount.toLocaleString()}</strong> {readyCount === 1 ? 'person is' : 'people are'} ready to import.</li>
              {alreadyCount > 0 && <li><strong>{alreadyCount.toLocaleString()}</strong> {alreadyCount === 1 ? 'person is' : 'people are'} already in your company and will be skipped.</li>}
              {problemRows > 0 && <li className="text-error"><strong>{problemRows.toLocaleString()}</strong> {problemRows === 1 ? 'row has' : 'rows have'} problems and will be skipped. {readyCount > 0 ? 'Fix them in your file and choose it again, or import the rest now.' : 'Fix them in your file and choose it again.'}</li>}
              {readyCount === 0 && problemRows === 0 && alreadyCount > 0 && <li>There is nobody new to import.</li>}
              {warnings.length > 0 && <li className="text-warning">{warnings.length.toLocaleString()} {warnings.length === 1 ? 'note' : 'notes'} (they will still be imported).</li>}
            </ul>
            <div className="flex flex-wrap gap-2">
              {readyCount > 0 && (
                <button type="button" onClick={() => void runImport()} className={btnPrimary}>
                  Import {readyCount.toLocaleString()} {readyCount === 1 ? 'person' : 'people'}
                </button>
              )}
              <button type="button" onClick={reset} className={btnSecondary}>Choose another file</button>
            </div>
          </div>
        )}

        {phase === 'done' && summary && (
          <div className="card p-4 space-y-3" role="status">
            <p className="text-[14px] font-semibold text-text-primary">Import finished</p>
            <ul className="text-[13px] text-text-primary space-y-1">
              <li><strong>{summary.created.toLocaleString()}</strong> {summary.created === 1 ? 'person was' : 'people were'} added in {formatDuration(summary.seconds)}.</li>
              {summary.linked > 0 && <li>{summary.linked.toLocaleString()} reporting {summary.linked === 1 ? 'line was' : 'lines were'} set.</li>}
              {summary.failed > 0 && <li className="text-error">{summary.failed.toLocaleString()} {summary.failed === 1 ? 'row was' : 'rows were'} not imported (see below).</li>}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Link href="/dashboard/employees" className={`${btnPrimary} inline-flex items-center`}>View employees</Link>
              <button type="button" onClick={reset} className={btnSecondary}>Import another file</button>
            </div>
          </div>
        )}

        {(phase === 'checked' || phase === 'done') && (problems.length > 0 || warnings.length > 0) && (
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px] font-semibold text-text-primary">
                {problems.length > 0 ? `Problems (${problems.length.toLocaleString()})` : `Notes (${warnings.length.toLocaleString()})`}
              </p>
              <button
                type="button"
                onClick={() => download('employee_import_problems.csv', problemsCsv([...problems, ...warnings]), 'text/csv;charset=utf-8')}
                className={btnSecondary}
              >
                Download list (.csv)
              </button>
            </div>
            <div className="max-h-80 overflow-auto border border-divider rounded-sm">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-surface-elevated">
                  <tr className="text-left text-text-secondary">
                    <th scope="col" className="px-3 py-2 font-medium w-14">Row</th>
                    <th scope="col" className="px-3 py-2 font-medium w-48">Name</th>
                    <th scope="col" className="px-3 py-2 font-medium">Problem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {[...problems.map(p => ({ ...p, kind: 'error' as const })), ...warnings.map(p => ({ ...p, kind: 'note' as const }))]
                    .slice(0, 200)
                    .map((p, i) => (
                      <tr key={`${p.row}-${i}`}>
                        <td className="px-3 py-1.5 text-text-secondary">{p.row}</td>
                        <td className="px-3 py-1.5 text-text-primary">{p.name}</td>
                        <td className={`px-3 py-1.5 ${p.kind === 'error' ? 'text-error' : 'text-warning'}`}>{p.problem}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {problems.length + warnings.length > 200 && (
              <p className="text-[12px] text-text-secondary">Showing the first 200. Download the list to see them all.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
