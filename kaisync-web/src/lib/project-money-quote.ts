/**
 * Bridge project quotation (client_deals + project_quotation_lines)
 * ↔ Money commercial_quotes. Wave 2 — no new tables.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendProjectQuotation, type ProjectResult } from '@/lib/projects'

export type MoneyQuoteLink = {
  id: string
  quote_number: string | null
  title: string
  status: string
  total_amount: number
}

export async function findMoneyQuoteForProject(
  supabase: SupabaseClient,
  opts: { companyId: string; projectId: string },
): Promise<MoneyQuoteLink | null> {
  const { data } = await supabase
    .from('commercial_quotes')
    .select('id, quote_number, title, status, total_amount')
    .eq('company_id', opts.companyId)
    .eq('deal_id', opts.projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as MoneyQuoteLink | null) ?? null
}

export type EnsureMoneyQuoteInput = {
  companyId: string
  projectId: string
  employeeId: string
  clientId?: string | null
  title: string
  scopeNotes?: string | null
  validUntil?: string | null
  /** When true, refresh commercial lines from project_quotation_lines if quote is still draft. */
  syncLinesFromProject?: boolean
}

/**
 * Find or create a commercial quote for this project, copying project quotation lines.
 */
export async function ensureMoneyQuoteForProject(
  supabase: SupabaseClient,
  input: EnsureMoneyQuoteInput,
): Promise<ProjectResult<MoneyQuoteLink>> {
  try {
    const existing = await findMoneyQuoteForProject(supabase, {
      companyId: input.companyId,
      projectId: input.projectId,
    })

    const { data: projLines } = await supabase
      .from('project_quotation_lines')
      .select('description, quantity, unit_price, line_no')
      .eq('deal_id', input.projectId)
      .order('line_no')

    const lines = (projLines ?? []) as {
      description: string
      quantity: number
      unit_price: number
      line_no: number
    }[]

    const subtotal = lines.reduce(
      (s, l) => s + Number(l.quantity ?? 0) * Number(l.unit_price ?? 0),
      0,
    )
    const vat = subtotal * 0.15
    const total = subtotal + vat

    if (existing) {
      if (input.syncLinesFromProject && existing.status === 'draft' && lines.length > 0) {
        await replaceCommercialLines(supabase, {
          companyId: input.companyId,
          quoteId: existing.id,
          lines,
        })
        await supabase
          .from('commercial_quotes')
          .update({
            subtotal,
            vat_amount: vat,
            total_amount: total,
            scope_notes: input.scopeNotes ?? null,
            valid_until: input.validUntil || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .eq('company_id', input.companyId)
        return {
          ok: true,
          data: { ...existing, total_amount: total },
        }
      }
      return { ok: true, data: existing }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: numData, error: numErr } = await (supabase.rpc as any)(
      'generate_quote_number',
      { p_company_id: input.companyId },
    )
    if (numErr) return { ok: false, message: numErr.message }

    const { data: quote, error: insErr } = await supabase
      .from('commercial_quotes')
      .insert({
        company_id: input.companyId,
        quote_number: (numData as string | null) ?? null,
        client_id: input.clientId || null,
        deal_id: input.projectId,
        title: input.title.trim() || 'Project quotation',
        status: 'draft',
        valid_until: input.validUntil || null,
        scope_notes: input.scopeNotes ?? null,
        subtotal,
        vat_amount: vat,
        total_amount: total,
        created_by: input.employeeId,
      })
      .select('id, quote_number, title, status, total_amount')
      .single()

    if (insErr || !quote) {
      return { ok: false, message: insErr?.message ?? 'Failed to create Money quote.' }
    }

    const link = quote as MoneyQuoteLink
    if (lines.length > 0) {
      const lineRes = await replaceCommercialLines(supabase, {
        companyId: input.companyId,
        quoteId: link.id,
        lines,
      })
      if (!lineRes.ok) return lineRes
    }

    return { ok: true, data: link }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

async function replaceCommercialLines(
  supabase: SupabaseClient,
  opts: {
    companyId: string
    quoteId: string
    lines: { description: string; quantity: number; unit_price: number }[]
  },
): Promise<ProjectResult<void>> {
  await supabase.from('commercial_quote_lines').delete().eq('quote_id', opts.quoteId)
  const usable = opts.lines.filter(l => (l.description ?? '').trim())
  if (usable.length === 0) return { ok: true, data: undefined }

  const { error } = await supabase.from('commercial_quote_lines').insert(
    usable.map((l, i) => {
      const qty = Number(l.quantity) || 1
      const price = Number(l.unit_price) || 0
      const sell = qty * price
      return {
        company_id: opts.companyId,
        quote_id: opts.quoteId,
        sort_order: i,
        description: l.description.trim(),
        quantity: qty,
        unit: 'each',
        unit_sell_price: price,
        cost_price: 0,
        markup_percent: 0,
        subtotal_cost: 0,
        subtotal_sell: sell,
        vat_rate: 0.15,
        vat_amount: sell * 0.15,
        line_total: sell * 1.15,
        is_optional: false,
        is_excluded: false,
        item_type: 'material',
      }
    }),
  )
  if (error) return { ok: false, message: error.message }
  return { ok: true, data: undefined }
}

/**
 * Ensure Money quote exists, mark it sent, and stamp project quotation_sent_at.
 */
export async function sendProjectQuotationViaMoneyQuote(
  supabase: SupabaseClient,
  input: EnsureMoneyQuoteInput & { previousStatus?: string | null },
): Promise<ProjectResult<{ moneyQuoteId: string }>> {
  const ensured = await ensureMoneyQuoteForProject(supabase, {
    ...input,
    syncLinesFromProject: true,
  })
  if (!ensured.ok) return ensured

  const now = new Date().toISOString()
  const { error: qErr } = await supabase
    .from('commercial_quotes')
    .update({
      status: 'sent',
      sent_at: now,
      updated_at: now,
    })
    .eq('id', ensured.data.id)
    .eq('company_id', input.companyId)

  if (qErr) return { ok: false, message: qErr.message }

  const dealRes = await sendProjectQuotation(supabase, {
    companyId: input.companyId,
    projectId: input.projectId,
    previousStatus: input.previousStatus,
  })
  if (!dealRes.ok) return dealRes

  return { ok: true, data: { moneyQuoteId: ensured.data.id } }
}
