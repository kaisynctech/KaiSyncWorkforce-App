'use client'

/** After releasing payslips: who could not be emailed (no email address, or the send failed). */

import Link from 'next/link'
import type { payslipEmailSummary } from '@/lib/payroll/payslip-email'

export type PayslipEmailSummary = ReturnType<typeof payslipEmailSummary>

/** emailFieldId: on a single payslip, point to the Email address field on the page instead of the profile. */
export function PayslipEmailNotice({ summary, onClose, emailFieldId }: { summary: PayslipEmailSummary | null; onClose?: () => void; emailFieldId?: string }) {
  if (!summary || (summary.noEmail.length === 0 && summary.failed.length === 0)) return null
  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 flex gap-3 items-start">
      <div className="flex-1 flex flex-col gap-1.5">
        {summary.noEmail.length > 0 && emailFieldId && (
          <div>
            <span className="font-semibold">No email address.</span>{' '}
            <button type="button" className="underline font-medium" onClick={() => {
              const el = document.getElementById(emailFieldId) as HTMLInputElement | null
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus()
            }}>Add it on the payslip</button>, then press Email payslip.
          </div>
        )}
        {summary.noEmail.length > 0 && !emailFieldId && (
          <div>
            <span className="font-semibold">No email address — open the payslip, add their email, then press Email payslip:</span>{' '}
            {summary.noEmail.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ', '}
                <Link href={`/dashboard/payroll/${p.paymentId}`} className="underline font-medium">{p.name}</Link>
              </span>
            ))}
          </div>
        )}
        {summary.failed.length > 0 && (
          <div>
            <span className="font-semibold">Could not email:</span>{' '}
            {summary.failed.map((p, i) => (
              <span key={`${p.id ?? 'x'}-${i}`}>{i > 0 && ', '}{p.name} ({p.message})</span>
            ))}
          </div>
        )}
      </div>
      {onClose && (
        <button type="button" aria-label="Dismiss" onClick={onClose} className="shrink-0 text-amber-900/70 hover:text-amber-900">
          <span className="material-icons text-[16px]">close</span>
        </button>
      )}
    </div>
  )
}
