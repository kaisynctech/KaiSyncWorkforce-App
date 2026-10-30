/**
 * Opening files in the private `workforce-media` bucket.
 *
 * Signed-in staff (Supabase account) can sign files of their own company directly.
 * Portal users have no account: workers signed in with a code, clients and contractors.
 * For them the server first checks each file against what that user may see and grants
 * read access for an hour (employee_grant_media_read / client_portal_grant_media_read /
 * contractor_portal_grant_media_read); then the file is signed as before.
 *
 * Granting never blocks: if it fails, signing is still attempted, so a screen behaves
 * exactly as it did before (CLIENT-AUDIT-001 Phase 0, stage B1).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getCodeSession } from '@/lib/auth/code-session'
import { getClientPortalSession } from '@/lib/client-portal/session'
import { getContractorPortalSession } from '@/lib/contractor-portal/session'

export const WORKFORCE_MEDIA_BUCKET = 'workforce-media'

export type MediaReader =
  | { kind: 'employee'; companyId: string; employeeId: string; sessionToken: string }
  | { kind: 'client'; companyCode: string; clientCode: string }
  | { kind: 'contractor'; companyCode: string; contractorCode: string }
  | { kind: 'link'; companyId: string; linkId: string }

/** Set while a linked company's view of another company's work is open (see portal-mode.tsx). */
let linkedReader: { companyId: string; linkId: string } | null = null
export function setLinkedMediaReader(reader: { companyId: string; linkId: string } | null): void {
  linkedReader = reader
}

/** Which portal user (if any) is reading files on this page. Staff accounts return null. */
export function currentMediaReader(pathname?: string): MediaReader | null {
  if (typeof window === 'undefined') return null
  const path = pathname ?? window.location.pathname
  if (linkedReader && path.startsWith(`/dashboard/linked-companies/${linkedReader.linkId}`)) {
    return { kind: 'link', companyId: linkedReader.companyId, linkId: linkedReader.linkId }
  }
  if (path.startsWith('/client-portal')) {
    const s = getClientPortalSession()
    return s ? { kind: 'client', companyCode: s.company_code, clientCode: s.client_code } : null
  }
  if (path.startsWith('/contractor-portal')) {
    const s = getContractorPortalSession()
    return s ? { kind: 'contractor', companyCode: s.company_code, contractorCode: s.contractor_code } : null
  }
  const cs = getCodeSession()
  if (cs?.session_token && cs.employee_id && cs.company_id) {
    return { kind: 'employee', companyId: cs.company_id, employeeId: cs.employee_id, sessionToken: cs.session_token }
  }
  return null
}

function isStoragePath(value: string): boolean {
  return value.trim() !== '' && !/^https?:\/\//i.test(value.trim())
}

const WORKFORCE_MEDIA_URL_MARKER = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/workforce-media\/(.+)$/i

/**
 * The storage path for a stored value: a plain path is returned as is; an old
 * workforce-media link (public / signed / authenticated form, as saved by earlier
 * versions) is turned back into its path, because the bucket is private and those
 * links no longer open. Any other web link returns null and is used unchanged.
 */
export function workforceMediaPath(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  if (isStoragePath(raw)) return raw.replace(/^\/+/, '')
  try {
    const m = new URL(raw).pathname.match(WORKFORCE_MEDIA_URL_MARKER)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

/** Ask the server for read access to these files. Never throws. */
export async function grantMediaRead(
  supabase: SupabaseClient,
  paths: string[],
  reader: MediaReader | null = currentMediaReader(),
): Promise<void> {
  if (!reader) return
  const unique = [...new Set(paths.map(p => workforceMediaPath(p)).filter((p): p is string => !!p))]
  if (unique.length === 0) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)
  try {
    for (let i = 0; i < unique.length; i += 200) {
      const batch = unique.slice(i, i + 200)
      if (reader.kind === 'employee') {
        await rpc('employee_grant_media_read', {
          p_company_id: reader.companyId,
          p_employee_id: reader.employeeId,
          p_paths: batch,
          p_session_token: reader.sessionToken,
        })
      } else if (reader.kind === 'client') {
        await rpc('client_portal_grant_media_read', {
          p_company_code: reader.companyCode,
          p_client_code: reader.clientCode,
          p_paths: batch,
        })
      } else if (reader.kind === 'link') {
        await rpc('linked_grant_media_read', {
          p_company_id: reader.companyId,
          p_link_id: reader.linkId,
          p_paths: batch,
        })
      } else {
        await rpc('contractor_portal_grant_media_read', {
          p_company_code: reader.companyCode,
          p_contractor_code: reader.contractorCode,
          p_paths: batch,
        })
      }
    }
  } catch {
    /* signing below still runs; behaviour as before */
  }
}

/** Signed links for several storage paths or old workforce-media links (other web links are returned unchanged). */
export async function signWorkforceMediaMany(
  supabase: SupabaseClient,
  paths: string[],
  expiresIn = 3600,
  reader: MediaReader | null = currentMediaReader(),
): Promise<Map<string, string>> {
  // Result is keyed by the value as given (trimmed), so callers look up what they passed in.
  const out = new Map<string, string>()
  const pathFor = new Map<string, string>()
  for (const p of paths) {
    const key = (p ?? '').trim()
    if (!key) continue
    const path = workforceMediaPath(key)
    if (path) pathFor.set(key, path)
    else out.set(key, key)
  }
  const storagePaths = [...new Set(pathFor.values())]
  if (storagePaths.length === 0) return out
  await grantMediaRead(supabase, storagePaths, reader)
  const signed = new Map<string, string>()
  await Promise.all(storagePaths.map(async (name) => {
    const { data } = await supabase.storage.from(WORKFORCE_MEDIA_BUCKET).createSignedUrl(name, expiresIn)
    if (data?.signedUrl) signed.set(name, data.signedUrl)
  }))
  for (const [key, path] of pathFor) {
    const url = signed.get(path)
    if (url) out.set(key, url)
  }
  return out
}

/** Signed link for one storage path, or null. */
export async function signWorkforceMedia(
  supabase: SupabaseClient,
  path: string | null | undefined,
  expiresIn = 3600,
  reader: MediaReader | null = currentMediaReader(),
): Promise<string | null> {
  if (!path) return null
  const map = await signWorkforceMediaMany(supabase, [path], expiresIn, reader)
  return map.get(path.trim()) ?? null
}
