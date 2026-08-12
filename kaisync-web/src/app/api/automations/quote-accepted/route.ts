import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { CommercialAutomationRule } from '@/types/commercial'

// ── POST — called from quote builder after a quote is marked accepted ─────────
// Body: { quote_id: string }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { data: emp } = await supabase
    .from('employees')
    .select('company_id, id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!emp?.company_id) return NextResponse.json({ error: 'No company linked' }, { status: 403 })

  const body = await request.json() as { quote_id?: string }
  const quoteId = body.quote_id
  if (!quoteId) return NextResponse.json({ error: 'quote_id required' }, { status: 400 })

  // Fetch the quote
  const { data: quote } = await supabase
    .from('commercial_quotes')
    .select('id, title, quote_number, client_id, deal_id, total_amount, notes, deposit_required')
    .eq('id', quoteId)
    .eq('company_id', emp.company_id)
    .maybeSingle()

  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  // Fetch active quote_accepted rules for this company
  const { data: rules } = await supabase
    .from('commercial_automation_rules')
    .select('*')
    .eq('company_id', emp.company_id)
    .eq('trigger_type', 'quote_accepted')
    .eq('is_active', true)

  if (!rules || rules.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no active quote_accepted rules' })
  }

  const results: Record<string, unknown>[] = []

  for (const rule of rules as CommercialAutomationRule[]) {
    try {
      if (rule.action_type === 'create_project') {
        const result = await executeCreateProject(supabase, emp.company_id, quote, rule)
        results.push({ rule_id: rule.id, action: 'create_project', ...result })

        // Log execution
        await supabase.from('automation_rule_executions').insert({
          company_id: emp.company_id,
          rule_id: rule.id,
          trigger_type: 'quote_accepted',
          trigger_entity_id: quoteId,
          trigger_entity_type: 'quote',
          action_type: 'create_project',
          status: result.skipped ? 'skipped' : 'success',
          result: result as Record<string, unknown>,
        })
      } else if (rule.action_type === 'create_rfq') {
        const result = await executeCreateRfq(supabase, emp.company_id, quote, rule)
        results.push({ rule_id: rule.id, action: 'create_rfq', ...result })

        await supabase.from('automation_rule_executions').insert({
          company_id: emp.company_id,
          rule_id: rule.id,
          trigger_type: 'quote_accepted',
          trigger_entity_id: quoteId,
          trigger_entity_type: 'quote',
          action_type: 'create_rfq',
          status: result.skipped ? 'skipped' : 'success',
          result: result as Record<string, unknown>,
        })
      }

      // Bump run stats
      await supabase.from('commercial_automation_rules')
        .update({ run_count: rule.run_count + 1, last_run_at: new Date().toISOString() })
        .eq('id', rule.id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ rule_id: rule.id, action: rule.action_type, status: 'failed', error: msg })
      await supabase.from('automation_rule_executions').insert({
        company_id: emp.company_id,
        rule_id: rule.id,
        trigger_type: 'quote_accepted',
        trigger_entity_id: quoteId,
        trigger_entity_type: 'quote',
        action_type: rule.action_type,
        status: 'failed',
        result: {},
        error_message: msg,
      })
    }
  }

  return NextResponse.json({ results })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type Supabase = Awaited<ReturnType<typeof createClient>>

interface QuoteRow {
  id: string
  title: string
  quote_number: string | null
  client_id: string | null
  deal_id: string | null
  total_amount: number
  notes: string | null
  deposit_required: number | null
}

async function executeCreateProject(
  supabase: Supabase,
  companyId: string,
  quote: QuoteRow,
  rule: CommercialAutomationRule,
): Promise<Record<string, unknown>> {
  // Dedup: check if a deal already has this quote_id set
  const { data: existingByQuoteId } = await supabase
    .from('client_deals')
    .select('id')
    .eq('company_id', companyId)
    .eq('quote_id', quote.id)
    .limit(1)
    .maybeSingle()

  if (existingByQuoteId) {
    return { skipped: true, reason: 'project already exists for this quote', deal_id: existingByQuoteId.id }
  }

  // Fallback dedup: title contains quote number
  if (quote.quote_number) {
    const { data: existingByTitle } = await supabase
      .from('client_deals')
      .select('id')
      .eq('company_id', companyId)
      .ilike('title', `%${quote.quote_number}%`)
      .limit(1)
      .maybeSingle()

    if (existingByTitle) {
      return { skipped: true, reason: 'project with matching title already exists', deal_id: existingByTitle.id }
    }
  }

  const cfg = rule.action_config as { set_status?: string; copy_quote_notes?: boolean }

  const { data: deal, error } = await supabase
    .from('client_deals')
    .insert({
      company_id: companyId,
      client_id: quote.client_id,
      quote_id: quote.id,
      title: quote.title,
      status: cfg.set_status ?? 'active',
      offer_amount: quote.total_amount,
      budget_amount: quote.total_amount,
      notes: cfg.copy_quote_notes ? (quote.notes ?? null) : null,
      deposit_required: quote.deposit_required ?? null,
    })
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)

  // Link quote → deal
  await supabase
    .from('commercial_quotes')
    .update({ deal_id: deal!.id })
    .eq('id', quote.id)

  return { deal_id: deal!.id }
}

async function executeCreateRfq(
  supabase: Supabase,
  companyId: string,
  quote: QuoteRow,
  rule: CommercialAutomationRule,
): Promise<Record<string, unknown>> {
  // Dedup: check if an RFQ already exists for this quote
  const { data: existing } = await supabase
    .from('rfqs')
    .select('id')
    .eq('company_id', companyId)
    .eq('quote_id', quote.id)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return { skipped: true, reason: 'RFQ already exists for this quote', rfq_id: existing.id }
  }

  const cfg = rule.action_config as { from_quote_lines?: boolean; status?: string }

  const { data: rfq, error } = await supabase
    .from('rfqs')
    .insert({
      company_id: companyId,
      quote_id: quote.id,
      title: `RFQ — ${quote.title}`,
      status: cfg.status ?? 'draft',
    })
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)

  // Copy quote lines as RFQ lines if configured
  if (cfg.from_quote_lines && rfq) {
    const { data: qLines } = await supabase
      .from('commercial_quote_lines')
      .select('description, quantity, unit')
      .eq('quote_id', quote.id)
      .order('sort_order')

    if (qLines && qLines.length > 0) {
      await supabase.from('rfq_lines').insert(
        qLines.map((l, i) => ({
          company_id: companyId,
          rfq_id: rfq.id,
          sort_order: i + 1,
          quote_line_id: null,
          description: l.description,
          unit: l.unit ?? 'each',
          quantity: l.quantity ?? 1,
        }))
      )
    }
  }

  return { rfq_id: rfq!.id }
}
