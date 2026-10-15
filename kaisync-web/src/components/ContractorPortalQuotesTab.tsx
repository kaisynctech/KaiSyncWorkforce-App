'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  deleteQuoteDraft,
  getQuote,
  listQuotes,
  resubmitQuote,
  saveQuoteDraft,
  submitQuote,
  uploadQuote,
} from '@/lib/contractor-portal/api'
import type { ContractorPortalSession } from '@/lib/contractor-portal/session'
import {
  computeQuoteTotals,
  computeUploadTotals,
  emptyLine,
  filterQuotes,
  fmtMoney,
  fmtQuoteDate,
  lineSubtotal,
  QUOTE_FILTERS,
  quoteCanEdit,
  quoteCanResubmit,
  quoteIsDraft,
  quoteStatusLabel,
  VAT_MODE_OPTIONS,
  type QuoteFilter,
} from '@/lib/contractor-portal/quotes'
import type {
  ContractorQuote,
  QuoteLineDraft,
  QuoteVatMode,
} from '@/lib/contractor-portal/types'

type View = 'list' | 'create' | 'upload' | 'detail'

type FormState = {
  title: string
  description: string
  quoteNumber: string
  validUntil: string
  vatMode: QuoteVatMode
  vatRatePct: string
  discount: string
  freight: string
  duty: string
  levies: string
  otherCharges: string
  terms: string
  notes: string
  lines: QuoteLineDraft[]
}

function emptyForm(): FormState {
  return {
    title: '',
    description: '',
    quoteNumber: '',
    validUntil: '',
    vatMode: 'none',
    vatRatePct: '15',
    discount: '',
    freight: '',
    duty: '',
    levies: '',
    otherCharges: '',
    terms: '',
    notes: '',
    lines: [emptyLine()],
  }
}

