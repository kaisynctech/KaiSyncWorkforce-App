# MISSION BRIEF — Commercial Engine Phase 6: Intelligence
## For Claude Code | KaiSync Workforce App

---

## CRITICAL CONSTRAINTS
- **System is new — data is sparse** — every view and page MUST have a graceful empty state
- **No new tables** — Phase 6 is pure views + one API route + one new page
- **Views return zeros, not errors** — all aggregates use COALESCE; empty data = zero rows or zero values
- **AI Business Digest must work with any amount of data** — even 0 invoices, 1 project
- **Add "Commercial Intelligence" tab to existing `/dashboard/reports` page** (already has tab structure)
- **Never touch existing HR report tabs** — only additive

---

## STEP 0 — Apply Migration

```
Tool: apply_migration
Project: vcivtjwreybaxgtdhtou
File: supabase/migrations/20260811000500_commercial_engine_phase6.sql
```

Verify after applying:
- `cash_flow_forecast` view exists
- `client_payment_intelligence` view exists
- `quote_win_loss_summary` view exists
- `project_cost_variance` view exists

---

## TYPESCRIPT TYPES

Add to `/types/commercial.ts`:

```typescript
// ─── Phase 6: Intelligence ────────────────────────────────────────────────────

export interface CashFlowWeek {
  company_id: string
  week_offset: number
  week_start: string
  week_end: string
  week_label: string
  projected_inflow: number
  projected_outflow: number
  net_cash_flow: number
  invoice_inflow: number
  milestone_inflow: number
  po_outflow: number
  supplier_invoice_outflow: number
}

export interface ClientPaymentIntelligence {
  company_id: string
  client_id: string
  client_name: string
  total_invoices: number
  paid_invoices: number
  outstanding_invoices: number
  overdue_invoices: number
  total_invoiced: number
  total_paid: number
  total_outstanding: number
  overdue_amount: number
  avg_days_to_pay: number | null
  avg_days_vs_due: number | null
  on_time_rate_percent: number | null
  reliability_score: number | null
  payment_risk: 'low' | 'medium' | 'high'
}

export interface QuoteWinLossSummary {
  company_id: string
  total_quotes: number
  total_sent_or_decided: number
  currently_open: number
  total_won: number
  total_lost: number
  win_rate_percent: number | null
  avg_quote_value: number | null
  avg_won_value: number | null
  avg_lost_value: number | null
  total_won_value: number
  pipeline_value: number
  avg_days_to_decision: number | null
  avg_won_margin_percent: number | null
}

export interface ProjectCostVariance {
  deal_id: string
  company_id: string
  title: string
  status: string
  contract_value: number
  estimated_cost: number
  committed_cost: number
  actual_cost: number
  cost_overrun_percent: number | null
  commitment_rate_percent: number | null
  projected_margin_percent: number | null
  cost_risk: 'low' | 'medium' | 'high'
  total_invoiced: number
  progress_percent: number
}

export interface BusinessDigest {
  generated_at: string
  headline: string
  health_score: number   // 0–100
  observations: string[]
  risks: string[]
  opportunities: string[]
  recommended_actions: string[]
  data_quality_note: string | null  // shown when data is sparse
}
```

---

## SECTION 1 — AI Business Digest API Route

### File: `/src/app/api/ai/business-digest/route.ts`

Uses `claude-haiku-4-5-20251001` (fast, cheap — this runs on-demand).

```typescript
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const digestSchema = z.object({
  headline:             z.string().describe('One sentence summarising business health'),
  health_score:         z.number().min(0).max(100).describe('Overall business health 0-100'),
  observations:         z.array(z.string()).describe('3-5 key factual observations about the data'),
  risks:                z.array(z.string()).describe('1-3 specific risks to watch'),
  opportunities:        z.array(z.string()).describe('1-3 specific opportunities'),
  recommended_actions:  z.array(z.string()).describe('2-4 concrete next actions'),
  data_quality_note:    z.string().nullable().describe('Note if data is sparse or unreliable'),
})

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve company
  const { data: emp } = await supabase
    .from('employees')
    .select('company_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  const companyId = emp?.company_id
  if (!companyId) return NextResponse.json({ error: 'No company' }, { status: 403 })

  // Check financials permission
  const { data: canView } = await supabase.rpc('user_has_permission', {
    p_company_id: companyId,
    p_key: 'projects.financials'
  })
  if (!canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Gather all intelligence data in parallel
  const [
    { data: cashFlow },
    { data: clientIntel },
    { data: winLoss },
    { data: costVariance },
    { data: projectSummaries },
  ] = await Promise.all([
    supabase.from('cash_flow_forecast').select('*').eq('company_id', companyId),
    supabase.from('client_payment_intelligence').select('*').eq('company_id', companyId),
    supabase.from('quote_win_loss_summary').select('*').eq('company_id', companyId).single(),
    supabase.from('project_cost_variance').select('*').eq('company_id', companyId),
    supabase.from('project_financial_summary').select('*').eq('company_id', companyId).limit(10),
  ])

  // Build context summary for Claude
  const totalInflow = cashFlow?.reduce((s, w) => s + Number(w.projected_inflow), 0) ?? 0
  const totalOutflow = cashFlow?.reduce((s, w) => s + Number(w.projected_outflow), 0) ?? 0
  const highRiskClients = clientIntel?.filter(c => c.payment_risk === 'high') ?? []
  const overdueProjects = costVariance?.filter(p => p.cost_risk === 'high') ?? []

  const context = `
