import type { SupabaseClient } from '@supabase/supabase-js'
import { prepareMediaUpload, consumeMediaUpload } from '@/lib/job-media'
import {
  employeeDocumentStoragePath,
  leaveAttachmentStoragePath,
} from '@/lib/employee-document-types'

/**
 * Upload leave attachment. MAUI swallows upload failure → null URL.
 * Returns storage path or null on failure.
 */
export async function uploadLeaveAttachment(params: {
  supabase: SupabaseClient
  companyId: string
  employeeId: string
  file: File
  sessionToken: string | null
}): Promise<string | null> {
  const { supabase, companyId, employeeId, file, sessionToken } = params
  try {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
    const path = leaveAttachmentStoragePath(employeeId, ext)
    await prepareMediaUpload(supabase, companyId, employeeId, path, 'leave_attachment', sessionToken)
    const { error: upErr } = await supabase.storage
      .from('workforce-media')
      .upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (upErr) return null
    await consumeMediaUpload(supabase, companyId, employeeId, path, sessionToken)
    return path
  } catch {
    return null
  }
}

export async function uploadEmployeeDocumentFile(params: {
  supabase: SupabaseClient
  companyId: string
  employeeId: string
  file: File
  sessionToken: string | null
}): Promise<string> {
  const { supabase, companyId, employeeId, file, sessionToken } = params
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
  const path = employeeDocumentStoragePath(companyId, employeeId, ext)
  await prepareMediaUpload(supabase, companyId, employeeId, path, 'employee_document', sessionToken)
  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (upErr) throw upErr
  await consumeMediaUpload(supabase, companyId, employeeId, path, sessionToken)
  return path
}

/** Form photo field — stored under employee_documents (allowed prepare folder). */
export async function uploadFormPhoto(params: {
  supabase: SupabaseClient
  companyId: string
  employeeId: string
  file: File
  sessionToken: string | null
}): Promise<string> {
  const { supabase, companyId, employeeId, file, sessionToken } = params
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = employeeDocumentStoragePath(companyId, employeeId, ext)
  await prepareMediaUpload(supabase, companyId, employeeId, path, 'form_photo', sessionToken)
  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' })
  if (upErr) throw upErr
  await consumeMediaUpload(supabase, companyId, employeeId, path, sessionToken)
  return path
}