export function ContractorPortalQuotesTab({
  session,
  onError,
}: {
  session: ContractorPortalSession
  onError: (msg: string | null) => void
}) {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [quotes, setQuotes] = useState<ContractorQuote[]>([])
  const [filter, setFilter] = useState<QuoteFilter>('All')
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<ContractorQuote | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [uploadAmount, setUploadAmount] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.contractor_id, session.company_id])

  async function reload() {
    setLoading(true)
    onError(null)
    try {
      setQuotes(await listQuotes(session.contractor_id, session.company_id))
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not load quotes.')
    }
    setLoading(false)
  }

  const filtered = useMemo(() => filterQuotes(quotes, filter), [quotes, filter])

  const vatRate = (Number(form.vatRatePct) || 0) / 100
  const createTotals = useMemo(
    () => computeQuoteTotals({
      lines: form.lines,
      discount: Number(form.discount) || 0,
      freight: Number(form.freight) || 0,
      duty: Number(form.duty) || 0,
      levies: Number(form.levies) || 0,
      otherCharges: Number(form.otherCharges) || 0,
      vatMode: form.vatMode,
      vatRate,
    }),
    [form, vatRate],
  )
  const uploadTotals = useMemo(
    () => computeUploadTotals({
      baseAmount: Number(uploadAmount) || 0,
      discount: Number(form.discount) || 0,
      freight: Number(form.freight) || 0,
      duty: Number(form.duty) || 0,
      levies: Number(form.levies) || 0,
      otherCharges: Number(form.otherCharges) || 0,
      vatMode: form.vatMode,
      vatRate,
    }),
    [form, uploadAmount, vatRate],
  )

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setView('create')
    onError(null)
  }

  function openUpload() {
    setForm(emptyForm())
    setUploadAmount('')
    setUploadFile(null)
    setView('upload')
    onError(null)
  }

  async function openDetail(q: ContractorQuote) {
    setBusy(true)
    onError(null)
    try {
      const full = await getQuote(session.contractor_id, session.company_id, q.id)
      setSelected(full ?? q)
      setView('detail')
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not load quote.')
    }
    setBusy(false)
  }

  function openEdit(q: ContractorQuote) {
    if (!quoteCanEdit(q)) return
    void (async () => {
      setBusy(true)
      onError(null)
      try {
        const full = await getQuote(session.contractor_id, session.company_id, q.id)
        const src = full ?? q
        setEditingId(src.id)
        setForm({
          title: src.title,
          description: src.description ?? '',
          quoteNumber: src.quote_number ?? '',
          validUntil: src.valid_until ?? '',
          vatMode: (src.vat_mode as QuoteVatMode) || 'none',
          vatRatePct: String(Math.round((src.vat_rate || 0.15) * 100)),
          discount: src.discount_amount ? String(src.discount_amount) : '',
          freight: src.freight_amount ? String(src.freight_amount) : '',
          duty: src.duty_amount ? String(src.duty_amount) : '',
          levies: src.levies_amount ? String(src.levies_amount) : '',
          otherCharges: src.other_charges_amount ? String(src.other_charges_amount) : '',
          terms: src.terms ?? '',
          notes: src.contractor_notes ?? '',
          lines: src.items.length > 0
            ? src.items.map(i => ({
              description: i.description,
              quantity: i.quantity,
              unit_price: i.unit_price,
              discount_amount: i.discount_amount,
            }))
            : [emptyLine()],
        })
        setView('create')
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : 'Could not open quote for edit.')
      }
      setBusy(false)
    })()
  }

  async function backToList() {
    setView('list')
    setSelected(null)
    setEditingId(null)
    await reload()
  }

  async function onSaveDraft(andSubmit: boolean) {
    if (!form.title.trim()) {
      onError('Title is required.')
      return
    }
    if (andSubmit) {
      const valued = form.lines.some(l => lineSubtotal(l) > 0 && l.description.trim())
      if (!valued) {
        onError('Add at least one line item with a description and amount.')
        return
      }
    }

    setBusy(true)
    onError(null)
    try {
      const priorStatus = editingId
        ? (quotes.find(q => q.id === editingId)?.status || selected?.status)
        : null
      const id = await saveQuoteDraft({
        contractorId: session.contractor_id,
        companyId: session.company_id,
        quoteId: editingId,
        title: form.title,
        description: form.description,
        quoteNumber: form.quoteNumber,
        validUntil: form.validUntil || null,
        vatMode: form.vatMode,
        vatRate,
        discount: Number(form.discount) || 0,
        freight: Number(form.freight) || 0,
        duty: Number(form.duty) || 0,
        levies: Number(form.levies) || 0,
        otherCharges: Number(form.otherCharges) || 0,
        terms: form.terms,
        contractorNotes: form.notes,
        items: form.lines,
      })
      setEditingId(id)
      if (andSubmit) {
        if (priorStatus === 'revision_requested') {
          await resubmitQuote(session.contractor_id, session.company_id, id)
        } else {
          await submitQuote(session.contractor_id, session.company_id, id)
        }
      }
      await backToList()
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not save quote.')
    }
    setBusy(false)
  }

  async function onSubmitDraft(q: ContractorQuote) {
    if (!window.confirm('Submit this draft quote to HR for review?')) return
    setBusy(true)
    onError(null)
    try {
      await submitQuote(session.contractor_id, session.company_id, q.id)
      await reload()
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not submit quote.')
    }
    setBusy(false)
  }

  async function onResubmit(q: ContractorQuote) {
    if (!window.confirm('Resubmit this revised quote to HR?')) return
    setBusy(true)
    onError(null)
    try {
      await resubmitQuote(session.contractor_id, session.company_id, q.id)
      await reload()
      if (view === 'detail') await openDetail(q)
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not resubmit quote.')
    }
    setBusy(false)
  }

  async function onDelete(q: ContractorQuote) {
    if (!window.confirm('Delete this draft quote?')) return
    setBusy(true)
    onError(null)
    try {
      await deleteQuoteDraft(session.contractor_id, session.company_id, q.id)
      await reload()
      if (view === 'detail') await backToList()
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not delete draft.')
    }
    setBusy(false)
  }

  async function onUploadSubmit() {
    if (!uploadFile) {
      onError('Choose a quote file to upload.')
      return
    }
    setBusy(true)
    onError(null)
    try {
      await uploadQuote({
        contractorId: session.contractor_id,
        companyId: session.company_id,
        file: uploadFile,
        title: form.title,
        description: form.description,
        quoteNumber: form.quoteNumber,
        amount: Number(uploadAmount) || 0,
        vatMode: form.vatMode,
        vatRate,
        discount: Number(form.discount) || 0,
        freight: Number(form.freight) || 0,
        duty: Number(form.duty) || 0,
        levies: Number(form.levies) || 0,
        otherCharges: Number(form.otherCharges) || 0,
        validUntil: form.validUntil || null,
        contractorNotes: form.notes,
      })
      await backToList()
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Could not upload quote.')
    }
    setBusy(false)
  }

  if (loading && view === 'list') {
    return <div className="py-16 text-center text-text-secondary text-[14px]">Loading quotes…</div>
  }

  if (view === 'create') {
    return (
      <QuoteEditor
        title={editingId ? 'Edit quote' : 'Create quote'}
        form={form}
        setForm={setForm}
        totals={createTotals}
        busy={busy}
        onBack={() => void backToList()}
        onSave={() => void onSaveDraft(false)}
        onSubmit={() => void onSaveDraft(true)}
        submitLabel={editingId && quotes.find(q => q.id === editingId)?.status === 'revision_requested'
          ? 'Save & resubmit'
          : 'Submit to HR'}
      />
    )
  }

  if (view === 'upload') {
    return (
      <div className="space-y-4">
        <Header title="Upload quote" onBack={() => void backToList()} />
        <Section title="Details">
          <Field label="Title *" value={form.title} onChange={v => setForm({ ...form, title: v })} />
          <Field label="Description" value={form.description} onChange={v => setForm({ ...form, description: v })} />
          <Field label="Your reference" value={form.quoteNumber} onChange={v => setForm({ ...form, quoteNumber: v })} />
          <Field label="Base amount (ZAR) *" value={uploadAmount} onChange={setUploadAmount} />
          <Field label="Valid until" value={form.validUntil} onChange={v => setForm({ ...form, validUntil: v })} type="date" />
          <Field label="Notes" value={form.notes} onChange={v => setForm({ ...form, notes: v })} />
        </Section>
        <VatChargesForm form={form} setForm={setForm} />
        <Section title="Totals">
          <TotalsPanel totals={uploadTotals} vatMode={form.vatMode} />
        </Section>
        <Section title="File">
          <input
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,application/pdf,image/*"
            className="w-full text-[12px] text-text-primary"
            onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
          />
        </Section>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onUploadSubmit()}
          className="h-11 px-4 rounded-xl bg-primary text-white font-semibold text-[13px] disabled:opacity-50"
        >
          {busy ? 'Submitting…' : 'Submit uploaded quote'}
        </button>
      </div>
    )
  }

  if (view === 'detail' && selected) {
    return (
      <div className="space-y-4">
        <Header title={selected.title || 'Quote'} onBack={() => void backToList()} />
        <div className="flex flex-wrap gap-2 items-center">
          <Badge>{quoteStatusLabel(selected.status)}</Badge>
          {selected.quote_number && <span className="text-[12px] text-text-secondary">{selected.quote_number}</span>}
          <span className="text-[12px] text-text-secondary ml-auto">{fmtMoney(selected.total_amount)}</span>
        </div>

        {selected.status === 'revision_requested' && (
          <Banner tone="amber" title="Revision requested">
            {selected.revision_comments || 'HR requested changes to this quote.'}
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={() => openEdit(selected)} className="text-[12px] font-semibold text-warning underline">Edit</button>
              <button type="button" onClick={() => void onResubmit(selected)} className="text-[12px] font-semibold text-warning underline">Resubmit</button>
            </div>
          </Banner>
        )}
        {selected.status === 'rejected' && (
          <Banner tone="red" title="Rejected">
            {selected.rejection_reason || 'No reason provided.'}
          </Banner>
        )}
        {selected.status === 'approved' && (
          <Banner tone="green" title="Approved">This quote has been approved by HR.</Banner>
        )}
        {selected.converted_to_job_id && (
          <Banner tone="green" title="Converted">Linked to a job on {fmtQuoteDate(selected.converted_at)}.</Banner>
        )}

        {selected.source_mode === 'upload' ? (
          <Section title="Attachment">
            {selected.attachments.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No attachment on file.</p>
            ) : (
              selected.attachments.map(a => (
                <a key={a.id} href={a.file_url} target="_blank" rel="noreferrer" className="block text-primary text-[13px] hover:underline">
                  {a.file_name || 'Open document'}
                </a>
              ))
            )}
          </Section>
        ) : (
          <Section title="Line items">
            {selected.items.length === 0 ? (
              <p className="text-[13px] text-text-secondary">No line items.</p>
            ) : (
              <div className="space-y-2">
                {selected.items.map(i => (
                  <div key={i.id || `${i.line_no}-${i.description}`} className="flex justify-between gap-3 text-[13px]">
                    <div className="min-w-0">
                      <p className="text-text-primary truncate">{i.description}</p>
                      <p className="text-[11px] text-text-secondary">{i.quantity} × {fmtMoney(i.unit_price)}</p>
                    </div>
                    <p className="text-text-primary whitespace-nowrap">{fmtMoney(i.line_total || i.subtotal)}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        <Section title="Totals">
          <Row label="Subtotal" value={fmtMoney(selected.subtotal)} />
          {selected.discount_amount > 0 && <Row label="Discount" value={`−${fmtMoney(selected.discount_amount)}`} />}
          {selected.freight_amount > 0 && <Row label="Freight" value={fmtMoney(selected.freight_amount)} />}
          {selected.duty_amount > 0 && <Row label="Duty" value={fmtMoney(selected.duty_amount)} />}
          {selected.levies_amount > 0 && <Row label="Levies" value={fmtMoney(selected.levies_amount)} />}
          {selected.other_charges_amount > 0 && <Row label="Other" value={fmtMoney(selected.other_charges_amount)} />}
          {selected.vat_amount > 0 && <Row label="VAT" value={fmtMoney(selected.vat_amount)} />}
          <Row label="Total" value={fmtMoney(selected.total_amount)} />
        </Section>

        <div className="flex flex-wrap gap-2">
          {quoteCanEdit(selected) && (
            <button type="button" onClick={() => openEdit(selected)} className="h-10 px-4 rounded-xl bg-primary text-white text-[13px] font-semibold">Edit</button>
          )}
          {quoteIsDraft(selected) && (
            <>
              <button type="button" onClick={() => void onSubmitDraft(selected)} disabled={busy} className="bg-primary h-10 px-4 rounded-xl text-white text-[13px] font-semibold disabled:opacity-50">Submit</button>
              <button type="button" onClick={() => void onDelete(selected)} disabled={busy} className="h-10 px-4 rounded-xl border border-divider text-error text-[13px] font-semibold disabled:opacity-50">Delete</button>
            </>
          )}
          {quoteCanResubmit(selected) && (
            <button type="button" onClick={() => void onResubmit(selected)} disabled={busy} className="h-10 px-4 rounded-xl bg-primary text-white text-[13px] font-semibold disabled:opacity-50">Resubmit</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-text-primary text-[18px] font-bold">Quotes</h2>
        <div className="flex gap-2">
          <button type="button" onClick={openCreate} className="h-9 px-3 rounded-lg bg-primary text-white text-[12px] font-semibold">+ Create</button>
          <button type="button" onClick={openUpload} className="bg-surface border border-divider h-9 px-3 rounded-lg text-text-primary text-[12px] font-semibold">+ Upload</button>
        </div>
      </div>

      <div className="bg-surface-elevated flex gap-1 overflow-x-auto p-1 rounded-xl">
        {QUOTE_FILTERS.map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-lg ${
              filter === f ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-text-secondary text-[13px]">No quotes in this filter.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(q => (
            <article
              key={q.id}
              className="border-divider bg-surface rounded-xl border px-4 py-3 space-y-2"
             
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button type="button" onClick={() => void openDetail(q)} className="text-[14px] font-semibold text-text-primary text-left hover:text-primary truncate block max-w-full">
                    {q.title || 'Untitled quote'}
                  </button>
                  <p className="text-[12px] text-text-secondary mt-0.5">
                    {q.quote_number || 'No number'} · {fmtQuoteDate(q.created_at)} · {q.source_mode === 'upload' ? 'Upload' : 'Manual'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[14px] font-bold text-text-primary">{fmtMoney(q.total_amount)}</p>
                  <Badge>{quoteStatusLabel(q.status)}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[12px]">
                <button type="button" onClick={() => void openDetail(q)} className="text-primary hover:underline">View</button>
                {quoteCanEdit(q) && <button type="button" onClick={() => openEdit(q)} className="text-text-primary hover:underline">Edit</button>}
                {quoteIsDraft(q) && (
                  <>
                    <button type="button" onClick={() => void onSubmitDraft(q)} className="text-text-primary hover:underline">Submit</button>
                    <button type="button" onClick={() => void onDelete(q)} className="text-error hover:underline">Delete</button>
                  </>
                )}
                {quoteCanResubmit(q) && (
                  <button type="button" onClick={() => void onResubmit(q)} className="text-warning hover:underline">Resubmit</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {busy && <p className="text-[12px] text-text-secondary">Working…</p>}
    </div>
  )
}

function QuoteEditor({
  title, form, setForm, totals, busy, onBack, onSave, onSubmit, submitLabel,
}: {
  title: string
  form: FormState
  setForm: (f: FormState) => void
  totals: ReturnType<typeof computeQuoteTotals>
  busy: boolean
  onBack: () => void
  onSave: () => void
  onSubmit: () => void
  submitLabel: string
}) {
  return (
    <div className="space-y-4">
      <Header title={title} onBack={onBack} />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onSave} className="bg-primary h-10 px-4 rounded-xl text-white text-[13px] font-semibold disabled:opacity-50">
          {busy ? '…' : 'Save draft'}
        </button>
        <button type="button" disabled={busy} onClick={onSubmit} className="h-10 px-4 rounded-xl bg-primary text-white text-[13px] font-semibold disabled:opacity-50">
          {busy ? '…' : submitLabel}
        </button>
      </div>

      <Section title="Quote details">
        <Field label="Title *" value={form.title} onChange={v => setForm({ ...form, title: v })} />
        <Field label="Description" value={form.description} onChange={v => setForm({ ...form, description: v })} />
        <Field label="Your reference" value={form.quoteNumber} onChange={v => setForm({ ...form, quoteNumber: v })} />
        <Field label="Valid until" value={form.validUntil} onChange={v => setForm({ ...form, validUntil: v })} type="date" />
        <Field label="Terms" value={form.terms} onChange={v => setForm({ ...form, terms: v })} />
        <Field label="Notes" value={form.notes} onChange={v => setForm({ ...form, notes: v })} />
      </Section>

      <Section title="Line items">
        <div className="space-y-3">
          {form.lines.map((line, idx) => (
            <div key={idx} className="bg-surface-elevated rounded-lg p-3 space-y-2">
              <Field
                label="Description"
                value={line.description}
                onChange={v => {
                  const lines = [...form.lines]
                  lines[idx] = { ...line, description: v }
                  setForm({ ...form, lines })
                }}
              />
              <div className="grid grid-cols-3 gap-2">
                <Field
                  label="Qty"
                  value={String(line.quantity)}
                  onChange={v => {
                    const lines = [...form.lines]
                    lines[idx] = { ...line, quantity: Number(v) || 0 }
                    setForm({ ...form, lines })
                  }}
                />
                <Field
                  label="Unit price"
                  value={String(line.unit_price)}
                  onChange={v => {
                    const lines = [...form.lines]
                    lines[idx] = { ...line, unit_price: Number(v) || 0 }
                    setForm({ ...form, lines })
                  }}
                />
                <Field
                  label="Discount"
                  value={String(line.discount_amount)}
                  onChange={v => {
                    const lines = [...form.lines]
                    lines[idx] = { ...line, discount_amount: Number(v) || 0 }
                    setForm({ ...form, lines })
                  }}
                />
              </div>
              <div className="flex justify-between items-center">
                <p className="text-[12px] text-text-secondary">Line: {fmtMoney(lineSubtotal(line))}</p>
                {form.lines.length > 1 && (
                  <button
                    type="button"
                    className="text-[11px] text-error"
                    onClick={() => setForm({ ...form, lines: form.lines.filter((_, i) => i !== idx) })}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setForm({ ...form, lines: [...form.lines, emptyLine()] })}
            className="text-[12px] font-semibold text-primary"
          >
            + Add line
          </button>
        </div>
      </Section>

      <VatChargesForm form={form} setForm={setForm} />
      <Section title="Totals">
        <TotalsPanel totals={totals} vatMode={form.vatMode} />
      </Section>
    </div>
  )
}

function VatChargesForm({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  return (
    <Section title="VAT & adjustments">
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-text-secondary uppercase">VAT mode</label>
        <select
          className="bg-surface border border-divider text-text-primary w-full h-10 px-3 rounded-lg text-[13px] text-text-primary"
         
          value={form.vatMode}
          onChange={e => setForm({ ...form, vatMode: e.target.value as QuoteVatMode })}
        >
          {VAT_MODE_OPTIONS.map(o => (
            <option key={o.value} value={o.value} className="bg-surface">{o.label}</option>
          ))}
        </select>
      </div>
      {form.vatMode !== 'none' && (
        <Field label="VAT rate %" value={form.vatRatePct} onChange={v => setForm({ ...form, vatRatePct: v })} />
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Discount" value={form.discount} onChange={v => setForm({ ...form, discount: v })} />
        <Field label="Freight" value={form.freight} onChange={v => setForm({ ...form, freight: v })} />
        <Field label="Duty" value={form.duty} onChange={v => setForm({ ...form, duty: v })} />
        <Field label="Levies" value={form.levies} onChange={v => setForm({ ...form, levies: v })} />
        <Field label="Other charges" value={form.otherCharges} onChange={v => setForm({ ...form, otherCharges: v })} />
      </div>
    </Section>
  )
}

function TotalsPanel({ totals, vatMode }: { totals: ReturnType<typeof computeQuoteTotals>; vatMode: QuoteVatMode }) {
  return (
    <div className="space-y-1">
      <Row label="Line subtotal" value={fmtMoney(totals.line_subtotal)} />
      <Row label="After discount" value={fmtMoney(totals.after_discount)} />
      <Row label="Taxable" value={fmtMoney(totals.taxable)} />
      <Row label={vatMode === 'inclusive' ? 'VAT (extracted)' : 'VAT'} value={vatMode === 'none' ? '—' : fmtMoney(totals.vat_amount)} />
      <Row label="Grand total" value={fmtMoney(totals.grand_total)} />
    </div>
  )
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onBack} className="text-text-secondary hover:text-text-primary">
        <span className="material-icons">arrow_back</span>
      </button>
      <h2 className="text-text-primary text-[18px] font-bold">{title}</h2>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-divider bg-surface rounded-xl border overflow-hidden">
      <div className="border-divider px-4 py-2.5 border-b">
        <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">{title}</p>
      </div>
      <div className="px-4 py-3 space-y-3">{children}</div>
    </section>
  )
}

function Field({
  label, value, onChange, type,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-text-secondary uppercase">{label}</label>
      <input
        type={type || 'text'}
        className="bg-surface border border-divider text-text-primary w-full h-10 px-3 rounded-lg text-[13px] text-text-primary"
       
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary text-right">{value}</span>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-surface-elevated inline-block text-[10px] font-semibold px-2 py-0.5 rounded text-text-primary">
      {children}
    </span>
  )
}

function Banner({ tone, title, children }: { tone: 'amber' | 'red' | 'green'; title: string; children: React.ReactNode }) {
  const box = tone === 'amber'
    ? 'bg-warning-dark border border-warning/30'
    : tone === 'green'
      ? 'bg-success-dark border border-success/30'
      : 'bg-error-dark border border-error/30'
  const text = tone === 'amber' ? 'text-warning' : tone === 'green' ? 'text-success' : 'text-error'
  return (
    <div className={`rounded-xl px-4 py-3 ${box}`}>
      <p className={`text-[13px] font-semibold ${text}`}>{title}</p>
      <div className="text-[12px] text-text-primary mt-1">{children}</div>
    </div>
  )
}
