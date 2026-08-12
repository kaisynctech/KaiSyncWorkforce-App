import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const digestSchema = z.object({
  health_score: z.number().min(0).max(100)
    .describe('Overall commercial health score 0–100. 80+ = strong, 50-79 = stable, below 50 = needs attention.'),
  cash_flow_summary: z.string()
    .describe('2–3 sentences on the 12-week cash flow outlook. Mention key inflows/outflows.'),
  client_risk_summary: z.string()
    .describe('2–3 sentences on client payment behaviour and any high-risk accounts.'),
  quote_performance_summary: z.string()
    .describe('2–3 sentences on quote win rate, pipeline, and margins.'),
  cost_performance_summary: z.string()
    .describe('2–3 sentences on project cost performance and any overruns.'),
  top_actions: z.array(z.string()).max(4)
    .describe('Up to 4 specific, actionable recommendations. Start each with a verb.'),
})

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: emp } = await supabase
    .from('employees')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const companyId = emp?.company_id ?? null
  if (!companyId) return NextResponse.json({ error: 'No company' }, { status: 403 })

  // Load summary data from all 4 intelligence views concurrently
  const [cashFlowRes, clientRes, winLossRes, costRes] = await Promise.all([
    supabase.from('cash_flow_forecast')
      .select('projected_inflow,projected_outflow,net_cash_flow,week_label')
      .eq('company_id', companyId)
      .order('week_start'),
    supabase.from('client_payment_intelligence')
      .select('client_name,payment_risk,overdue_amount,total_outstanding,reliability_score,on_time_rate_percent')
      .eq('company_id', companyId),
    supabase.from('quote_win_loss_summary')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase.from('project_cost_variance')
      .select('title,cost_risk,cost_overrun_percent,projected_margin_percent,contract_value')
      .eq('company_id', companyId),
  ])

  const cashRows    = cashFlowRes.data ?? []
  const clientRows  = clientRes.data ?? []
  const wl          = winLossRes.data
  const costRows    = costRes.data ?? []

  const totalInflow  = cashRows.reduce((s, w) => s + (Number(w.projected_inflow)  ?? 0), 0)
  const totalOutflow = cashRows.reduce((s, w) => s + (Number(w.projected_outflow) ?? 0), 0)
  const netCashFlow  = cashRows.reduce((s, w) => s + (Number(w.net_cash_flow)     ?? 0), 0)

  const highRiskClients    = clientRows.filter(c => c.payment_risk === 'high').length
  const totalOverdue       = clientRows.reduce((s, c) => s + (Number(c.overdue_amount) ?? 0), 0)
  const totalOutstanding   = clientRows.reduce((s, c) => s + (Number(c.total_outstanding) ?? 0), 0)
  const avgReliability     = clientRows.length > 0
    ? (clientRows.reduce((s, c) => s + (Number(c.reliability_score) ?? 0), 0) / clientRows.length).toFixed(0)
    : 'N/A'

  const highCostProjects   = costRows.filter(p => p.cost_risk === 'high').length
  const avgProjMargin      = costRows.length > 0
    ? (costRows.reduce((s, p) => s + (Number(p.projected_margin_percent) ?? 0), 0) / costRows.length).toFixed(1)
    : 'N/A'

  const dataContext = `
CASH FLOW FORECAST (12 weeks):
- Total projected inflow:  R${totalInflow.toFixed(0)}
- Total projected outflow: R${totalOutflow.toFixed(0)}
- Net cash position:       R${netCashFlow.toFixed(0)} (${netCashFlow >= 0 ? 'surplus' : 'deficit'})
- Weeks tracked: ${cashRows.length}

CLIENT PAYMENT INTELLIGENCE:
- Clients tracked: ${clientRows.length}
- High-risk clients (multiple overdue invoices): ${highRiskClients}
- Total overdue amount:     R${totalOverdue.toFixed(0)}
- Total outstanding:        R${totalOutstanding.toFixed(0)}
- Average reliability score: ${avgReliability}/100

QUOTE WIN/LOSS:
- Total quotes: ${wl?.total_quotes ?? 0}
- Win rate: ${wl?.win_rate_percent ?? 0}%
- Total won value: R${(Number(wl?.total_won_value) ?? 0).toFixed(0)}
- Pipeline value (open quotes): R${(Number(wl?.pipeline_value) ?? 0).toFixed(0)}
- Avg won margin: ${wl?.avg_won_margin_percent ?? 'N/A'}%
- Avg days to decision: ${wl?.avg_days_to_decision ?? 'N/A'} days

PROJECT COST PERFORMANCE:
- Active projects tracked: ${costRows.length}
- High-risk overruns: ${highCostProjects}
- Avg projected margin: ${avgProjMargin}%
${costRows.filter(p => p.cost_risk === 'high').map(p =>
  `  ! ${p.title}: ${p.cost_overrun_percent ?? 0}% over budget`).join('\n')}
`

  try {
    const result = await generateObject({
      model:  anthropic('claude-haiku-4-5-20251001'),
      schema: digestSchema,
      system: `You are a South African commercial business intelligence analyst.
Generate a clear, honest, and specific business health digest.
Use plain language — no corporate jargon.
Quantities are in South African Rand (ZAR).
Be direct about problems and realistic about positives.`,
      prompt: `Generate a business health digest for this company:\n${dataContext}`,
    })

    await supabase.from('ai_usage_log').insert({
      company_id:   companyId,
      feature:      'business_digest',
      model:        'claude-haiku-4-5-20251001',
      input_tokens: result.usage?.inputTokens  ?? 0,
      output_tokens: result.usage?.outputTokens ?? 0,
      entity_type:  'company',
      entity_id:    companyId,
      success:      true,
    })

    return NextResponse.json({
      digest: { ...result.object, generated_at: new Date().toISOString() },
    })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    try {
      await supabase.from('ai_usage_log').insert({
        company_id:    companyId,
        feature:       'business_digest',
        model:         'claude-haiku-4-5-20251001',
        input_tokens:  0,
        output_tokens: 0,
        success:       false,
        error_message: errorMessage,
      })
    } catch { /* log failure is non-fatal */ }
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
