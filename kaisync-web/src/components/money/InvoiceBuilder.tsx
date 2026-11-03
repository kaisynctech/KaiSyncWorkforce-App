'use client'

/**
 * New invoice / edit a draft invoice. Same look as the quote builder: client and dates, the items
 * (services, catalogue, inventory or your own line), notes, and a summary with the actions.
 * Saving always writes the invoice as a draft first, then its lines, then (for "Send") marks it sent,
 * so the database numbers it, posts it to the client's statement and takes inventory out of stock in one go.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { localISODate } from '@/lib/utils'
import { LineItemsEditor } from '@/components/money/LineItemsEditor'
import {
  asItemType, formatRand, lineQty, lineTotal, linesSubtotal, loadPickItems, meaningfulLines, newKey,
  type EditorLine, type PickItem,
} from '@/lib/line-items'

type ClientOpt = { id: string; name: string; email: string | null; payment_terms_days: number | null }
type JobOpt = { id: string; title: string; job_code: string | null }

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return localISODate(d)
}

function initials(name: string): string {
  return name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function InvoiceBuilder({ invoiceId }: { invoiceId?: string | null }) {
  const router = useRouter()
  const params = useSearchParams()
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [vat, setVat] = useState<{ registered: boolean; hasNumber: boolean; rate: number }>({ registered: false, hasNumber: false, rate: 0.15 })
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [jobs, setJobs] = useState<JobOpt[]>([])
  const [items, setItems] = useState<PickItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)

  const [clientId, setClientId] = useState(() => params.get('clientId') ?? params.get('client_id') ?? '')
  const [jobId, setJobId] = useState(() => params.get('job_id') ?? '')
  const [dealId] = useState(() => params.get('deal_id') ?? params.get('project_id') ?? '')
  const [issueDate, setIssueDate] = useState(() => localISODate())
  const [dueDate, setDueDate] = useState(() => addDays(localISODate(), 30))
  const [dueTouched, setDueTouched] = useState(false)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<EditorLine[]>([])
  const [vatOn, setVatOn] = useState(true)
  const [invoiceNumber, setInvoiceNumber] = useState<string | null>(null)
  const [quoteNumber, setQuoteNumber] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(!invoiceId)
  const [busy, setBusy] = useState<null | 'draft' | 'send'>(null)
  const [error, setError] = useState<string | null>(null)
  const [changingClient, setChangingClient] = useState(false)

  // Company, clients, jobs, and (when editing) the draft invoice.
  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) return
      setCompanyId(member.companyId)
      setEmployeeId(member.employeeId)
      const [{ data: co }, { data: cl }, { data: jb }] = await Promise.all([
        supabase.from('companies').select('is_vat_registered, vat_number, default_vat_rate').eq('id', member.companyId).maybeSingle(),
        supabase.from('clients').select('id, name, email, payment_terms_days').eq('company_id', member.companyId).order('name'),
        supabase.from('jobs').select('id, title, job_code').eq('company_id', member.companyId).order('created_at', { ascending: false }).limit(200),
      ])
      const c = co as { is_vat_registered?: boolean | null; vat_number?: string | null; default_vat_rate?: number | null } | null
      const r = Number(c?.default_vat_rate ?? 0.15)
      const rate = r > 1 ? r / 100 : r > 0 ? r : 0.15
      const registered = c?.is_vat_registered === true
      setVat({ registered, hasNumber: !!c?.vat_number?.trim(), rate })
      setVatOn(registered)
      setClients((cl ?? []) as ClientOpt[])
      setJobs((jb ?? []) as JobOpt[])

      if (invoiceId) {
        const [{ data: inv }, { data: ls }] = await Promise.all([
          supabase.from('finance_invoices').select('id, status, client_id, job_id, issue_date, due_date, notes, vat_rate, vat_amount, invoice_number, quote_id').eq('id', invoiceId).eq('company_id', member.companyId).maybeSingle(),
          supabase.from('finance_invoice_lines').select('description, quantity, unit_price, item_type, source_id, unit').eq('invoice_id', invoiceId).order('line_no'),
        ])
        const i = inv as Record<string, unknown> | null
        if (!i) { setError('Invoice not found.'); setLoaded(true); return }
        if (i.status !== 'draft') { router.replace(`/dashboard/money/invoices/${invoiceId}`); return }
        setClientId((i.client_id as string | null) ?? '')
        setJobId((i.job_id as string | null) ?? '')
        if (i.issue_date) setIssueDate(String(i.issue_date))
        if (i.due_date) { setDueDate(String(i.due_date)); setDueTouched(true) }
        setNotes((i.notes as string | null) ?? '')
        setVatOn(Number(i.vat_amount ?? 0) > 0 || (registered && Number(i.vat_rate ?? 0) > 0))
        setInvoiceNumber((i.invoice_number as string | null) ?? null)
        if (i.quote_id) {
          const { data: q } = await supabase.from('commercial_quotes').select('quote_number').eq('id', i.quote_id as string).maybeSingle()
          setQuoteNumber((q as { quote_number?: string | null } | null)?.quote_number ?? null)
        }
        setLines(((ls ?? []) as Record<string, unknown>[]).map(row => ({
          key: newKey(),
          type: asItemType(row.item_type),
          sourceId: (row.source_id as string | null) ?? null,
          description: String(row.description ?? ''),
          qty: Number(row.quantity ?? 1),
          unitPrice: Number(row.unit_price ?? 0),
          unit: String(row.unit ?? 'each'),
          hint: null,
        })))
        setLoaded(true)
      }
    })()
  }, [invoiceId, router])

  // What can be picked: reload when the client changes (a client's agreed service prices win).
  useEffect(() => {
    if (!companyId) return
    let alive = true
    setItemsLoading(true)
    loadPickItems(createClient(), companyId, clientId || null)
      .then(r => { if (alive) setItems(r) })
      .catch(() => { if (alive) setItems([]) })
      .finally(() => { if (alive) setItemsLoading(false) })
    return () => { alive = false }
  }, [companyId, clientId])

  const client = clients.find(c => c.id === clientId) ?? null

  // Due date follows the client's payment terms until someone changes it by hand.
  useEffect(() => {
    if (dueTouched) return
    setDueDate(addDays(issueDate, client?.payment_terms_days ?? 30))
  }, [issueDate, client?.payment_terms_days, dueTouched])

  const rate = vat.registered && vatOn ? vat.rate : 0
  const subtotal = useMemo(() => linesSubtotal(lines), [lines])
  const vatAmount = round2(subtotal * rate)
  const total = round2(subtotal + vatAmount)

  const save = useCallback(async (send: boolean) => {
    if (!companyId) return
    setError(null)
    if (!clientId) { setError('Choose who the invoice is for.'); return }
    const ls = meaningfulLines(lines)
    if (ls.length === 0) { setError('Add at least one item.'); return }
    if (ls.some(l => !l.description.trim())) { setError('Every line needs a description.'); return }
    setBusy(send ? 'send' : 'draft')
    const supabase = createClient()
    const header = {
      client_id: clientId,
      job_id: jobId || null,
      currency: 'ZAR',
      subtotal,
      vat_rate: rate,
      vat_amount: vatAmount,
      total_amount: total,
      balance_due: total,
      is_vat_inclusive: false,
      tax_type: rate > 0 ? 'standard' : 'exempt',
      issue_date: issueDate,
      due_date: dueDate || null,
      notes: notes.trim() || null,
    }
    let id = invoiceId ?? null
    if (id) {
      const { error: e } = await supabase.from('finance_invoices').update(header).eq('id', id).eq('status', 'draft')
      if (e) { setError(e.message); setBusy(null); return }
      const { error: d } = await supabase.from('finance_invoice_lines').delete().eq('invoice_id', id)
      if (d) { setError(d.message); setBusy(null); return }
    } else {
      const { data, error: e } = await supabase.from('finance_invoices').insert({
        ...header,
        company_id: companyId,
        deal_id: dealId || null,
        project_id: dealId || null,
        invoice_number: null,
        status: 'draft',
        amount_paid: 0,
        created_by: employeeId,
        invoice_type: 'standard',
      }).select('id').single()
      if (e || !data) { setError(e?.message ?? 'Could not save the invoice.'); setBusy(null); return }
      id = (data as { id: string }).id
    }
    const { error: le } = await supabase.from('finance_invoice_lines').insert(ls.map((l, i) => {
      const sub = lineTotal(l)
      const lv = round2(sub * rate)
      return {
        company_id: companyId,
        invoice_id: id,
        line_no: i + 1,
        description: l.description.trim(),
        quantity: lineQty(l),
        unit_price: round2(Number(l.unitPrice) || 0),
        subtotal: sub,
        vat_rate: rate,
        vat_amount: lv,
        total_amount: round2(sub + lv),
        is_vat_inclusive: false,
        tax_type: rate > 0 ? 'standard' : 'exempt',
        item_type: l.type,
        source_id: l.sourceId,
        unit: l.unit || null,
      }
    }))
    if (le) { setError(le.message); setBusy(null); if (!invoiceId) router.replace(`/dashboard/money/invoices/${id}/edit`); return }
    if (send) {
      const { error: se } = await supabase.from('finance_invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id)
      if (se) { setError(se.message); setBusy(null); return }
    }
    router.replace(`/dashboard/money/invoices/${id}${send ? '' : '?whats_next=1'}`)
  }, [companyId, clientId, lines, jobId, subtotal, rate, vatAmount, total, issueDate, dueDate, notes, invoiceId, dealId, employeeId, router])

  if (!loaded) return <p className="text-center text-[13px] text-text-secondary py-10">Loading…</p>

  const title = invoiceNumber ?? (invoiceId ? 'Draft invoice' : 'New invoice')

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-5 pb-12 flex flex-col gap-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={() => router.back()} aria-label="Back"
              className="w-10 h-10 rounded-xl border border-divider bg-surface-card flex items-center justify-center hover:bg-surface-elevated">
              <span className="material-icons text-[20px] text-text-secondary">chevron_left</span>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] font-semibold uppercase tracking-wider text-text-secondary">Invoice</span>
                <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Draft</span>
              </div>
              <h1 className="text-[19px] font-semibold text-text-primary truncate">
                {title}{client ? <span className="text-text-secondary font-normal"> · {client.name}</span> : null}
              </h1>
            </div>
          </div>
        </div>

        {quoteNumber && (
          <div className="flex items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.05] px-4 py-3 text-[13px] text-primary">
            <span className="material-icons text-[18px]">info</span>
            Made from quote {quoteNumber}. Check the lines, then send it.
          </div>
        )}
        {error && <p className="rounded-xl border border-error/30 bg-error/5 px-4 py-3 text-[13px] text-error">{error}</p>}

        <div className="flex flex-wrap gap-5 items-start">
          {/* Left */}
          <div className="flex-[999_1_640px] min-w-0 flex flex-col gap-5">
            <div className="bg-surface-card border border-divider rounded-2xl p-5 flex flex-wrap gap-5">
              <div className="flex-[2_1_280px] min-w-0">
                <p className="text-[11.5px] font-semibold uppercase tracking-wider text-text-secondary mb-2">Bill to</p>
                {client && !changingClient ? (
                  <div className="flex items-center gap-3 border border-divider rounded-xl p-3">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary font-bold text-[14px] flex items-center justify-center shrink-0">{initials(client.name)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-text-primary truncate">{client.name}</p>
                      <p className="text-[12px] text-text-secondary truncate">{client.email || 'No email on file'}</p>
                    </div>
                    <button type="button" onClick={() => setChangingClient(true)} className="h-8 px-3 rounded-lg border border-divider text-[12px] text-text-secondary hover:text-text-primary">Change</button>
                  </div>
                ) : (
                  <select
                    value={clientId}
                    autoFocus={changingClient}
                    onChange={e => { setClientId(e.target.value); setChangingClient(false) }}
                    aria-label="Client"
                    className="w-full h-11 rounded-xl border border-divider px-3 text-[14px] bg-background text-text-primary focus:outline-none focus:border-primary/60"
                  >
                    <option value="">Choose a client…</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                <div className="mt-3">
                  <select value={jobId} onChange={e => setJobId(e.target.value)} aria-label="Job (optional)"
                    className="w-full h-9 rounded-lg border border-divider px-2.5 text-[12.5px] bg-background text-text-secondary focus:outline-none focus:border-primary/60">
                    <option value="">No job linked</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>{j.job_code ? `${j.job_code} · ${j.title}` : j.title}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex-[1_1_220px] grid grid-cols-2 gap-3 content-start">
                <label className="flex flex-col gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-text-secondary">Invoice date
                  <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)}
                    className="h-11 rounded-xl border border-divider px-3 text-[14px] normal-case tracking-normal font-normal text-text-primary bg-background focus:outline-none focus:border-primary/60" />
                </label>
                <label className="flex flex-col gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-text-secondary">Due date
                  <input type="date" value={dueDate} onChange={e => { setDueDate(e.target.value); setDueTouched(true) }}
                    className="h-11 rounded-xl border border-divider px-3 text-[14px] normal-case tracking-normal font-normal text-text-primary bg-background focus:outline-none focus:border-primary/60" />
                </label>
              </div>
            </div>

            <LineItemsEditor lines={lines} onChange={setLines} items={items} itemsLoading={itemsLoading} />

            <div className="bg-surface-card border border-divider rounded-2xl p-5">
              <label className="flex flex-col gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-text-secondary">Notes for the client
                <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Payment terms, banking reference, thank-you note…"
                  className="rounded-xl border border-divider px-3 py-2.5 text-[14px] normal-case tracking-normal font-normal text-text-primary bg-background resize-none focus:outline-none focus:border-primary/60" />
              </label>
            </div>
          </div>

          {/* Right: summary */}
          <div className="flex-[1_1_320px] min-w-0 flex flex-col gap-4 lg:sticky lg:top-4">
            <div className="bg-surface-card border border-divider rounded-2xl p-5 flex flex-col gap-3.5">
              <h2 className="text-[15px] font-semibold text-text-primary">Summary</h2>
              {rate > 0 ? (
                <>
                  <div className="flex justify-between text-[14px] text-text-secondary"><span>Total excl. VAT</span><span className="font-medium text-text-primary tabular-nums">{formatRand(subtotal)}</span></div>
                  <div className="flex justify-between text-[14px] text-text-secondary"><span>VAT ({Math.round(rate * 1000) / 10}%)</span><span className="font-medium text-text-primary tabular-nums">{formatRand(vatAmount)}</span></div>
                  <div className="h-px bg-divider" />
                </>
              ) : null}
              <div className="flex justify-between items-baseline gap-3">
                <span className="text-[14px] font-semibold text-text-primary">{rate > 0 ? 'Total incl. VAT' : 'Total'}</span>
                <span className="text-[26px] font-bold tracking-tight text-text-primary tabular-nums whitespace-nowrap">{formatRand(total)}</span>
              </div>
              {vat.registered && (
                <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
                  <input type="checkbox" className="accent-primary" checked={vatOn} onChange={e => setVatOn(e.target.checked)} />
                  Charge VAT on this invoice
                </label>
              )}
              <button type="button" disabled={busy !== null} onClick={() => void save(true)}
                className="h-12 rounded-xl bg-primary text-white text-[15px] font-semibold flex items-center justify-center gap-2 hover:bg-primary-dark disabled:opacity-60 mt-1">
                <span className="material-icons text-[18px]">send</span>
                {busy === 'send' ? 'Sending…' : 'Save & send'}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void save(false)}
                className="h-11 rounded-xl border border-divider bg-surface-card text-[14px] font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-60">
                {busy === 'draft' ? 'Saving…' : 'Save draft'}
              </button>
              <p className="text-[12px] leading-relaxed text-text-secondary">
                Sending gives the invoice its number, adds it to {client ? `${client.name}’s` : 'the client’s'} statement
                {lines.some(l => l.type === 'inventory') ? ' and takes the inventory items out of stock' : ''}.
              </p>
              {vat.registered && !vat.hasNumber && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                  Your company is VAT-registered but has no VAT number. <Link href="/dashboard/settings?tab=general" className="font-semibold underline">Add it in Settings</Link>.
                </p>
              )}
              {!vat.registered && <p className="text-[12px] text-text-secondary">No VAT: your company is not VAT-registered.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
