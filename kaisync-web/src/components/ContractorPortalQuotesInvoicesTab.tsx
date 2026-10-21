'use client'

import { useState } from 'react'
import { ContractorPortalPaymentsTab } from '@/components/ContractorPortalPaymentsTab'
import { ContractorPortalQuotesTab } from '@/components/ContractorPortalQuotesTab'
import type { ContractorPortalSession } from '@/lib/contractor-portal/session'
import type { ContractorJob, ContractorPayout } from '@/lib/contractor-portal/types'

type Section = 'quotes' | 'invoices'

/** "Quotes & Invoices": the quotes a contractor sends us and the invoices they submit. */
export function ContractorPortalQuotesInvoicesTab({
  session,
  payouts,
  jobs,
  initialSection = 'quotes',
  onRefreshPayouts,
  onError,
}: {
  session: ContractorPortalSession
  payouts: ContractorPayout[]
  jobs: ContractorJob[]
  initialSection?: Section
  onRefreshPayouts: () => Promise<void>
  onError: (msg: string | null) => void
}) {
  const [section, setSection] = useState<Section>(initialSection)
  return (
    <div className="space-y-4">
      <div className="bg-surface-elevated inline-flex gap-1 p-1 rounded-xl">
        {(['quotes', 'invoices'] as Section[]).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={`text-[13px] font-semibold px-4 py-1.5 rounded-lg ${
              section === s ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {s === 'quotes' ? 'Quotes' : 'Invoices'}
          </button>
        ))}
      </div>
      {section === 'quotes' ? (
        <ContractorPortalQuotesTab session={session} onError={onError} />
      ) : (
        <ContractorPortalPaymentsTab
          session={session}
          payouts={payouts}
          jobs={jobs}
          onError={onError}
          onRefresh={onRefreshPayouts}
        />
      )}
    </div>
  )
}
