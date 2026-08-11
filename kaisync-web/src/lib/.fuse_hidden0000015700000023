import type { SupabaseClient } from '@supabase/supabase-js'
import { prepareMediaUpload, consumeMediaUpload } from '@/lib/job-media'

/** MAUI path: incident_reports/{company}/{employee}/{guid}{ext} */
export function incidentPhotoStoragePath(
  companyId: string,
  employeeId: string,
  ext: string,
): string {
  const safeExt = (ext || 'jpg').replace(/^\./, '').toLowerCase()
  return `incident_reports/${companyId}/${employeeId}/${crypto.randomUUID()}.${safeExt}`
}

/**
 * Extract storage object path from a relative path or absolute public URL.
 * Handles MAUI public URLs and legacy web `incident-photos/` paths.
 */
export function incidentStorageObjectPath(stored: string): string | null {
  const raw = stored.trim()
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\//, '')

  try {
    const url = new URL(raw)
    const marker = '/object/public/workforce-media/'
    const idx = url.pathname.indexOf(marker)
    if (idx >= 0) return decodeURIComponent(url.pathname.slice(idx + marker.length))
    const signed = '/object/sign/workforce-media/'
    const sidx = url.pathname.indexOf(signed)
    if (sidx >= 0) {
      const rest = url.pathname.slice(sidx + signed.length)
      return decodeURIComponent(rest.split('?')[0] ?? rest)
    }
  } catch {
    /* ignore */
  }
  return null
}

export async function resolveIncidentPhotoUrl(
  supabase: SupabaseClient,
  stored: string,
  expiresIn = 3600,
): Promise<string | null> {
  if (/^https?:\/\//i.test(stored) && !stored.includes('/workforce-media/')) {
    return stored
  }
  const path = incidentStorageObjectPath(stored)
  if (!path) return /^https?:\/\//i.test(stored) ? stored : null
  const { data } = await supabase.storage.from('workforce-media').createSignedUrl(path, expiresIn)
  return data?.signedUrl ?? (/^https?:\/\//i.test(stored) ? stored : null)
}

/** Upload one incident photo; returns relative storage path (or null on soft failure). */
export async function uploadIncidentPhoto(params: {
  supabase: SupabaseClient
  companyId: string
  employeeId: string
  file: File | Blob
  fileName?: string
  sessionToken: string | null
  softFail?: boolean
}): Promise<string | null> {
  const {
    supabase, companyId, employeeId, file, sessionToken, softFail = false,
  } = params
  const name = params.fileName
    ?? (file instanceof File ? file.name : 'photo.jpg')
  const ext = name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = incidentPhotoStoragePath(companyId, employeeId, ext)
  const contentType = file instanceof File ? file.type : (file.type || 'image/jpeg')

  try {
    await prepareMediaUpload(supabase, companyId, employeeId, path, 'incident_photo', sessionToken)
    const { error: upErr } = await supabase.storage
      .from('workforce-media')
      .upload(path, file, { upsert: true, contentType: contentType || undefined })
    if (upErr) {
      if (softFail) return null
      throw upErr
    }
    await consumeMediaUpload(supabase, companyId, employeeId, path, sessionToken)
    return path
  } catch (e) {
    if (softFail) return null
    throw e
  }
}
