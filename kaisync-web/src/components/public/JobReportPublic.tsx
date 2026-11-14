'use client'

/**
 * The client's job report, opened from the link (WhatsApp / email), no login (board R3). No prices.
 * They read what was done, see the photos, then sign — or say they are not happy and why (the office is told; the
 * job's status does not change). Optional star rating. Download the PDF (signed copy once signed).
 */

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { letterheadFromRow, loadLetterheadLogo } from '@/lib/letterhead'
import { callPublicDocument, type PublicJobReportView, type PublicResult } from '@/lib/public-document'
import { fmtClock, fmtDay, fmtMinutes } from '@/lib/job-report'
import { SignaturePad } from '@/components/SignaturePad'

export async function downloadJobReportPdf(v: PublicJobReportView) {
  const { buildJobReportPdf, loadPdfImage } = await import('@/lib/job-report-pdf')
  const lh = await loadLetterheadLogo(createClient(), letterheadFromRow(v.company))
  const r = v.report
  const photos = (await Promise.all(r.photos.map(loadPdfImage))).filter(x => x !== null)
  const doc = buildJobReportPdf({
    letterhead: lh, content: r.content, status: r.status, version: r.version, photos,
    technician: { name: r.technician_name, signature: r.technician_signature, at: r.technician_signed_at },
    client: { name: r.client_name, signature: r.client_signature, at: r.client_signed_at, comment: r.client_comment },
  })
  doc.save(`Job_report_${(r.job_code ?? 'job').replace(/[^\w.-]+/g, '_')}${r.status === 'signed' ? '_signed' : ''}.pdf`)
}

const card = 'bg-white rounded-2xl border border-slate-200 p-5'
const sec = 'text-[11px] font-semibold text-slate-500 tracking-wider uppercase mb-2'

