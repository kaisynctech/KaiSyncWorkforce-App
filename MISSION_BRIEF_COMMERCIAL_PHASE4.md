# MISSION BRIEF — Commercial Engine Phase 4: Automation
## For Claude Code | KaiSync Workforce App

---

## CRITICAL CONSTRAINTS
- **DO NOT touch the old `automation_rules` table** (bigint IDs, left in place) — use `commercial_automation_rules` (UUID) exclusively
- **`app_notifications` is the notification store** — `notification_events`, `notification_queue`, `app_reminders` use bigint IDs and must not be touched
- **All automation flows are opt-in** — rules are seeded with `is_active = false`; users enable them in Settings
- **Quote → Project** flow must be additive — do not remove the manual "Accept" button; automation fires alongside it
- **Never break existing project or quote pages**

---

## STEP 0 — Apply Migration

```
Tool: apply_migration
Project: vcivtjwreybaxgtdhtou
File: supabase/migrations/20260811000300_commercial_engine_phase4.sql
```

Verify after applying:
- `commercial_automation_rules` table exists with rows (5 per company)
- `automation_rule_executions` table exists
- `process_overdue_invoices` function exists
- `process_due_milestones` function exists
- `process_expiring_quotes` function exists

---

## TYPESCRIPT TYPES

Add to `/types/commercial.ts`:

```typescript
// ─── Automation ──────────────────────────────────────────────────────────────
export type AutomationTriggerType =
  | 'quote_accepted'
  | 'invoice_overdue'
  | 'milestone_due'
  | 'po_approved'
  | 'quote_expiring'

export type AutomationActionType =
  | 'create_project'
  | 'create_rfq'
  | 'send_notification'
  | 'create_milestone_invoice'

export interface CommercialAutomationRule {
  id: string
  company_id: string
  name: string
  description: string | null
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  action_type: AutomationActionType
  action_config: Record<string, unknown>
  is_active: boolean
  is_system: boolean
  run_count: number
  last_run_at: string | null
  created_at: string
  updated_at: string
}

export interface AutomationRuleExecution {
  id: string
  company_id: string
  rule_id: string | null
  trigger_type: string
  trigger_entity_id: string
  trigger_entity_type: string
  action_type: string
  status: 'success' | 'failed' | 'skipped'
  result: Record<string, unknown>
  error_message: string | null
  executed_at: string
}
```

---

## SECTION 1 — Settings > Automations Page

### Page: `/dashboard/settings/automations`

Add a new tab or page under Settings. Check the existing settings layout — if it's tab-based, add "Automations" as a tab. If it's a sidebar nav, add it as a settings sub-item.

**Data query:**
```typescript
const { data: rules } = await supabase
  .from('commercial_automation_rules')
  .select('*')
  .eq('company_id', companyId)
  .order('trigger_type')
```

**Layout:** List of automation rule cards, grouped by trigger type:

```
GROUP: "When a Quote is Accepted"
  [card] Quote Accepted → Create Project    [toggle ON/OFF]
  [card] Quote Accepted → Generate RFQ      [toggle ON/OFF]

GROUP: "Scheduled Reminders (run daily)"
  [card] Invoice Overdue → Notify Owner     [toggle ON/OFF]
  [card] Milestone Due Soon → Remind Manager [toggle ON/OFF]
  [card] Quote Expiring → Remind Sales      [toggle ON/OFF]
```

**Each card shows:**
- Rule name (bold)
- Description (gray text)
- Last run: `{last_run_at ? formatDate(last_run_at) : 'Never'}` | Run count: `{run_count}`
- Toggle (enabled/disabled)
- "Run now" button — for scheduled rules only (invoice_overdue, milestone_due, quote_expiring)

**Toggle handler:**
```typescript
async function toggleRule(ruleId: string, newValue: boolean) {
  await supabase
    .from('commercial_automation_rules')
    .update({ is_active: newValue, updated_at: new Date().toISOString() })
    .eq('id', ruleId)
    .eq('company_id', companyId)
}
```

**"Run now" handler** — calls the relevant API route:
```typescript
async function runNow(triggerType: string) {
  const res = await fetch(`/api/automations/${triggerType}`, { method: 'POST' })
  const data = await res.json()
  toast(`Processed ${data.processed ?? 0} item(s)`)
}
```

**Permission gate:** Only `owner` role can toggle rules. Others can view but not edit.

---

## SECTION 2 — Next.js API Routes

Create `/src/app/api/automations/` directory with the following route handlers.

### `/api/automations/invoice-overdue/route.ts`

```typescript
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'  // use server client, not browser

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve company
  const { data: member } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', user.id)
    .single()

  if (!member) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const { data, error } = await supabase.rpc('process_overdue_invoices', {
    p_company_id: member.company_id
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
```

### `/api/automations/milestone-due/route.ts`
Same pattern, call `process_due_milestones`.

### `/api/automations/quote-expiring/route.ts`
Same pattern, call `process_expiring_quotes`.

### `/api/automations/quote-accepted/route.ts`

This is called from the UI when a quote is accepted. It handles the create_project and create_rfq rules.

