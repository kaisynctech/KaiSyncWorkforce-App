'use client'

/**
 * The quotation or pro forma invoice as the client will see it: the same layout and colours as the PDF
 * (lib/quote-pdf.ts), drawn as a page on screen for the "Check and send" step. Always white, like paper.
 */

import { formatCurrency } from '@/lib/currencies'
import { DEFAULT_BRAND } from '@/lib/brand-colours'
import { bankLines, letterheadFromRow } from '@/lib/letterhead'
import { proformaNumber, type QuotePdfInput } from '@/lib/quote-pdf'
import { vatPercentLabel } from '@/lib/quote-vat'

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d.includes('T') ? d : `${d}T12:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const NUMERIC = new Set(['qty', 'days', 'price', 'rate', 'total'])

export function QuoteDocumentPreview({ input }: { input: QuotePdfInput }) {
  const lh = input.letterhead ?? letterheadFromRow({ name: input.company_name }, input.company_name)
  const b = lh.colours ?? DEFAULT_BRAND
  const isPf = input.kind === 'proforma'
  const cur = input.currency
  const m = (n: number) => formatCurrency(n, cur)
  const cols = input.columns?.length
    ? input.columns.filter(c => c.key !== 'cost' && c.key !== 'margin')
    : [{ key: 'item', label: 'Description' }, { key: 'qty', label: 'Qty' }, { key: 'unit', label: 'Unit' }, { key: 'price', label: 'Rate' }, { key: 'total', label: 'Amount' }]
  const rate = input.vatRate ?? (input.subtotal > 0 ? input.vat / input.subtotal : 0)
  const vatOn = rate > 0.0001
  const contact = input.contact ?? null
  const forLines = [
    contact?.name?.trim() ? `Attn: ${contact.name.trim()}` : null,
    input.client_address?.trim() || null,
    [contact?.email?.trim() || input.client_email?.trim(), contact?.phone?.trim()].filter(Boolean).join(' · ') || null,
    input.client_vat?.trim() ? `VAT ${input.client_vat.trim()}` : null,
    ...(input.header_fields ?? []).filter(h => h.value?.trim()).map(h => `${h.label}: ${h.value.trim()}`),
  ].filter((x): x is string => !!x)
  const sections: (string | null)[] = []
  for (const l of input.lines) { const s = l.section?.trim() || null; if (!sections.includes(s)) sections.push(s) }
  const usable = input.lines.filter(l => l.description.trim() || l.total > 0)
  const bank = bankLines(lh.bank)
  const facts: [string, string][] = [
    ['Number', isPf ? proformaNumber(input.quote_number) : (input.quote_number ?? 'Draft')],
    ['Date', fmtDate(input.issue_date ?? new Date().toISOString().slice(0, 10))],
    isPf ? ['Due', 'On acceptance'] : ['Valid until', fmtDate(input.valid_until)],
    ['Your reference', input.reference?.trim() || input.quote_number || '—'],
    ...(input.sales_rep?.trim() ? [['Sales rep', input.sales_rep.trim()] as [string, string]] : []),
  ]
  const small = 'text-[10px] font-bold tracking-[0.08em]'
  let n = 0
  const cell = (key: string, l: QuotePdfInput['lines'][number]) => {
    const days = Number(l.extra?.days) || 0
    switch (key) {
      case 'item': return `${l.is_option ? 'Option: ' : ''}${l.description.trim() || '—'}${l.recurring ? ` (every ${l.recurring})` : ''}`
      case 'qty': return (days ? Math.round((l.qty / days) * 100) / 100 : l.qty).toLocaleString('en-ZA')
      case 'days': return days ? String(days) : ''
      case 'unit': return l.unit || 'each'
      case 'price': case 'rate': return m(l.unit_price) + (Number(l.discount_pct) > 0 ? ` −${l.discount_pct}%` : '')
      case 'total': return l.is_option ? `(${m(l.total)})` : m(l.total)
      default: return l.extra?.[key] ?? ''
    }
  }
  const terms = [input.terms?.trim(), input.rate_note?.trim()].filter(Boolean).join(' ')
  const title = input.title?.trim()

  return (
    <div className="w-full max-w-[760px] bg-white text-[#1E293B] rounded-[4px] shadow-[0_18px_40px_rgba(15,23,42,0.18)] overflow-hidden text-[12px] leading-[1.5] flex flex-col" style={{ aspectRatio: '210 / 297', fontFamily: 'Inter, system-ui, sans-serif', colorScheme: 'light' }}>
      <div className="h-[6px]" style={{ background: `linear-gradient(90deg, ${b.accent} 0 30%, ${b.dark} 30% 100%)` }} />
      <div className="flex-1 px-6 sm:px-10 pt-8 pb-7 flex flex-col gap-6">
        <div className="flex flex-wrap justify-between gap-6 items-start">
          <div className="flex flex-col gap-2.5 min-w-0">
            {lh.logo
              ? <img src={lh.logo.dataUrl} alt={`${lh.name} logo`} className="w-[170px] max-h-[64px] object-contain object-left" /> // eslint-disable-line @next/next/no-img-element
              : <span className="text-[20px] font-bold" style={{ color: b.dark }}>{lh.name}</span>}
            <div className="text-[11px] text-[#475569] leading-[1.55]">
              <b className="text-[#1E293B]">{lh.legalName || lh.name}</b>
              {lh.address && <><br />{lh.address.replace(/\s*\n\s*/g, ', ')}</>}
              {[lh.phone, lh.email, lh.website].some(Boolean) && <><br />{[lh.phone, lh.email, lh.website].filter(Boolean).join(' · ')}</>}
              {(lh.registrationNumber || lh.vatNumber) && <><br />{[lh.registrationNumber ? `Reg. ${lh.registrationNumber}` : null, lh.vatNumber ? `VAT ${lh.vatNumber}` : null].filter(Boolean).join(' · ')}</>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 ml-auto">
            <span className="text-[24px] font-bold tracking-[0.06em]" style={{ color: b.dark }}>{isPf ? 'PRO FORMA INVOICE' : 'QUOTATION'}</span>
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-[11.5px]">
              {facts.map(([k, v]) => <div key={k} className="contents"><dt className="text-[#64748B]">{k}</dt><dd className={k === 'Number' ? 'font-bold text-right' : 'text-right'}>{v}</dd></div>)}
            </dl>
          </div>
        </div>

        <div className={`grid gap-4 ${input.delivery?.trim() ? 'sm:grid-cols-2' : ''}`}>
          <div className="bg-[#F8FAFC] rounded-lg px-3.5 py-3">
            <div className={`${small} mb-1`} style={{ color: b.accentText }}>CLIENT</div>
            <b>{input.client_name?.trim() || '—'}</b>
            {forLines.map((t, i) => <div key={i}>{t}</div>)}
          </div>
          {input.delivery?.trim() && (
            <div className="bg-[#F8FAFC] rounded-lg px-3.5 py-3">
              <div className={`${small} mb-1`} style={{ color: b.accentText }}>DELIVERY</div>
              <div className="whitespace-pre-line">{input.delivery.trim()}</div>
            </div>
          )}
        </div>

        {title && title !== 'Untitled quote' && title !== 'Untitled Quote' && <div className="text-[14px] font-bold -mb-3">{title}</div>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse">
            <thead>
              <tr className="text-white text-[10.5px] font-semibold tracking-[0.05em]" style={{ background: b.dark }}>
                <th className="px-2.5 py-2 text-left w-6 rounded-l-md">#</th>
                {cols.map((c, i) => (
                  <th key={c.key} className={`px-2.5 py-2 ${NUMERIC.has(c.key) ? 'text-right' : 'text-left'} ${i === cols.length - 1 ? 'rounded-r-md' : ''}`}>{c.label.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map(sct => {
                const rows = usable.filter(l => (l.section?.trim() || null) === sct)
                if (!rows.length) return null
                return [
                  sct ? (
                    <tr key={`s-${sct}`} style={{ background: b.accentSoft, color: b.accentText }} className="font-bold text-[11.5px]">
                      <td className="px-2.5 py-1.5" colSpan={cols.length}>{sct}</td>
                      <td className="px-2.5 py-1.5 text-right">{m(Math.round(rows.filter(r => !r.is_option).reduce((s, r) => s + r.total, 0) * 100) / 100)}</td>
                    </tr>
                  ) : null,
                  ...rows.map((l, i) => {
                    const num = l.is_option ? '' : String(++n)
                    return (
                      <tr key={`${sct}-${i}`} className={`border-b border-[#F1F5F9] ${l.is_option ? 'italic text-[#64748B]' : ''}`}>
                        <td className="px-2.5 py-1.5 text-[#94A3B8]">{num}</td>
                        {cols.map(c => (
                          <td key={c.key} className={`px-2.5 py-1.5 ${NUMERIC.has(c.key) ? 'text-right whitespace-nowrap' : ''} ${c.key === 'total' && !l.is_option ? 'font-semibold' : ''} ${c.key === 'unit' ? 'text-[#64748B]' : ''}`}>{cell(c.key, l)}</td>
                        ))}
                      </tr>
                    )
                  }),
                ]
              })}
            </tbody>
          </table>
          {usable.some(l => l.is_option) && <p className="mt-1.5 text-[11px] italic text-[#64748B]">Options are choices instead of the line above them; they are not in the total.</p>}
        </div>

        {/* Totals with the bank details (or note) beside them after the lines; terms and signature at the foot, as on the PDF. */}
        <div className="flex-1 flex flex-col gap-6">
        <div className="flex flex-wrap justify-between gap-6 items-start">
          <div className="flex-[1_1_220px] min-w-0">
            {isPf ? (
              <div className="border border-[#E2E8F0] rounded-lg px-3.5 py-3">
                <div className={`${small} mb-1.5`} style={{ color: b.accentText }}>BANK DETAILS</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  {(bank.length ? bank : [['Banking details', 'Add them in Settings › Company'] as [string, string]]).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-[#64748B]">{k}</dt><dd>{v}</dd></div>
                  ))}
                  <dt className="text-[#64748B]">Reference</dt><dd className="font-bold">{proformaNumber(input.quote_number)}</dd>
                </dl>
              </div>
            ) : input.notes?.trim() ? (
              <div className="text-[#475569] whitespace-pre-line"><b className="text-[#1E293B]">Note:</b> {input.notes.trim()}</div>
            ) : null}
          </div>
          <div className="flex-[0_1_250px] min-w-[220px] flex flex-col gap-1.5 text-[12px]">
            <div className="flex justify-between"><span className="text-[#64748B]">{vatOn ? 'Subtotal (excl. VAT)' : 'Subtotal'}</span><span>{m(input.subtotal)}</span></div>
            {vatOn && <div className="flex justify-between"><span className="text-[#64748B]">VAT {vatPercentLabel(rate)}%</span><span>{m(input.vat)}</span></div>}
            <div className="flex justify-between rounded-md px-2.5 py-2 mt-1 text-white text-[15px] font-bold" style={{ background: b.dark }}><span>{vatOn ? 'Total (incl. VAT)' : 'Total'}</span><span>{m(input.total)}</span></div>
            {(input.deposit && input.deposit.amount > 0) || isPf ? (
              <div className="flex justify-between rounded-md px-2.5 py-1.5 font-semibold" style={{ background: b.accentSoft, color: b.accentText }}>
                <span>{input.deposit && input.deposit.amount > 0 ? (isPf ? `Amount due now (${input.deposit.pct}% deposit)` : `Deposit to accept (${input.deposit.pct}%)`) : 'Amount due now'}</span>
                <span>{m(input.deposit && input.deposit.amount > 0 ? input.deposit.amount : input.total)}</span>
              </div>
            ) : null}
            {(input.recurring ?? []).map(r => <div key={r.period} className="flex justify-between"><span className="text-[#64748B]">Then every {r.period} (excl. VAT)</span><span>{m(r.amount)}</span></div>)}
          </div>
        </div>

        <div className="mt-auto grid sm:grid-cols-[1.4fr_1fr] gap-5 border-t border-[#E2E8F0] pt-4">
          <div className="text-[11px] text-[#475569]">
            {terms && <><div className={`${small} text-[#1E293B] mb-1`}>TERMS</div>{terms}</>}
          </div>
          {isPf ? (
            <div className="text-[11px] text-[#475569] bg-[#F8FAFC] rounded-lg px-3 py-2.5">This is a pro forma invoice, not a tax invoice. The tax invoice follows once payment is received.</div>
          ) : (
            <div className="text-[11px] text-[#475569]">
              <div className={`${small} text-[#1E293B] mb-1`}>ACCEPTED BY</div>
              <div className="h-[40px] border-b border-[#94A3B8] flex items-end">
                {input.accepted?.signature && <img src={input.accepted.signature} alt="Signature" className="h-[38px]" />} {/* eslint-disable-line @next/next/no-img-element */}
              </div>
              <div className="flex justify-between mt-1"><span>{input.accepted?.name ?? 'Name and signature'}</span><span>{input.accepted?.at ? fmtDate(input.accepted.at) : 'Date'}</span></div>
              {!input.accepted && <div className="mt-1.5" style={{ color: b.accentText }}>Signed online? The name, signature, date and time print here.</div>}
            </div>
          )}
        </div>
        </div>
      </div>
      <div className="bg-[#F8FAFC] text-[#64748B] text-[10px] px-6 sm:px-10 py-2.5 flex justify-between gap-3">
        <span>{[lh.legalName || lh.name, lh.registrationNumber ? `Reg. ${lh.registrationNumber}` : null, lh.vatNumber ? `VAT ${lh.vatNumber}` : null].filter(Boolean).join(' · ')}</span>
        <span>Page 1</span>
      </div>
    </div>
  )
}
