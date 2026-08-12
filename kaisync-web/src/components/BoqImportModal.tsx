'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtMoney } from '@/lib/finance-calc'
import type { BoqExtractedLine } from '@/types/commercial'

interface Props {
  quoteId: string
  companyId: string
  existingLineCount: number
  onImport: (lines: BoqExtractedLine[]) => void
  onClose: () => void
}

type Step = 'input' | 'review'
type InputTab = 'upload' | 'paste'

const ITEM_TYPE_COLORS: Record<string, string> = {
  material:   'bg-blue-100 text-blue-700',
  labour:     'bg-amber-100 text-amber-700',
  subcontract:'bg-purple-100 text-purple-700',
  equipment:  'bg-green-100 text-green-700',
  other:      'bg-gray-100 text-gray-500',
}

export function BoqImportModal({ quoteId, companyId, existingLineCount, onImport, onClose }: Props) {
  const [step,      setStep]      = useState<Step>('input')
  const [inputTab,  setInputTab]  = useState<InputTab>('upload')
  const [file,      setFile]      = useState<File | null>(null)
  const [text,      setText]      = useState('')
  const [extracting, setExtracting] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [lines,     setLines]     = useState<BoqExtractedLine[]>([])
  const [checked,   setChecked]   = useState<boolean[]>([])
  const [importing, setImporting] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  function handleFileSelect(f: File) {
    if (f.size > 10 * 1024 * 1024) { setError('File must be under 10 MB'); return }
    if (f.type !== 'application/pdf') { setError('Only PDF files are supported'); return }
    setError(null)
    setFile(f)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFileSelect(f)
  }

  async function extract() {
    if (!file && !text.trim()) return
    setExtracting(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('quote_id', quoteId)
      if (file) {
        fd.append('file', file)
      } else {
        fd.append('text', text.trim())
      }
      const res  = await fetch('/api/ai/extract-boq', { method: 'POST', body: fd })
      const data = await res.json() as { lines?: BoqExtractedLine[]; error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? 'Extraction failed')
      setLines(data.lines ?? [])
      setChecked((data.lines ?? []).map(() => true))
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setExtracting(false)
    }
  }

  function toggleLine(i: number) {
    setChecked(prev => { const n = [...prev]; n[i] = !n[i]; return n })
  }
  function toggleAll(v: boolean) {
    setChecked(prev => prev.map(() => v))
  }

  function updateLine(i: number, patch: Partial<BoqExtractedLine>) {
    setLines(prev => { const n = [...prev]; n[i] = { ...n[i], ...patch }; return n })
  }

  const selectedLines = lines.filter((_, i) => checked[i])
  const totalEstimate = selectedLines.reduce((s, l) => s + (l.unit_price ?? 0) * l.quantity, 0)

  async function importLines() {
    if (selectedLines.length === 0 || importing) return
    setImporting(true)
    const supabase = createClient()
    const rows = selectedLines.map((line, i) => ({
      company_id:      companyId,
      quote_id:        quoteId,
      sort_order:      existingLineCount + i,
      item_type:       line.item_type,
      description:     line.description,
      unit:            line.unit,
      quantity:        line.quantity,
      cost_price:      0,
      markup_percent:  0,
      unit_sell_price: line.unit_price ?? 0,
      subtotal_cost:   0,
      subtotal_sell:   (line.unit_price ?? 0) * line.quantity,
      vat_rate:        0.15,
      vat_amount:      (line.unit_price ?? 0) * line.quantity * 0.15,
      line_total:      (line.unit_price ?? 0) * line.quantity * 1.15,
    }))
    await supabase.from('commercial_quote_lines').insert(rows)
    setImporting(false)
    onImport(selectedLines)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider shrink-0">
          <h2 className="text-[16px] font-semibold text-text-primary">
            {step === 'input' ? 'Import Bill of Quantities' : `Review Extracted Lines (${lines.length} found)`}
          </h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <span className="material-icons text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'input' ? (
            <div className="flex flex-col gap-4">
              {/* Tabs */}
              <div className="flex gap-1 border-b border-divider pb-0">
                {(['upload', 'paste'] as InputTab[]).map(t => (
                  <button key={t} onClick={() => setInputTab(t)}
                    className={`h-9 px-4 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
                      inputTab === t ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
                    }`}>
                    {t === 'upload' ? 'Upload PDF' : 'Paste Text'}
                  </button>
                ))}
              </div>

              {inputTab === 'upload' ? (
                <div
                  ref={dropRef}
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf'; inp.onchange = (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFileSelect(f) }; inp.click() }}
                  className="flex flex-col items-center justify-center gap-3 h-48 border-2 border-dashed border-divider rounded-xl cursor-pointer hover:border-primary hover:bg-surface-elevated transition-colors"
                >
                  <span className="material-icons text-[40px] text-text-disabled">upload_file</span>
                  {file ? (
                    <div className="text-center">
                      <p className="text-[13px] font-medium text-text-primary">{file.name}</p>
                      <p className="text-[12px] text-text-secondary">{(file.size / 1024).toFixed(0)} KB</p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-[13px] font-medium text-text-primary">Drop PDF here or click to select</p>
                      <p className="text-[12px] text-text-secondary">PDF only · Max 10 MB</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={12}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder="Paste your BOQ table here...&#10;Works with plain text, CSV, or copied Excel content."
                    className="form-input resize-none font-mono text-[12px]"
                  />
                  <p className="text-[11px] text-text-secondary">Works with plain text, CSV, or copied Excel content.</p>
                </div>
              )}

              {error && <p className="text-[13px] text-error">{error}</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Bulk actions */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[13px] text-text-secondary cursor-pointer">
                  <input type="checkbox"
                    checked={checked.every(Boolean)}
                    onChange={e => toggleAll(e.target.checked)}
                    className="rounded"
                  />
                  Select all
                </label>
                <span className="text-[12px] text-text-disabled">{selectedLines.length} of {lines.length} selected</span>
              </div>

              {/* Lines table */}
              <div className="border border-divider rounded-lg overflow-hidden">
                <table className="w-full text-[12px]" style={{ minWidth: 640 }}>
                  <thead>
                    <tr className="bg-surface-elevated border-b border-divider">
                      <th className="data-th w-8"></th>
                      <th className="data-th text-left">Description</th>
                      <th className="data-th text-right w-16">Qty</th>
                      <th className="data-th text-center w-16">Unit</th>
                      <th className="data-th text-right w-24">Unit Price</th>
                      <th className="data-th text-center w-24">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, i) => (
                      <tr key={i} className={`border-b border-divider last:border-0 ${!checked[i] ? 'opacity-40' : ''}`}>
                        <td className="data-td">
                          <input type="checkbox" checked={checked[i]} onChange={() => toggleLine(i)} className="rounded" />
                        </td>
                        <td className="data-td">
                          <input
                            value={line.description}
                            onChange={e => updateLine(i, { description: e.target.value })}
                            className="w-full bg-transparent border-0 outline-none text-text-primary"
                          />
                          {line.notes && <p className="text-[11px] text-text-secondary truncate">{line.notes}</p>}
                        </td>
                        <td className="data-td text-right">
                          <input
                            type="number"
                            value={line.quantity}
                            onChange={e => updateLine(i, { quantity: +e.target.value })}
                            className="w-14 bg-transparent border-0 outline-none text-right"
                          />
                        </td>
                        <td className="data-td text-center">
                          <input
                            value={line.unit}
                            onChange={e => updateLine(i, { unit: e.target.value })}
                            className="w-14 bg-transparent border-0 outline-none text-center"
                          />
                        </td>
                        <td className="data-td text-right">
                          <input
                            type="number"
                            step="0.01"
                            value={line.unit_price ?? ''}
                            placeholder="—"
                            onChange={e => updateLine(i, { unit_price: e.target.value ? +e.target.value : null })}
                            className="w-20 bg-transparent border-0 outline-none text-right"
                          />
                        </td>
                        <td className="data-td text-center">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ITEM_TYPE_COLORS[line.item_type] ?? ''}`}>
                            {line.item_type}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[12px] text-text-secondary text-right">
                Estimated total (ex. VAT): <span className="font-semibold text-text-primary">{fmtMoney(totalEstimate)}</span>
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-divider shrink-0">
          {step === 'input' ? (
            <>
              <button onClick={onClose} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button
                onClick={extract}
                disabled={extracting || (!file && !text.trim())}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50 flex items-center gap-2"
              >
                {extracting ? (
                  <><span className="material-icons text-[16px] animate-spin">progress_activity</span>Extracting…</>
                ) : 'Extract Line Items →'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('input')} className="btn-outlined h-9 px-4 text-[13px]">← Back</button>
              <button
                onClick={importLines}
                disabled={selectedLines.length === 0 || importing}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
              >
                {importing ? 'Importing…' : `Add ${selectedLines.length} line${selectedLines.length !== 1 ? 's' : ''} to Quote`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
