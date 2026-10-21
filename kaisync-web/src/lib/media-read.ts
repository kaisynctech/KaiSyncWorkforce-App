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

/** Which portal user (if any) is reading files on this page. Staff accounts return null. */
export function currentMediaReader(pathname?: string): MediaReader | null {
  if (typeof window === 'undefined') return null
  const path = pathname ?? window.location.pathname
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

/** Ask the server for read access to these files. Never throws. */
export async function grantMediaRead(
  supabase: SupabaseClient,
  paths: string[],
  reader: MediaReader | null = currentMediaReader(),
): Promise<void> {
  if (!reader) return
  const unique = [...new Set(paths.map(p => p.trim()).filter(isStoragePath))]
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

/** Signed links for several storage paths (http(s) links are returned unchanged). */
export async function signWorkforceMediaMany(
  supabase: SupabaseClient,
  paths: string[],
  expiresIn = 3600,
  reader: MediaReader | null = currentMediaReader(),
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const storagePaths = [...new Set(paths.map(p => p.trim()).filter(isStoragePath))]
  for (const p of paths) if (p && !isStoragePath(p)) out.set(p, p.trim())
  if (storagePaths.length === 0) return out
  await grantMediaRead(supabase, storagePaths, reader)
  await Promise.all(storagePaths.map(async (name) => {
    const { data } = await supabase.storage.from(WORKFORCE_MEDIA_BUCKET).createSignedUrl(name, expiresIn)
    if (data?.signedUrl) out.set(name, data.signedUrl)
  }))
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
