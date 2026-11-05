'use client'

/**
 * Remittance advice for contractor payouts: a per-row "Remittance" button (opens the email dialog with
 * the contractor's email filled in) and a banner after "Mark paid" that emails everyone just paid.
 */

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { EmailDocumentDialog } from '@/components/money/EmailDocumentDialog'
import { sendDocumentEmail } from '@/lib/money/document-email'

export function PayoutRemittanceButton({ payoutId, companyId, contractorName, compact }: {
  payoutId: string; companyId: string; contractorName: string; compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    void createClient().from('contractor_payouts').select('contractor:contractors(email)').eq('id', payoutId).maybeSingle()
      .then(({ data }) => setEmail(((data as { contractor?: { email?: string | null } | null } | null)?.contractor?.email ?? '').trim()))
  }, [open, payoutId])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Email remittance advice"
        className={compact
          ? 'inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium text-primary bg-primary/10 hover:bg-primary/15'
          : 'btn-outlined h-9 px-3 text-[13px] flex items-center gap-1'}>
        <span className="material-icons text-[15px]">forward_to_inbox</span>Remittance
      </button>
      {open && email !== null && (
        <EmailDocumentDialog
          open
          onClose={() => { setOpen(false); setEmail(null) }}
          kind="remittance_contractor"
          docId={payoutId}
          companyId={companyId}
          title="Email remittance advice"
          description={`${contractorName} gets a note saying what you've paid them and when.`}
          defaultTo={email}
        />
      )}
    </>
  )
}

/** After marking payouts paid: offer to email each contractor their remittance advice in one go. */
export function RemittanceBatchBanner({ payouts, onDone }: {
  /** kind: contractor payout (default) or supplier bill. */
  payouts: { id: string; name: string; kind?: 'remittance_contractor' | 'remittance_supplier' }[]
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<{ sent: number; failed: string[] } | null>(null)
  if (payouts.length === 0) return null

  async function sendAll() {
    setBusy(true)
    const supabase = createClient()
    let sent = 0
    const failed: string[] = []
    for (const p of payouts) {
      const r = await sendDocumentEmail(supabase, { kind: p.kind ?? 'remittance_contractor', docId: p.id, recipient: '' })
      if (r.ok) sent++
      else failed.push(/email address/i.test(r.message) ? `${p.name} (no email)` : `${p.name} (${r.message})`)
    }
    setSummary({ sent, failed })
    setBusy(false)
  }

  const n = payouts.length
  return (
    <div className="mx-4 mt-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[12.5px] text-text-primary flex flex-wrap items-center gap-3">
      {summary ? (
        <span className="flex-1">
          Remittance advice emailed to {summary.sent} of {n}.
          {summary.failed.length > 0 && <span className="text-amber-800"> Not sent: {summary.failed.join(', ')}. Add their email on their profile, then use the Remittance button to send it.</span>}
        </span>
      ) : (
        <span className="flex-1">Paid {n === 1 ? payouts[0].name : `${n} people`}. Let {n === 1 ? 'them' : 'them all'} know by email?</span>
      )}
      {!summary && (
        <button type="button" disabled={busy} onClick={() => void sendAll()} className="btn-primary h-8 px-3 text-[12px] disabled:opacity-50">
          {busy ? 'Sending…' : `Email remittance${n === 1 ? '' : ` (${n})`}`}
        </button>
      )}
      <button type="button" onClick={onDone} className="text-text-secondary hover:text-text-primary" aria-label="Dismiss">
        <span className="material-icons text-[16px]">close</span>
      </button>
    </div>
  )
}
