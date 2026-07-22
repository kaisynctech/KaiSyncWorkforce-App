import type { SupabaseClient } from '@supabase/supabase-js'

/** MAUI paths: job_photos/{company}/{job}/{before|after}/{guid}.ext */
export function jobPhotoStoragePath(
  companyId: string,
  jobId: string,
  phase: 'before' | 'after',
  ext: string,
): string {
  return `job_photos/${companyId}/${jobId}/${phase}/${crypto.randomUUID()}.${ext}`
}

/** MAUI paths: job_documents/{company}/{job}/{guid}.ext */
export function jobDocumentStoragePath(companyId: string, jobId: string, ext: string): string {
  return `job_documents/${companyId}/${jobId}/${crypto.randomUUID()}.${ext}`
}

export async function prepareMediaUpload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  companyId: string,
  employeeId: string,
  storagePath: string,
  purpose: string,
  sessionToken: string | null,
): Promise<void> {
  try {
    await supabase.rpc('employee_prepare_media_upload', {
      p_company_id: companyId,
      p_employee_id: employeeId,
      p_storage_path: storagePath,
      p_purpose: purpose,
      p_session_token: sessionToken,
    })
  } catch {
    // JWT sessions may not need prepare — non-fatal if RPC rejects
  }
}

export async function consumeMediaUpload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  companyId: string,
  employeeId: string,
  storagePath: string,
  sessionToken: string | null,
): Promise<void> {
  try {
    await supabase.rpc('employee_consume_media_upload', {
      p_company_id: companyId,
      p_employee_id: employeeId,
      p_storage_path: storagePath,
      p_session_token: sessionToken,
    })
  } catch {
    // non-fatal
  }
}

export async function uploadJobPhoto(params: {
  supabase: SupabaseClient
  companyId: string
  employeeId: string
  jobId: string
  phase: 'before' | 'after'
  file: File
  sessionToken: string | null
}): Promise<string> {
  const { supabase, companyId, employeeId, jobId, phase, file, sessionToken } = params
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = jobPhotoStoragePath(companyId, jobId, phase, ext)

  await prepareMediaUpload(supabase, companyId, employeeId, path, 'job_photo', sessionToken)

  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(path, file, { upsert: true, contentType: file.type })
  if (upErr) throw upErr

  await consumeMediaUpload(supabase, companyId, employeeId, path, sessionToken)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: appendErr } = await (supabase.rpc as any)('employee_append_job_photo', {
    p_company_id: companyId,
    p_employee_id: employeeId,
    p_job_id: jobId,
    p_phase: phase,
    p_photo_url: path,
    p_session_token: sessionToken,
  })
  if (appendErr) throw appendErr
  return path
}

export async function uploadJobDocument(params: {
  supabase: SupabaseClient
  companyId: string
  employeeId: string
  jobId: string
  file: File
  documentName: string
  documentType?: string
  sessionToken: string | null
}): Promise<void> {
  const {
    supabase, companyId, employeeId, jobId, file, documentName, documentType = 'other', sessionToken,
  } = params
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
  const path = jobDocumentStoragePath(companyId, jobId, ext)

  await prepareMediaUpload(supabase, companyId, employeeId, path, 'job_document', sessionToken)

  const { error: upErr } = await supabase.storage
    .from('workforce-media')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (upErr) throw upErr

  await consumeMediaUpload(supabase, companyId, employeeId, path, sessionToken)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertErr } = await (supabase.rpc as any)('employee_insert_job_document', {
    p_company_id: companyId,
    p_employee_id: employeeId,
    p_job_id: jobId,
    p_document_name: documentName,
    p_document_type: documentType,
    p_file_url: path,
    p_session_token: sessionToken,
  })
  if (insertErr) throw insertErr
}