```typescript
// POST body: { quoteId: string, companyId: string }
export async function POST(request: Request) {
  const { quoteId, companyId } = await request.json()
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const results: Record<string, unknown> = {}

  // Load active rules for quote_accepted
  const { data: rules } = await supabase
    .from('commercial_automation_rules')
    .select('*')
    .eq('company_id', companyId)
    .eq('trigger_type', 'quote_accepted')
    .eq('is_active', true)

  if (!rules || rules.length === 0) {
    return NextResponse.json({ skipped: true, reason: 'no active rules' })
  }

  // Load the quote
  const { data: quote } = await supabase
    .from('commercial_quotes')
    .select('*, clients(id, name), commercial_quote_lines(*)')
    .eq('id', quoteId)
    .single()

  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  for (const rule of rules) {
    try {
      if (rule.action_type === 'create_project') {
        results.project = await executeCreateProject(supabase, quote, rule, user.id)
      }
      if (rule.action_type === 'create_rfq') {
        results.rfq = await executeCreateRfq(supabase, quote, rule, companyId, results.project as { id: string } | null)
      }

      // Log execution
      await supabase.from('automation_rule_executions').insert({
        company_id: companyId,
        rule_id: rule.id,
        trigger_type: 'quote_accepted',
        trigger_entity_id: quoteId,
        trigger_entity_type: 'quote',
        action_type: rule.action_type,
        status: 'success',
        result: results,
      })
    } catch (err) {
      await supabase.from('automation_rule_executions').insert({
        company_id: companyId,
        rule_id: rule.id,
        trigger_type: 'quote_accepted',
        trigger_entity_id: quoteId,
        trigger_entity_type: 'quote',
        action_type: rule.action_type,
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        result: {},
      })
    }
  }

  // Update rule run stats
  const ruleIds = rules.map(r => r.id)
  await supabase
    .from('commercial_automation_rules')
    .update({ run_count: rules[0].run_count + 1, last_run_at: new Date().toISOString() })
    .in('id', ruleIds)

  return NextResponse.json(results)
}

// ─── Helper: create project from quote ───────────────────────────────────────
async function executeCreateProject(supabase: SupabaseClient, quote: Quote, rule: CommercialAutomationRule, userId: string) {
  // Check if a deal already exists for this quote
  const { data: existing } = await supabase
    .from('client_deals')
    .select('id')
    .eq('company_id', quote.company_id)
    .eq('quote_id' /* if column exists on client_deals */ , quote.id)
    .maybeSingle()

  if (existing) return { id: existing.id, already_existed: true }

  const { data: deal, error } = await supabase
    .from('client_deals')
    .insert({
      company_id:             quote.company_id,
      client_id:              quote.client_id,
      title:                  quote.title ?? `Project from ${quote.quote_number}`,
      status:                 'in_progress',
      offer_amount:           quote.total_amount,
      estimated_cost:         quote.cost_total,
      notes:                  (rule.action_config as { copy_quote_notes?: boolean }).copy_quote_notes
                                ? quote.notes
                                : null,
      manager_employee_id:    null,   // auto-assign not yet implemented
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  // Link the quote back to the deal
  await supabase
    .from('commercial_quotes')
    .update({ deal_id: deal.id })
    .eq('id', quote.id)

  return { id: deal.id, created: true }
}

// ─── Helper: create RFQ from quote lines ─────────────────────────────────────
async function executeCreateRfq(supabase: SupabaseClient, quote: Quote, rule: CommercialAutomationRule, companyId: string, projectResult: { id: string } | null) {
  // Generate RFQ number
  const { data: rfqNumber } = await supabase.rpc('generate_rfq_number', { p_company_id: companyId })

  const { data: rfq, error } = await supabase
    .from('rfqs')
    .insert({
      company_id:  companyId,
      rfq_number:  rfqNumber,
      title:       `Materials for ${quote.title ?? quote.quote_number}`,
      quote_id:    quote.id,
      deal_id:     projectResult?.id ?? quote.deal_id,
      status:      'draft',
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  // Create RFQ lines from quote lines that have inventory_item_id or are material-type
  const lines = (quote.commercial_quote_lines ?? []).map((ql, i) => ({
    company_id:        companyId,
    rfq_id:            rfq.id,
    sort_order:        i,
    quote_line_id:     ql.id,
    inventory_item_id: ql.inventory_item_id ?? null,
    description:       ql.description,
    unit:              ql.unit ?? 'each',
    quantity:          ql.quantity,
  }))

  if (lines.length > 0) {
    await supabase.from('rfq_lines').insert(lines)
  }

  return { id: rfq.id, line_count: lines.length }
}
```

**Note on `client_deals.quote_id`**: Check if this column exists before inserting. If not, skip the duplicate-check or add the column as part of this migration (see Section 5).

---

## SECTION 3 — Wire Quote Accepted Trigger

### File: `/src/app/dashboard/money/quotes/[id]/page.tsx` (or wherever the Accept Quote action lives)

Find the existing "Accept Quote" button/modal handler. After the quote status is updated to `'accepted'`, call the automation API:

