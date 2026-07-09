import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'company-exports'
const EXPORT_EXPIRY_SECONDS = 86400 // 24 hours

const EXPORT_TABLES: { table: string; sensitive?: boolean }[] = [
  { table: 'employees', sensitive: true },
  { table: 'employee_salary_history', sensitive: true },
  { table: 'employee_documents' },
  { table: 'leave_requests' },
  { table: 'time_punches' },
  { table: 'labor_entries' },
  { table: 'payroll_period_locks', sensitive: true },
  { table: 'payment_approvals', sensitive: true },
  { table: 'jobs' },
  { table: 'job_cards' },
  { table: 'job_checklist_items' },
  { table: 'job_contractors' },
  { table: 'job_contractor_documents' },
  { table: 'job_documents' },
  { table: 'job_site_visits' },
  { table: 'job_feedback' },
  { table: 'clients' },
  { table: 'client_notes' },
  { table: 'client_payments', sensitive: true },
  { table: 'client_deals' },
  { table: 'client_deal_updates' },
  { table: 'contractors' },
  { table: 'contractor_documents' },
  { table: 'contractor_payouts', sensitive: true },
  { table: 'contractor_quotes' },
  { table: 'contractor_quote_items' },
  { table: 'contractor_banking_updates', sensitive: true },
  { table: 'contractor_compliance_packs' },
  { table: 'finance_invoices', sensitive: true },
  { table: 'finance_invoice_lines', sensitive: true },
  { table: 'supplier_invoices', sensitive: true },
  { table: 'finance_transactions', sensitive: true },
  { table: 'incident_reports' },
  { table: 'incident_comments' },
  { table: 'audit_events' },
  { table: 'company_settings' },
]

serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401 })
    }

    const { company_id, job_id } = await req.json()
    if (!company_id) {
      return new Response('company_id required', { status: 400 })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // Validate caller role (owner or hr only)
    const { data: roleData, error: roleError } = await userClient
      .rpc('get_my_role', { p_company_id: company_id })
    if (roleError || !['owner', 'hr'].includes(roleData)) {
      return new Response('Forbidden: owner or hr role required', { status: 403 })
    }

    // Create or reuse export job record
    let exportJobId = job_id
    if (!exportJobId) {
      const { data: userData } = await userClient.auth.getUser()
      const { data: jobData, error: jobError } = await adminClient
        .from('company_export_jobs')
        .insert({
          company_id,
          requested_by: userData.user?.id,
          status: 'processing',
        })
        .select('id')
        .single()
      if (jobError) throw new Error(`Failed to create export job: ${jobError.message}`)
      exportJobId = jobData.id
    }

    // Assemble export data
    const exportData: Record<string, unknown[]> = {}
    const recordCounts: Record<string, number> = {}
    const sensitiveTables: string[] = []

    for (const { table, sensitive } of EXPORT_TABLES) {
      const { data, error } = await adminClient
        .from(table)
        .select('*')
        .eq('company_id', company_id)
      if (error) {
        console.warn(`Skipping ${table}: ${error.message}`)
        continue
      }
      exportData[table] = data ?? []
      recordCounts[table] = data?.length ?? 0
      if (sensitive) sensitiveTables.push(table)
    }

    const exportDocument = {
      manifest: {
        format_version: '1.0',
        exported_at: new Date().toISOString(),
        company_id,
        export_job_id: exportJobId,
        record_counts: recordCounts,
        sensitive_tables: sensitiveTables,
        note: 'Sensitive tables contain salary, identity, banking, or financial data. Handle with care.',
        file_attachments: 'File attachments are not included in this export.',
      },
      data: exportData,
    }

    const json = JSON.stringify(exportDocument)

    // Gzip compress
    const compressed = await new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(json))
          controller.close()
        },
      }).pipeThrough(new CompressionStream('gzip'))
    ).arrayBuffer()

    // Upload to private bucket
    const storagePath = `${company_id}/${exportJobId}.json.gz`
    const { error: uploadError } = await adminClient.storage
      .from(BUCKET)
      .upload(storagePath, compressed, {
        contentType: 'application/gzip',
        upsert: true,
      })
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

    // Generate signed URL (24h)
    const { data: urlData, error: urlError } = await adminClient.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, EXPORT_EXPIRY_SECONDS)
    if (urlError) throw new Error(`Signed URL generation failed: ${urlError.message}`)

    const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_SECONDS * 1000).toISOString()

    // Update job to completed
    await adminClient
      .from('company_export_jobs')
      .update({
        status: 'completed',
        storage_path: storagePath,
        download_url: urlData.signedUrl,
        expires_at: expiresAt,
        record_counts: recordCounts,
        sensitive_tables: sensitiveTables,
        completed_at: new Date().toISOString(),
      })
      .eq('id', exportJobId)

    // Audit
    try {
      await adminClient.rpc('write_audit_event', {
        p_company_id: company_id,
        p_event_type: 'data_export_completed',
        p_table_name: 'company_export_jobs',
        p_record_id: exportJobId,
        p_payload: { job_id: exportJobId, record_counts: recordCounts },
      })
    } catch (auditErr) {
      console.warn('audit_write_failed:', auditErr)
    }

    return new Response(
      JSON.stringify({
        job_id: exportJobId,
        download_url: urlData.signedUrl,
        expires_at: expiresAt,
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (err) {
    console.error('generate-company-export error:', err)

    // Attempt to mark the job as failed if we have context
    try {
      const { company_id: cid, job_id: jid } = await (async () => {
        try { return await req.clone().json() } catch { return {} }
      })()
      if (jid) {
        const adminClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )
        await adminClient
          .from('company_export_jobs')
          .update({ status: 'failed', error_message: String(err) })
          .eq('id', jid)
      }
    } catch { /* best-effort */ }

    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
