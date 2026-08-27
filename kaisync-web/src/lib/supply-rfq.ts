/**
 * Supply RFQ helpers — create RFQs from commercial quotes (Wave 2).
 * Uses public.rfqs / rfq_lines (not quote_rfqs).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type SupplyRfqResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export type CreateSupplyRfqFromQuoteInput = {
  companyId: string
  quoteId: string
  employeeId?: string | null
  /** Prefer opening an existing RFQ for this quote instead of creating a duplicate. */
  reuseExisting?: boolean
  title?: string | null
  dealId?: string | null
  status?: string
}

/**
 * Create (or reuse) a Supply RFQ linked to a commercial quote, copying quote lines.
 */
export async function createSupplyRfqFromQuote(
  supabase: SupabaseClient,
  input: CreateSupplyRfqFromQuoteInput,
): Promise<SupplyRfqResult<{ id: string; reused: boolean }>> {
  try {
    const reuse = input.reuseExisting !== false

    if (reuse) {
      const { data: existing } = await supabase
        .from('rfqs')
        .select('id')
        .eq('company_id', input.companyId)
        .eq('quote_id', input.quoteId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existing?.id) {
        return { ok: true, data: { id: existing.id as string, reused: true } }
      }
    }

    const { data: quote, error: qErr } = await supabase
      .from('commercial_quotes')
      .select('id, title, quote_number, deal_id, client_id')
      .eq('id', input.quoteId)
      .eq('company_id', input.companyId)
      .maybeSingle()
    if (qErr) return { ok: false, message: qErr.message }
    if (!quote) return { ok: false, message: 'Quote not found.' }

    const q = quote as {
      id: string
      title: string
      quote_number: string | null
      deal_id: string | null
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: numData } = await (supabase.rpc as any)('generate_rfq_number', {
      p_company_id: input.companyId,
    })

    const title =
      input.title?.trim() ||
      `RFQ — ${q.quote_number ? `${q.quote_number} ` : ''}${q.title || 'Quote'}`.trim()

    const { data: rfq, error: insErr } = await supabase
      .from('rfqs')
      .insert({
        company_id: input.companyId,
        quote_id: input.quoteId,
        deal_id: input.dealId ?? q.deal_id ?? null,
        title,
        status: input.status ?? 'draft',
        rfq_number: (numData as string | null) ?? null,
        created_by: input.employeeId ?? null,
      })
      .select('id')
      .single()

    if (insErr || !rfq) {
      return { ok: false, message: insErr?.message ?? 'Failed to create RFQ.' }
    }

    const rfqId = (rfq as { id: string }).id

    const { data: qLines } = await supabase
      .from('commercial_quote_lines')
      .select('id, description, quantity, unit, sort_order')
      .eq('quote_id', input.quoteId)
      .order('sort_order')

    const lines = (qLines ?? []) as {
      id: string
      description: string
      quantity: number
      unit: string | null
      sort_order: number
    }[]

    const usable = lines.filter(l => (l.description ?? '').trim())
    if (usable.length > 0) {
      const { error: lineErr } = await supabase.from('rfq_lines').insert(
        usable.map((l, i) => ({
          company_id: input.companyId,
          rfq_id: rfqId,
          sort_order: i,
          quote_line_id: l.id,
          description: l.description.trim(),
          unit: l.unit?.trim() || 'each',
          quantity: Number(l.quantity) || 1,
          specifications: null,
        })),
      )
      if (lineErr) {
        return { ok: false, message: lineErr.message }
      }
    }

    return { ok: true, data: { id: rfqId, reused: false } }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
