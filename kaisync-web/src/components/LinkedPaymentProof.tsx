'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePortalMode } from '@/lib/client-portal/portal-mode'
import { moneyZAR } from '@/lib/client-portal/quotation'
import { paymentProofs, proofFileProblem, proofStatusWords, sendPaymentProof, type PaymentProof } from '@/lib/linked-extras'

const field = 'h-9 px-3 rounded-lg border border-divider bg-surface text-[13px] text-text-primary'

/** Proof of payment for one invoice from a linked contractor: send a file, see what was sent. */
export function LinkedPaymentProof({ invoiceId, invoiceNumber, balance, canSend }: {
  invoiceId: string
  invoiceNumber: string | null
  balance: number
  canSend: boolean
}) {
  const mode = usePortalMode()
  const [proofs, setProofs] = useState<PaymentProof[] | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : '')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const linked = mode.kind === 'linked' ? mode : null

  const companyId = linked?.companyId
  const linkId = linked?.linkId
  const load = useCallback(async () => {
    if (!companyId || !linkId) return
    const res = await paymentProofs(createClient(), companyId, linkId, invoiceId)
    setProofs(res.ok ? res.data : [])
    if (!res.ok) setError(res.message)
  }, [companyId, linkId, invoiceId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  if (!linked) return null

  async function send() {
    if (!linked) return
    const problem = proofFileProblem(file)
    if (problem) { setError(problem); return }
    const n = amount.trim() ? Number(amount.replace(/[\s,]/g, '')) : null
    if (n != null && (!Number.isFinite(n) || n <= 0)) { setError('The amount must be more than zero.'); return }
    setBusy(true)
    setError(null)
    const res = await sendPaymentProof(createClient(), {
      companyId: linked.companyId,
      linkId: linked.linkId,
      providerCompanyId: linked.session.company_id,
      clientId: linked.session.client_id,
      invoiceId,
      file: file!,
      amount: n,
      reference,
    })
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setSent(true)
    setFile(null)
    setReference('')
    await load()
  }

  return (
    <div className="space-y-3 text-[13px]">
      {proofs && proofs.length > 0 && (
        <ul className="space-y-1">
          {proofs.map(p => (
            <li key={p.id} className="flex flex-wrap gap-x-3">
              <span className="text-text-secondary">{new Date(p.submitted_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              <span className={p.status === 'accepted' ? 'text-success font-medium' : p.status === 'rejected' ? 'text-error font-medium' : 'text-warning font-medium'}>
                {proofStatusWords(p.status)}
              </span>
              {p.amount != null && <span className="text-text-primary">{moneyZAR(p.amount)}</span>}
              {p.reference && <span className="text-text-secondary">ref {p.reference}</span>}
              {p.review_notes && <span className="text-text-secondary">· {p.review_notes}</span>}
            </li>
          ))}
        </ul>
      )}
      {sent && <p className="text-success">Sent. {linked.providerName} will check it and record the payment.</p>}
      {canSend ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[11px] font-semibold text-text-secondary uppercase">File (PDF or photo)</span>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" onChange={e => { setFile(e.target.files?.[0] ?? null); setSent(false) }}
              className="block text-[12px] text-text-secondary" aria-label={`Proof of payment for invoice ${invoiceNumber ?? ''}`} />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-semibold text-text-secondary uppercase">Amount paid (R)</span>
            <input className={`${field} w-32`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="block text-[11px] font-semibold text-text-secondary uppercase">Payment reference</span>
            <input className={`${field} w-44`} value={reference} maxLength={120} onChange={e => setReference(e.target.value)} />
          </label>
          <button type="button" disabled={busy || !file} onClick={() => void send()} className="btn-primary h-9 px-3 text-[13px] disabled:opacity-50">
            {busy ? 'Sending…' : 'Send proof of payment'}
          </button>
        </div>
      ) : proofs && proofs.length === 0 ? (
        <p className="text-text-secondary">No proof of payment sent yet.</p>
      ) : null}
      {error && <p className="text-error">{error}</p>}
    </div>
  )
}