export function JobReportPublic({ token, v, onChange }: { token: string; v: PublicJobReportView; onChange: () => Promise<void> }) {
  const r = v.report
  const c = r.content
  const [pdfBusy, setPdfBusy] = useState(false)
  const [name, setName] = useState('')
  const [sig, setSig] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [rating, setRating] = useState(0)
  const [notHappy, setNotHappy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function send(outcome: 'signed' | 'not_happy') {
    setBusy(true); setError(null)
    try {
      const res = await callPublicDocument<PublicResult>(token, 'sign', { outcome, name, signature: sig, comment, rating: rating || undefined })
      if (!res.ok) { setError(res.message); return }
      setDone(res.message)
      await onChange()
    } finally { setBusy(false) }
  }

  const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <p className="text-[12px] text-slate-500">Job report{r.version > 1 ? ` · version ${r.version}` : ''}</p>
        <h1 className="text-[20px] font-semibold text-slate-900">{r.job_code ? `${r.job_code} · ` : ''}{c.job?.title || r.job_title}</h1>
        <p className="text-[13.5px] text-slate-600">{[c.job?.client, c.job?.address, c.job?.service].filter(Boolean).join(' · ')}</p>
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          {r.status === 'signed' && <span className="text-[12px] font-semibold rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-800">Signed by {r.client_name} · {when(r.client_signed_at)}</span>}
          {r.status === 'not_happy' && <span className="text-[12px] font-semibold rounded-full px-2.5 py-1 bg-red-50 text-red-800">You told us you are not happy · we will be in touch</span>}
          <button type="button" disabled={pdfBusy} onClick={async () => { setPdfBusy(true); try { await downloadJobReportPdf(v) } finally { setPdfBusy(false) } }}
            className="h-11 px-4 rounded-xl border border-slate-300 bg-white text-[14px] font-medium text-slate-800 flex items-center gap-2 disabled:opacity-60">
            <span className="material-icons text-[18px]">download</span>{pdfBusy ? 'Preparing…' : r.status === 'signed' ? 'Download signed PDF' : 'Download PDF'}
          </button>
        </div>
      </section>

      {c.visits?.length > 0 && (
        <section className={card}>
          <p className={sec}>Visits and time on site</p>
          <ul className="divide-y divide-slate-100">
            {c.visits.map(d => (
              <li key={d.date} className="py-2">
                <div className="flex justify-between text-[14px]"><span className="font-medium">{fmtDay(d.date)}</span><b>{fmtMinutes(d.minutes)}</b></div>
                {d.people.map(p => <p key={p.name} className="text-[12.5px] text-slate-500">{p.name} · {fmtClock(p.arrived)} – {fmtClock(p.left)}</p>)}
              </li>
            ))}
            <li className="pt-2 flex justify-between text-[14px] font-semibold"><span>Total</span><span>{fmtMinutes(c.total_minutes)}</span></li>
          </ul>
        </section>
      )}

      {c.work?.length > 0 && (
        <section className={card}>
          <p className={sec}>Work done</p>
          <div className="flex flex-col gap-2">
            {c.work.map((w, i) => (
              <div key={i}><p className="text-[12px] text-slate-500">{fmtDay(w.date)}{w.author ? ` · ${w.author}` : ''}</p><p className="text-[14px] whitespace-pre-line">{w.text}</p></div>
            ))}
          </div>
        </section>
      )}

      {c.checklist?.length > 0 && (
        <section className={card}>
          <p className={sec}>Checklist</p>
          {c.checklist.map((it, i) => (
            <div key={i} className="flex justify-between gap-2 text-[14px] py-0.5"><span>{it.text}</span>
              <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${it.done ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{it.done ? 'Done' : 'To do'}</span></div>
          ))}
        </section>
      )}

      {(c.parts?.length > 0 || c.materials?.length > 0) && (
        <section className={card}>
          <p className={sec}>Parts and materials</p>
          {c.parts.map((p, i) => <div key={i} className="flex justify-between text-[14px]"><span>{p.name}</span><span>{p.qty}{p.unit && p.unit !== 'each' ? ` ${p.unit}` : ''}</span></div>)}
          {c.materials.map((m, i) => <p key={`m${i}`} className="text-[13px] text-slate-500">{m}</p>)}
        </section>
      )}

      {r.photos.length > 0 && (
        <section className={card}>
          <p className={sec}>Photos</p>
          <div className="grid grid-cols-2 gap-2">
            {r.photos.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer" className="block aspect-[4/3] rounded-lg overflow-hidden bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </section>
      )}

      {c.still_to_do && (
        <section className={card}>
          <p className={sec}>Still to do</p>
          <p className="text-[14px] whitespace-pre-line">{c.still_to_do}</p>
        </section>
      )}

      {r.status === 'signed' && r.client_signature && (
        <section className={card}>
          <p className={sec}>Signatures</p>
          <div className="grid grid-cols-2 gap-3">
            {[[r.technician_name, r.technician_signature, r.technician_signed_at, 'For the company'], [r.client_name, r.client_signature, r.client_signed_at, 'Client']].map(([n, s, at, role]) => (
              <div key={role}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {s ? <img src={s} alt={`${role} signature`} className="h-14 object-contain" /> : <div className="h-14" />}
                <p className="text-[12.5px] border-t border-slate-300 pt-1">{role}: {n ?? ''}</p>
                <p className="text-[11.5px] text-slate-500">{when(at)}</p>
              </div>
            ))}
          </div>
          {r.client_comment && <p className="mt-2 text-[13px] text-slate-600">Your comment: {r.client_comment}</p>}
        </section>
      )}

      {v.can_respond && !done && (
        <section className={`${card} flex flex-col gap-3`}>
          <p className="text-[16px] font-semibold">{notHappy ? 'Tell us what is wrong' : 'Happy with the work? Please sign'}</p>
          {error && <p className="text-[13px] text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{error}</p>}
          <label className="text-[12.5px] font-medium text-slate-600">Your name
            <input className="mt-1 w-full h-12 px-3 border border-slate-300 rounded-xl text-[15px] bg-white" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
          </label>
          {!notHappy && <SignaturePad onChange={setSig} label="Sign here with your finger" />}
          <label className="text-[12.5px] font-medium text-slate-600">{notHappy ? 'What is wrong?' : 'Comment (optional)'}
            <textarea rows={notHappy ? 4 : 2} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-xl text-[14px] bg-white" value={comment} onChange={e => setComment(e.target.value)} maxLength={2000} />
          </label>
          {!notHappy && (
            <div>
              <p className="text-[12.5px] font-medium text-slate-600">How did we do? (optional)</p>
              <div className="flex gap-1 mt-1" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)}
                    className="w-11 h-11 flex items-center justify-center"><span className={`material-icons text-[30px] ${n <= rating ? 'text-amber-500' : 'text-slate-300'}`}>star</span></button>
                ))}
              </div>
            </div>
          )}
          {notHappy ? (
            <>
              <button type="button" disabled={busy || name.trim().length < 2 || comment.trim().length < 3} onClick={() => void send('not_happy')} className="h-12 rounded-xl bg-red-600 text-white text-[15px] font-semibold disabled:opacity-50">{busy ? 'Sending…' : 'Send'}</button>
              <button type="button" onClick={() => setNotHappy(false)} className="h-11 text-[14px] text-slate-500">Back</button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy || name.trim().length < 2 || !sig} onClick={() => void send('signed')} className="h-12 rounded-xl bg-[#1E3A5F] text-white text-[15px] font-semibold disabled:opacity-50">{busy ? 'Signing…' : 'Sign the report'}</button>
              <button type="button" onClick={() => setNotHappy(true)} className="h-11 rounded-xl border border-slate-300 text-[14px] text-slate-700">I’m not happy</button>
            </>
          )}
        </section>
      )}
      {done && <p className="text-[14px] text-emerald-800 bg-emerald-50 rounded-xl px-4 py-3">{done}</p>}
    </div>
  )
}
