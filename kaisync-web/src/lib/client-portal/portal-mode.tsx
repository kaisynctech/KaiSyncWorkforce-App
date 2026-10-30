'use client'

/**
 * The client-portal views run in two places:
 *  - the client portal itself (a client signed in with company + client code), and
 *  - inside a linked customer company's own dashboard (Linked companies → provider), where
 *    office staff see the provider's work for them through the company link.
 * The views read the mode from this context; the data layer (api.ts) routes each call to the
 * code-based or link-based database function from the session it is given.
 */

import { createContext, useContext, type ReactNode } from 'react'
import type { ClientPortalSession } from '@/lib/client-portal/session'
import { useRequireClientPortalSession } from '@/lib/client-portal/use-session'

export type PortalMode =
  | { kind: 'portal' }
  | {
      kind: 'linked'
      /** The signed-in user's own company (the customer). */
      companyId: string
      linkId: string
      /** The provider company's name, e.g. "Ironvale Construction". */
      providerName: string
      session: ClientPortalSession
      /** Part B switches these on: accepting quotes, messages, uploads. */
      canAct: boolean
      /** Changing details and banking: owner, HR or admin only. */
      canEditDetails: boolean
    }

const PortalModeContext = createContext<PortalMode>({ kind: 'portal' })

export function PortalModeProvider({ mode, children }: { mode: PortalMode; children: ReactNode }) {
  return <PortalModeContext.Provider value={mode}>{children}</PortalModeContext.Provider>
}

export function usePortalMode(): PortalMode {
  return useContext(PortalModeContext)
}

/** Marker in company_code that tells the data layer to use the link functions. */
export const LINK_CODE_PREFIX = '@LINK:'

export function linkedCompanyCode(companyId: string, linkId: string): string {
  return `${LINK_CODE_PREFIX}${companyId}:${linkId}`
}

/** companyId + linkId from a linked company_code, or null for a normal portal code. */
export function parseLinkedCompanyCode(code: string | null | undefined): { companyId: string; linkId: string } | null {
  const raw = (code ?? '').trim()
  if (!raw.toUpperCase().startsWith(LINK_CODE_PREFIX)) return null
  const [companyId, linkId] = raw.slice(LINK_CODE_PREFIX.length).split(':')
  if (!companyId || !linkId) return null
  return { companyId: companyId.toLowerCase(), linkId: linkId.toLowerCase() }
}

/** A session object the portal views can use, for a link. */
export function linkedSession(params: {
  companyId: string
  linkId: string
  providerCompanyId: string
  clientId: string
  clientName: string
}): ClientPortalSession {
  return {
    client_id: params.clientId,
    company_id: params.providerCompanyId,
    client_name: params.clientName,
    company_code: linkedCompanyCode(params.companyId, params.linkId),
    client_code: '',
  }
}

/**
 * Where a portal page lives in this mode. `path` is the portal path without the
 * /client-portal prefix: '/home?tab=jobs', '/jobs/<id>', '/projects/<id>?messages=1'.
 */
export function portalHref(mode: PortalMode, path: string): string {
  if (mode.kind === 'portal') return `/client-portal${path}`
  const base = `/dashboard/linked-companies/${mode.linkId}`
  if (path.startsWith('/home')) return `${base}${path.slice('/home'.length)}`
  return `${base}${path}`
}

/** The session for the current mode: the link's, or the signed-in portal client's (redirects if none). */
export function usePortalSession(): { session: ClientPortalSession | null; ready: boolean } {
  const mode = usePortalMode()
  const portal = useRequireClientPortalSession(mode.kind === 'portal')
  if (mode.kind === 'linked') return { session: mode.session, ready: true }
  return portal
}

/** True when the view may show buttons that change things (always in the portal). */
export function usePortalCanAct(): boolean {
  const mode = usePortalMode()
  return mode.kind === 'portal' || mode.canAct
}


/** portalHref bound to the current mode, for links inside the portal views. */
export function usePortalHref(): (path: string) => string {
  const mode = usePortalMode()
  return (path: string) => portalHref(mode, path)
}