BUSINESS INTELLIGENCE SNAPSHOT — ${new Date().toLocaleDateString('en-ZA')}
Currency: ZAR (South African Rand)

CASH FLOW (next 12 weeks):
- Projected inflows: R${totalInflow.toLocaleString()}
- Projected outflows: R${totalOutflow.toLocaleString()}
- Net position: R${(totalInflow - totalOutflow).toLocaleString()}
- Weeks with negative cash flow: ${cashFlow?.filter(w => Number(w.net_cash_flow) < 0).length ?? 0}

QUOTE PIPELINE:
${winLoss ? `
- Total quotes sent: ${winLoss.total_sent_or_decided ?? 0}
- Win rate: ${winLoss.win_rate_percent ?? 'N/A'}%
- Open pipeline value: R${Number(winLoss.pipeline_value ?? 0).toLocaleString()}
- Total won this period: R${Number(winLoss.total_won_value ?? 0).toLocaleString()}
- Avg days to decision: ${winLoss.avg_days_to_decision ?? 'N/A'} days
- Avg won margin: ${winLoss.avg_won_margin_percent ?? 'N/A'}%
` : 'No quote data available yet.'}

ACTIVE PROJECTS (${costVariance?.length ?? 0} projects):
${costVariance?.map(p => `- ${p.title}: ${p.progress_percent}% complete, margin ${p.projected_margin_percent ?? 'N/A'}%, cost risk: ${p.cost_risk}`).join('\n') || 'No active projects.'}

PROJECTS OVER BUDGET:
${overdueProjects.length > 0 ? overdueProjects.map(p => `- ${p.title}: ${p.cost_overrun_percent}% over estimate`).join('\n') : 'None'}

CLIENT PAYMENT HEALTH (${clientIntel?.length ?? 0} clients):
${clientIntel?.map(c => `- ${c.client_name}: ${c.outstanding_invoices} outstanding, avg ${c.avg_days_to_pay ?? 'N/A'} days to pay, risk: ${c.payment_risk}`).join('\n') || 'No invoice data yet.'}

HIGH-RISK CLIENTS:
${highRiskClients.length > 0 ? highRiskClients.map(c => `- ${c.client_name}: R${Number(c.overdue_amount).toLocaleString()} overdue`).join('\n') : 'None'}

DATA COMPLETENESS NOTE:
- Quotes in system: ${winLoss?.total_quotes ?? 0}
- Clients with invoices: ${clientIntel?.length ?? 0}
- Active projects: ${costVariance?.length ?? 0}
${(winLoss?.total_quotes ?? 0) < 5 ? '⚠ Low quote volume — predictions have limited accuracy.' : ''}
`.trim()

  try {
    const result = await generateObject({
      model: anthropic('claude-haiku-4-5-20251001'),
      schema: digestSchema,
      system: `You are a senior financial advisor for a South African construction and field-services business. 
Analyse the business intelligence snapshot and provide actionable insights.
Be specific and practical. Reference actual numbers from the data.
If data is sparse, acknowledge it but still provide useful guidance based on what's available.
Tone: professional, direct, optimistic where warranted, honest about risks.`,
      prompt: context,
    })

    // Log usage
    await supabase.from('ai_usage_log').insert({
      company_id: companyId,
      feature: 'business_digest',
      model: 'claude-haiku-4-5-20251001',
      input_tokens: result.usage?.inputTokens ?? 0,
      output_tokens: result.usage?.outputTokens ?? 0,
      success: true,
    })

    return NextResponse.json({
      ...result.object,
      generated_at: new Date().toISOString(),
    })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await supabase.from('ai_usage_log').insert({
      company_id: companyId,
      feature: 'business_digest',
      model: 'claude-haiku-4-5-20251001',
      input_tokens: 0, output_tokens: 0,
      success: false, error_message: errorMessage,
    })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
```