```typescript
// After successfully updating quote status to 'accepted':
try {
  const res = await fetch('/api/automations/quote-accepted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId: quote.id, companyId })
  })
  const automationResult = await res.json()
  
  if (automationResult.project?.created) {
    toast.success(`Project created automatically: ${automationResult.project.id}`)
  }
  if (automationResult.rfq?.created) {
    toast.success(`RFQ drafted automatically`)
  }
} catch {
  // Automation failure must NEVER block the quote acceptance itself
  console.warn('Automation post-processing failed silently')
}
```

**Key rule:** Automation errors must be swallowed — they never block the primary action.

---

## SECTION 4 — Vercel Cron Setup

Create `/vercel.json` in the project root if it doesn't exist, or add the crons block:

```json
{
  "crons": [
    {
      "path": "/api/automations/invoice-overdue",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/automations/milestone-due",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/automations/quote-expiring",
      "schedule": "0 8 * * *"
    }
  ]
}
```

**NOTE:** Vercel Cron calls the route with a GET, not POST. Each cron route needs to handle GET as well (or implement GET alongside POST).

**Add GET handler** to each automation route:
```typescript
// For Vercel Cron (GET) — resolves all companies rather than a single user's company
export async function GET() {
  const supabase = createAdminClient()  // use service role for cron
  const { data: companies } = await supabase.from('companies').select('id')
  
  let total = 0
  for (const company of companies ?? []) {
    const { data } = await supabase.rpc('process_overdue_invoices', { p_company_id: company.id })
    total += (data as { processed?: number })?.processed ?? 0
  }
  
  return NextResponse.json({ total_processed: total })
}
```

---

## SECTION 5 — Extend client_deals with quote_id

The `create_project` automation needs to check for existing deals linked to a quote to prevent duplicates.

**Check if `client_deals.quote_id` column exists before using it.** If it doesn't:

Add to migration (or as a separate small migration):
```sql
ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.commercial_quotes(id) ON DELETE SET NULL;
```

In the API route helper `executeCreateProject`, use `.eq('quote_id', quote.id)` for duplicate detection only if the column exists. Safest approach — check at runtime:
```typescript
// Duplicate detection with graceful fallback
const { data: existing } = await supabase
  .from('client_deals')
  .select('id')
  .eq('company_id', quote.company_id)
  .eq('status', 'in_progress')
  .ilike('title', `%${quote.quote_number}%`)  // fallback: title-based dedup
  .maybeSingle()
```

**Add `quote_id` column to the migration file** as a safe `ALTER TABLE ADD COLUMN IF NOT EXISTS`.

---

## SECTION 6 — Automation Run Log (on Settings page)

On the Settings > Automations page, add an "Execution Log" section below the rule cards:

```typescript
const { data: executions } = await supabase
  .from('automation_rule_executions')
  .select('*, rule:commercial_automation_rules(name)')
  .eq('company_id', companyId)
  .order('executed_at', { ascending: false })
  .limit(50)
```

**Log table:**
| Time | Rule | Entity | Status | Result |
|---|---|---|---|---|

Status chips: success=green, failed=red, skipped=gray

---

## BUILD ORDER

```
1. Apply migration (Step 0) — verify 5 tables + 3 RPCs
2. Add TypeScript types
3. Add client_deals.quote_id column (ALTER TABLE in migration, or verify it exists)
4. Three API routes: /api/automations/invoice-overdue, /milestone-due, /quote-expiring
5. Quote-accepted API route with create_project + create_rfq helpers
6. Settings > Automations page — rule cards, toggles, run-now buttons, execution log
7. Wire quote-accepted call in quote detail page
8. vercel.json cron setup
9. TypeScript clean build, no regressions
```

---

## KEY PATTERNS

**Toggle automation rule:**
```typescript
await supabase
  .from('commercial_automation_rules')
  .update({ is_active: value })
  .eq('id', ruleId)
  .eq('company_id', companyId) // always scope to company
```

**Run scheduled RPC:**
```typescript
const { data } = await supabase.rpc('process_overdue_invoices', { p_company_id: companyId })
// Returns: { processed: N } or { skipped: true, reason: '...' }
```

**Log execution:**
```typescript
await supabase.from('automation_rule_executions').insert({
  company_id,
  rule_id,
  trigger_type,
  trigger_entity_id: entityId.toString(),
  trigger_entity_type: 'quote' | 'invoice' | 'milestone',
  action_type,
  status: 'success' | 'failed' | 'skipped',
  result: {},
})
```

**Automation errors never block primary actions** — always wrap in try/catch and swallow.

---

## DELIVERABLES CHECKLIST

- [ ] Migration applied, all DB objects verified
- [ ] TypeScript types added
- [ ] `client_deals.quote_id` column confirmed/added
- [ ] `/api/automations/invoice-overdue` route (POST + GET)
- [ ] `/api/automations/milestone-due` route (POST + GET)
- [ ] `/api/automations/quote-expiring` route (POST + GET)
- [ ] `/api/automations/quote-accepted` route (POST only)
- [ ] `Settings > Automations` page — rule cards with toggles + execution log
- [ ] Quote accepted automation wired in quote detail page
- [ ] `vercel.json` cron entries added
- [ ] TypeScript clean build, no regressions
