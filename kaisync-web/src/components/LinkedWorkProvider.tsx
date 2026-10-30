'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { listLinks } from '@/lib/company-links'
import { getProfile } from '@/lib/client-portal/api'
import { linkedCompanyCode, linkedSession, PortalModeProvider, type PortalMode } from '@/lib/client-portal/portal-mode'
import { setLinkedMediaReader } from '@/lib/media-read'

/**
 * Opens a provider company's work for us (Linked companies → provider) with the same views the
 * client portal uses. Only for an active link where we are the customer; the database checks
 * the link and the signed-in person on every call.
 */
export function LinkedWorkProvider({ children }: { children: ReactNode }) {
  const params = useParams<{ linkId: string }>()
  const linkId = params.linkId
  const [mode, setMode] = useState<PortalMode | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const member = await resolveCurrentMember(supabase)
      if (!member) { if (!cancelled) setError('Your account is not linked to a company.'); return }
      const links = await listLinks(supabase, member.companyId)
      if (!links.ok) { if (!cancelled) setError(links.message); return }
      const link = links.data.find(l => l.id === linkId && l.my_role === 'customer' && l.status === 'active')
      if (!link) { if (!cancelled) setError('This company is not linked to you as your contractor.'); return }
      let clientId = ''
      let clientName = link.my_record_name ?? ''
      try {
        const profile = await getProfile(linkedCompanyCode(member.companyId, link.id), '')
        clientId = profile?.id ?? ''
        clientName = profile?.name || clientName
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open this company.')
        return
      }
      // Details and banking: owner, HR or admin (the database checks this again).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: role } = await (supabase.rpc as any)('get_my_role', { p_company_id: member.companyId })
      const canEditDetails = ['owner', 'admin', 'hr', 'hr_admin'].includes(String(role ?? ''))
      setLinkedMediaReader({ companyId: member.companyId, linkId: link.id })
      if (cancelled) return
      setMode({
        kind: 'linked',
        companyId: member.companyId,
        linkId: link.id,
        providerName: link.other.name,
        session: linkedSession({
          companyId: member.companyId,
          linkId: link.id,
          providerCompanyId: link.other.id,
          clientId,
          clientName,
        }),
        canAct: true,
        canEditDetails,
      })
    })()
    return () => { cancelled = true; setLinkedMediaReader(null) }
  }, [linkId])

  if (error) {
    return (
      <div className="p-6 space-y-2 text-[13px]">
        <p className="text-error">{error}</p>
        <Link href="/dashboard/linked-companies" className="text-primary hover:underline">Back to linked companies</Link>
      </div>
    )
  }
  if (!mode) return <p className="p-6 text-[13px] text-text-secondary">Loading…</p>
  return <PortalModeProvider mode={mode}>{children}</PortalModeProvider>
}