---

## SECTION 2 — Commercial Intelligence Page

### File: `/src/app/dashboard/reports/commercial/page.tsx`

This is a new standalone page. Also add a link to it from the existing reports page sidebar/tabs.

**Page has 4 tabs:**
```typescript
const TABS = ['cashflow', 'clients', 'quotes', 'projects'] as const
const TAB_LABELS = {
  cashflow: 'Cash Flow',
  clients:  'Client Intelligence',
  quotes:   'Win/Loss',
  projects: 'Cost Variance',
}
```

**Header — shared across all tabs:**
```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
  <h1>Commercial Intelligence</h1>
  <button onClick={() => setShowDigest(true)}>
    ✨ AI Business Digest
  </button>
</div>
```

---

### TAB 1: Cash Flow Forecast

**Data:**
```typescript
const { data: weeks } = await supabase
  .from('cash_flow_forecast')
  .select('*')
  .eq('company_id', companyId)
  .order('week_offset')
```

**Empty state** (all zeros): 
```
📊 Cash flow data will appear here once you have outstanding invoices or approved purchase orders.
```

**Layout when data exists:**

**KPI strip (3 tiles):**
- 12-Week Inflow: `R{sum of projected_inflow}`
- 12-Week Outflow: `R{sum of projected_outflow}`
- Net Position: `R{inflow - outflow}` — green if positive, red if negative

**Bar chart** (use Recharts — already installed per existing reports page):
```tsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine } from 'recharts'

<ResponsiveContainer width="100%" height={300}>
  <BarChart data={weeks}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="week_label" />
    <YAxis tickFormatter={v => `R${(v/1000).toFixed(0)}k`} />
    <Tooltip formatter={(v: number) => `R${v.toLocaleString('en-ZA')}`} />
    <ReferenceLine y={0} stroke="#6B7280" />
    <Bar dataKey="projected_inflow"  name="Inflow"  fill="#34D399" />
    <Bar dataKey="projected_outflow" name="Outflow" fill="#F87171" />
  </BarChart>
</ResponsiveContainer>
```

**Weekly breakdown table** below the chart:
| Week | Inflow | Outflow | Net | Breakdown |
- Net cell: green if positive, red if negative
- Breakdown: show tooltip on hover with invoice vs milestone inflow, PO vs supplier outflow split

---

### TAB 2: Client Intelligence

**Data:**
```typescript
const { data: clients } = await supabase
  .from('client_payment_intelligence')
  .select('*')
  .eq('company_id', companyId)
  .order('overdue_amount', { ascending: false })
```

**Empty state**: "Client payment data will appear here once you have sent and received payments on invoices."

**KPI strip:**
- Total Outstanding: sum of total_outstanding
- Total Overdue: sum of overdue_amount (red if > 0)
- Avg Days to Pay: weighted avg
- At-Risk Clients: count of payment_risk = 'high' or 'medium'

**Client table:**
| Client | Outstanding | Overdue | Avg Days to Pay | On-Time Rate | Reliability | Risk |
- Reliability score: coloured pill (green ≥80, amber 50–79, red <50, gray = no data)
- Risk badge: high=red, medium=amber, low=green
- Row click → navigates to `/dashboard/clients/{client_id}?tab=commercial`

---

### TAB 3: Win/Loss Analysis

**Data:**
```typescript
const { data: summary } = await supabase
  .from('quote_win_loss_summary')
  .select('*')
  .eq('company_id', companyId)
  .single()

// Per-quote breakdown for trend chart
const { data: quotes } = await supabase
  .from('commercial_quotes')
  .select('id, quote_number, status, total_amount, gross_margin_percent, sent_at, accepted_at, declined_at, client_id, clients(name)')
  .eq('company_id', companyId)
  .not('status', 'eq', 'draft')
  .order('sent_at', { ascending: false })
  .limit(50)
```

**Empty state**: "Win/loss analytics will appear here once you've sent and received decisions on quotes."

**KPI strip (4 tiles):**
- Win Rate: `{win_rate_percent}%` (green)
- Open Pipeline: `R{pipeline_value}`
- Total Won: `R{total_won_value}`
- Avg Days to Decision: `{avg_days_to_decision} days`

**Donut chart** (won / lost / open) using Recharts PieChart:
```tsx
import { PieChart, Pie, Cell, Tooltip } from 'recharts'
const pieData = [
  { name: 'Won',  value: summary.total_won,  color: '#34D399' },
  { name: 'Lost', value: summary.total_lost, color: '#F87171' },
  { name: 'Open', value: summary.currently_open, color: '#60A5FA' },
]
```

