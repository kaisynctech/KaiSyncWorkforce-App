'use client'

import { useMemo, useState } from 'react'
import { ContractorPortalComplianceTab, type ComplianceSource } from '@/components/ContractorPortalComplianceTab'
import {
  getPartyCompliancePack,
  getPartyComplianceDocuments,
  uploadPartyComplianceDocument,
} from '@/lib/client-portal/api'
import type { ClientPortalSession } from '@/lib/client-portal/session'
import { CLIENT_DOC_TYPES } from '@/lib/contractor-portal/types'

/** The client portal's Compliance tab: the same screen and system the contractor portal uses. */
export function ClientPortalCompliance({ session }: { session: ClientPortalSession }) {
  const [error, setError] = useState<string | null>(null)
  const source = useMemo<ComplianceSource>(() => ({
    key: `client:${session.client_id}:${session.company_id}`,
    getDocuments: () => getPartyComplianceDocuments(session.company_code, session.client_code),
    getPack: () => getPartyCompliancePack(session.company_code, session.client_code),
    upload: p => uploadPartyComplianceDocument({
      companyCode: session.company_code,
      clientCode: session.client_code,
      companyId: session.company_id,
      clientId: session.client_id,
      ...p,
    }),
    docTypes: CLIENT_DOC_TYPES,
  }), [session.client_id, session.company_id, session.company_code, session.client_code])

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-error-dark text-error rounded-lg px-3 py-2 text-[13px]">{error}</div>
      )}
      <ContractorPortalComplianceTab source={source} onError={setError} />
    </div>
  )
}