**Recent quotes table:**
| Quote # | Client | Value | Status | Sent | Decision | Days |
- Status badge with colours
- Row click → `/dashboard/money/quotes/{id}`

---

### TAB 4: Cost Variance

**Data:**
```typescript
const { data: projects } = await supabase
  .from('project_cost_variance')
  .select('*')
  .eq('company_id', companyId)
  .order('cost_risk', { ascending: false })
```

**Empty state**: "Cost variance tracking will appear here once you have active projects with cost data."

**KPI strip:**
- Active Projects: count
- Projects Over Budget: count of cost_risk = 'high' (red if > 0)
- Avg Projected Margin: avg of projected_margin_percent
- Total Contract Value: sum of contract_value

**Project table:**
| Project | Progress | Contract | Est. Cost | Actual Cost | Overrun % | Proj. Margin | Risk |
- Overrun %: red if positive (over budget), green if negative (under budget)
- Cost risk badge: high=red, medium=amber, low=green
- Progress bar in the Progress cell
- Row click → `/dashboard/projects/{deal_id}?tab=financials`

---

## SECTION 3 — AI Business Digest Modal

### Component: `/src/components/BusinessDigestModal.tsx`

Props:
```typescript
interface Props {
  companyId: string
  onClose: () => void
}
```

**Loading state:** Full modal with skeleton lines and "Analysing your business data..." message. Takes 3–8 seconds.

**Layout when loaded:**

```
┌─────────────────────────────────────────────────────────────┐
│  ✨ AI Business Digest          Generated {time}      [×]   │
│─────────────────────────────────────────────────────────────│
│                                                             │
│  Health Score   [====75====]  75/100                        │
│                                                             │
│  "{headline}"                                               │
│                                                             │
│  📊 Observations          🔴 Risks                          │
│  • ...                    • ...                             │
│  • ...                    • ...                             │
│                                                             │
│  🟢 Opportunities         ✅ Recommended Actions            │
│  • ...                    1. ...                            │
│                           2. ...                            │
│                                                             │
│  {data_quality_note if present — gray italic small text}    │
│                                                             │
│  [Regenerate]                              [Close]          │
└─────────────────────────────────────────────────────────────┘
```

**Health score colour:**
- ≥ 75: green
- 50–74: amber
- < 50: red

**Fetch:**
```typescript
async function generateDigest() {
  setLoading(true)
  const res = await fetch('/api/ai/business-digest', { method: 'POST' })
  const data = await res.json()
  setDigest(data)
  setLoading(false)
}

useEffect(() => { generateDigest() }, [])
```

---

## SECTION 4 — Add Link to Commercial Intelligence from Reports Page

In `/src/app/dashboard/reports/page.tsx`, add a "Commercial Intelligence" entry to the existing TABS array and a case in the tab renderer that navigates to (or renders) the commercial intelligence page.

Simplest approach — add as a tab that renders a navigation card:

```typescript
// Add to TABS array:
{ key: 'commercial', label: '📊 Commercial' }

// In tab content renderer, add case:
case 'commercial':
  return (
    <div style={{ padding: '24px', textAlign: 'center' }}>
      <h3>Commercial Intelligence</h3>
      <p>Cash flow forecasting, client payment analysis, quote win rates, and cost variance tracking.</p>
      <a href="/dashboard/reports/commercial">
        <button>Open Commercial Intelligence →</button>
      </a>
    </div>
  )
```

---

## BUILD ORDER

```
1. Apply migration (Step 0) — verify 4 views + 6 indexes
2. Add TypeScript types to /types/commercial.ts
3. /api/ai/business-digest/route.ts
4. /reports/commercial/page.tsx — full page with 4 tabs
5. BusinessDigestModal component
6. Add "Commercial" tab link to existing /reports page
7. tsc --noEmit — must be 0 errors
```

---

## EMPTY STATE DESIGN PRINCIPLE

Every tab that has no data must show:
1. A neutral icon (📊 or similar)
2. A single sentence explaining what data is needed
3. A link or button to create that data (e.g. "Create your first quote →")

Never show: error messages, broken charts, NaN, undefined, or zero-value charts that look like bugs.

---

## DELIVERABLES CHECKLIST

- [ ] Migration applied — 4 views verified
- [ ] TypeScript types added
- [ ] `/api/ai/business-digest` route (POST)
- [ ] `/reports/commercial/page.tsx` — 4 tabs, all with empty states
- [ ] `BusinessDigestModal` — health score, 4 quadrants, regenerate button
- [ ] "Commercial" tab entry on existing reports page
- [ ] TypeScript clean build, 0 errors
