# MISSION BRIEF — Commercial Engine Phase 5: AI Features
## For Claude Code | KaiSync Workforce App

---

## CRITICAL CONSTRAINTS
- **`ANTHROPIC_API_KEY` is in Vercel env** — already added, Production + Preview
- **AI errors must never break the quote builder** — all AI calls are additive overlays
- **No AI call touches the DB directly** — AI returns suggestions, user reviews, user commits
- **Log every AI call** to `ai_usage_log` for cost tracking
- **Models**: BOQ extraction = `claude-sonnet-5`, Quote assistant = `claude-haiku-4-5-20251001`

---

## STEP 0 — Install Packages + Apply Migration

### Install packages (run in kaisync-web directory):
```bash
npm install ai @ai-sdk/anthropic zod
```

Verify `ai` ≥ 4.x and `@ai-sdk/anthropic` are in `package.json`.

### Apply migration:
```
Tool: apply_migration
Project: vcivtjwreybaxgtdhtou
File: supabase/migrations/20260811000400_commercial_engine_phase5.sql
```

Verify after applying:
- `ai_usage_log` table exists
- `quote_catalogue_items` has `ai_suggested`, `usage_count`, `last_used_at` columns
- `get_price_suggestions` function exists
- `increment_catalogue_usage` function exists
- `pg_trgm` extension enabled

---

## TYPESCRIPT TYPES

Add to `/types/commercial.ts`:

```typescript
// ─── AI Features ─────────────────────────────────────────────────────────────

// A single extracted BOQ line (from AI)
export interface BoqExtractedLine {
  description: string
  quantity: number
  unit: string
  unit_price: number | null    // null if price not in document
  item_type: 'material' | 'labour' | 'subcontract' | 'equipment' | 'other'
  section?: string             // section heading if document had sections
  notes?: string
}

// A single quote assistant suggestion
export interface QuoteAssistSuggestion {
  description: string
  quantity: number
  unit: string
  item_type: 'material' | 'labour' | 'subcontract' | 'equipment' | 'other'
  catalogue_item_id: string | null   // null = new item not in catalogue
  catalogue_match_name: string | null
  suggested_cost_price: number
  suggested_sell_price: number
  markup_percent: number
  confidence: 'high' | 'medium' | 'low'
  reasoning: string            // why AI suggested this item/price
}

// Price suggestion from catalogue (SQL-based, no AI)
export interface PriceSuggestion {
  catalogue_item_id: string
  name: string
  unit: string
  item_type: string
  cost_price: number
  sell_price: number
  markup_percent: number
  similarity_score: number
  usage_count: number
}
```

---

## SECTION 1 — BOQ Extraction API Route

### File: `/src/app/api/ai/extract-boq/route.ts`

**Accepts:** `multipart/form-data` with either:
- `file`: PDF file (converted to base64)
- `text`: raw pasted text

**Returns:** `{ lines: BoqExtractedLine[], usage: { input_tokens, output_tokens } }`

```typescript
import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const boqLineSchema = z.object({
  lines: z.array(z.object({
    description: z.string().describe('Item description exactly as in the document'),
    quantity:    z.number().describe('Quantity. Use 1 if not specified.'),
    unit:        z.string().describe('Unit of measure (m2, m, each, hr, kg, etc). Use "item" if unclear.'),
    unit_price:  z.number().nullable().describe('Unit price if shown, null if not in document'),
    item_type:   z.enum(['material', 'labour', 'subcontract', 'equipment', 'other'])
                  .describe('Best guess at item type based on description'),
    section:     z.string().optional().describe('Section heading this item falls under'),
    notes:       z.string().optional().describe('Any spec notes or qualifications for this item'),
  }))
})

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve company
  const { data: member } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', user.id)
    .maybeSingle()
  
  // Fallback: get company_id from employees table
  let companyId: string | null = member?.company_id ?? null
  if (!companyId) {
    const { data: emp } = await supabase
      .from('employees')
      .select('company_id')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    companyId = emp?.company_id ?? null
  }
  if (!companyId) return NextResponse.json({ error: 'No company' }, { status: 403 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const text = formData.get('text') as string | null
  const quoteId = formData.get('quote_id') as string | null

  let messageContent: Parameters<typeof generateObject>[0]['messages'][0]['content']

  const systemPrompt = `You are a construction estimating assistant. Extract all line items from the Bill of Quantities provided. 
Be precise about quantities and units. For item_type, classify as:
- material: physical goods, supplies, products
- labour: installation, labour hours, workforce
- subcontract: work done by subcontractors
- equipment: plant, machinery, tools hire
- other: anything else (preliminaries, contingencies, etc)`

  if (file) {
    // PDF via base64
    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    messageContent = [
      { type: 'text', text: 'Extract all line items from this Bill of Quantities document.' },
      { type: 'file', data: base64, mimeType: file.type as 'application/pdf' }
    ]
  } else if (text) {
    messageContent = [{ type: 'text', text: `Extract all line items from this Bill of Quantities:\n\n${text}` }]
  } else {
    return NextResponse.json({ error: 'No file or text provided' }, { status: 400 })
  }

  let usage = { input_tokens: 0, output_tokens: 0 }
  let success = true
  let errorMessage: string | undefined

  try {
    const result = await generateObject({
      model: anthropic('claude-sonnet-5'),
      schema: boqLineSchema,
      system: systemPrompt,
      messages: [{ role: 'user', content: messageContent }],
    })

    usage = {
      input_tokens: result.usage?.promptTokens ?? 0,
      output_tokens: result.usage?.completionTokens ?? 0,
    }

    // Log usage
    await supabase.from('ai_usage_log').insert({
      company_id: companyId,
      feature: 'boq_extraction',
      model: 'claude-sonnet-5',
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      entity_type: quoteId ? 'quote' : 'boq_session',
      entity_id: quoteId ?? crypto.randomUUID(),
      success: true,
    })

    return NextResponse.json({ lines: result.object.lines, usage })

  } catch (err) {
    success = false
    errorMessage = err instanceof Error ? err.message : 'Unknown error'

    await supabase.from('ai_usage_log').insert({
      company_id: companyId,
      feature: 'boq_extraction',
      model: 'claude-sonnet-5',
      input_tokens: 0,
      output_tokens: 0,
      success: false,
      error_message: errorMessage,
    })

    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
```

---

## SECTION 2 — Quote Assistant API Route

### File: `/src/app/api/ai/quote-assist/route.ts`

**Accepts:** `POST { description: string, company_id: string, quote_id?: string }`

**Returns:** `{ suggestions: QuoteAssistSuggestion[], usage: {...} }`

```typescript
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const suggestionSchema = z.object({
  suggestions: z.array(z.object({
    description:          z.string(),
    quantity:             z.number(),
    unit:                 z.string(),
    item_type:            z.enum(['material', 'labour', 'subcontract', 'equipment', 'other']),
    catalogue_item_id:    z.string().nullable()
                           .describe('UUID of matching catalogue item, or null if no match'),
    catalogue_match_name: z.string().nullable(),
    suggested_cost_price: z.number().describe('Estimated cost price in ZAR'),
    suggested_sell_price: z.number().describe('Recommended sell price in ZAR'),
    markup_percent:       z.number(),
    confidence:           z.enum(['high', 'medium', 'low']),
    reasoning:            z.string().describe('Brief explanation of this suggestion'),
  }))
})

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { description, company_id, quote_id } = await request.json()
  if (!description || !company_id) {
    return NextResponse.json({ error: 'Missing description or company_id' }, { status: 400 })
  }

  // Load catalogue items as context
  const { data: catalogue } = await supabase
    .from('quote_catalogue_items')
    .select('id, name, description, unit, item_type, category, cost_price, sell_price, markup_percent')
    .eq('company_id', company_id)
    .eq('is_active', true)
    .order('usage_count', { ascending: false })
    .limit(200)   // cap at 200 to avoid token overflow

  const catalogueContext = catalogue && catalogue.length > 0
    ? `\n\nCOMPANY CATALOGUE (${catalogue.length} items):\n` +
      catalogue.map(c =>
        `- ID:${c.id} | ${c.name} | ${c.unit} | type:${c.item_type} | cost:R${c.cost_price} | sell:R${c.sell_price}`
      ).join('\n')
    : '\n\nNo catalogue items available — suggest reasonable prices for the South African construction market.'

  const systemPrompt = `You are a South African construction estimating assistant with deep knowledge of the local market.
Given a job description, generate a detailed list of quote line items.
${catalogueContext}

Rules:
- PREFER matching to catalogue items (use their exact ID and prices)
- For items NOT in the catalogue, suggest realistic ZAR prices for South Africa
- Typical markup on materials: 20-35%. Labour: 0% markup (sell = cost). Subcontract: 10-15%.
- Be specific — "Tiles 600x600 ceramic" not just "tiles"
- Include all labour and materials needed
- If quantity is uncertain, use reasonable assumptions and note in reasoning`

  try {
    const result = await generateObject({
      model: anthropic('claude-haiku-4-5-20251001'),
      schema: suggestionSchema,
      system: systemPrompt,
      prompt: `Generate quote line items for: ${description}`,
    })

    const usage = {
      input_tokens: result.usage?.promptTokens ?? 0,
      output_tokens: result.usage?.completionTokens ?? 0,
    }

    await supabase.from('ai_usage_log').insert({
      company_id,
      feature: 'quote_assistant',
      model: 'claude-haiku-4-5-20251001',
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      entity_type: 'quote',
      entity_id: quote_id ?? null,
      success: true,
    })

    return NextResponse.json({ suggestions: result.object.suggestions, usage })

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    await supabase.from('ai_usage_log').insert({
      company_id,
      feature: 'quote_assistant',
      model: 'claude-haiku-4-5-20251001',
      input_tokens: 0, output_tokens: 0,
      success: false, error_message: errorMessage,
    })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
```

---

## SECTION 3 — BOQ Import UI Component

### File: `/src/components/BoqImportModal.tsx`

**Triggered from:** the quote builder page via an "Import BOQ" button.

Props:
```typescript
interface Props {
  quoteId: string
  companyId: string
  onImport: (lines: BoqExtractedLine[]) => void  // parent inserts lines into quote
  onClose: () => void
}
```

**Layout — two-step modal:**

**Step 1: Input**
```
Title: "Import Bill of Quantities"

Two tabs:
  [Upload PDF]  [Paste Text]

Upload PDF tab:
  Drag-and-drop zone or click to select
  Accepts: .pdf only
  File size limit: 10MB
  Helper text: "Upload your BOQ document. AI will extract all line items."

Paste Text tab:
  <textarea placeholder="Paste your BOQ table here..." rows={12} />
  Helper text: "Works with plain text, CSV, or copied Excel content."

[Extract Line Items →]  button  (disabled until file or text is provided)
Loading state: "Extracting..." spinner (takes 5–15 seconds)
```

**Step 2: Review extracted lines**
```
Title: "Review Extracted Lines ({count} items found)"

Table:
  [✓] | Description | Qty | Unit | Unit Price | Type | Notes
  
Each row:
  - Checkbox (all checked by default)
  - Editable fields: description, qty, unit, unit_price
  - Type badge (coloured pill)
  - Edit button (inline edit for description)

Footer stats:
  {checked} of {total} lines selected  |  Estimated total: R{sum}

Buttons:
  [← Back]   [Add {checked} lines to Quote]
```

**On "Add lines to Quote":**
```typescript
// Map BoqExtractedLine → commercial_quote_lines insert shape
const linesToInsert = selectedLines.map((line, i) => ({
  company_id:     companyId,
  quote_id:       quoteId,
  sort_order:     existingLineCount + i,
  item_type:      line.item_type,
  description:    line.description,
  unit:           line.unit,
  quantity:       line.quantity,
  unit_sell_price: line.unit_price ?? 0,
  cost_price:     0,       // user fills cost after import
  markup_percent: 0,
  subtotal_sell:  (line.unit_price ?? 0) * line.quantity,
  line_total:     (line.unit_price ?? 0) * line.quantity * 1.15,
  vat_rate:       0.15,
  vat_amount:     (line.unit_price ?? 0) * line.quantity * 0.15,
}))

await supabase.from('commercial_quote_lines').insert(linesToInsert)
onImport(selectedLines)  // parent refreshes quote lines
```

---

## SECTION 4 — Quote Assistant UI Component

### File: `/src/components/QuoteAssistPanel.tsx`

**Triggered from:** a slide-out panel or drawer within the quote builder.

Props:
```typescript
interface Props {
  quoteId: string
  companyId: string
  onAddLines: (lines: CommercialQuoteLineInsert[]) => void
  onClose: () => void
}
```

**Layout — single panel:**

```
Header: "✨ AI Quote Assistant"  [×]

Description textarea:
  <textarea
    placeholder="Describe the work, e.g: Install 20sqm bathroom tiles, 
    plumbing for 1 toilet + basin + shower, tiling grout and waterproofing..."
    rows={4}
  />

[Generate Quote Lines →]  button
  Loading: "Thinking..." (3–8 seconds)

─────── Results ───────

For each suggestion:
  [✓]  [CATALOGUE/NEW badge]  Description          Qty  Unit  R{sell_price}
       [reasoning text in gray, small]
       [markup% badge]  [confidence badge: high=green, medium=amber, low=gray]

Catalogue match: show green "From catalogue" pill with catalogue item name
New item: show blue "New item" pill + small "Add to catalogue" checkbox

─────── Footer ───────
[Add {n} selected lines]   [Clear]

"Add to catalogue" items section:
  If any lines have "Add to catalogue" checked:
  "The following new items will also be saved to your catalogue:"
  - {description} at R{sell_price}
```

**On "Add lines":**
```typescript
async function handleAddLines() {
  const selected = suggestions.filter((s, i) => checked[i])
  
  // 1. Insert quote lines
  const insertRows = selected.map((s, i) => ({
    company_id:       companyId,
    quote_id:         quoteId,
    sort_order:       existingCount + i,
    item_type:        s.item_type,
    catalogue_item_id: s.catalogue_item_id,
    description:      s.description,
    unit:             s.unit,
    quantity:         s.quantity,
    cost_price:       s.suggested_cost_price,
    markup_percent:   s.markup_percent,
    unit_sell_price:  s.suggested_sell_price,
    subtotal_cost:    s.suggested_cost_price * s.quantity,
    subtotal_sell:    s.suggested_sell_price * s.quantity,
    vat_rate:         0.15,
    vat_amount:       s.suggested_sell_price * s.quantity * 0.15,
    line_total:       s.suggested_sell_price * s.quantity * 1.15,
  }))
  await supabase.from('commercial_quote_lines').insert(insertRows)

  // 2. Increment usage count for catalogue matches
  const catalogueMatches = selected
    .filter(s => s.catalogue_item_id)
    .map(s => s.catalogue_item_id!)
  for (const itemId of catalogueMatches) {
    await supabase.rpc('increment_catalogue_usage', { p_item_id: itemId })
  }

  // 3. Save new items to catalogue if checked
  const newItems = selected.filter(s => !s.catalogue_item_id && addToCatalogue[suggestions.indexOf(s)])
  if (newItems.length > 0) {
    await supabase.from('quote_catalogue_items').insert(
      newItems.map(s => ({
        company_id:    companyId,
        name:          s.description,
        unit:          s.unit,
        item_type:     s.item_type,
        cost_price:    s.suggested_cost_price,
        sell_price:    s.suggested_sell_price,
        markup_percent: s.markup_percent,
        ai_suggested:  true,
        usage_count:   1,
        last_used_at:  new Date().toISOString(),
      }))
    )
  }

  onAddLines(insertRows)
}
```

---

## SECTION 5 — Smart Pricing Tooltip (in Quote Builder)

### In the quote line row — on the unit_sell_price field

When user focuses the `unit_sell_price` input and the description is non-empty (≥ 3 chars), fetch price suggestions:

```typescript
async function fetchPriceSuggestions(description: string) {
  if (description.length < 3) return
  const { data } = await supabase.rpc('get_price_suggestions', {
    p_company_id: companyId,
    p_description: description,
    p_limit: 4,
  })
  setPriceSuggestions(data ?? [])
}

// Call with 400ms debounce on description change
useEffect(() => {
  const timer = setTimeout(() => fetchPriceSuggestions(description), 400)
  return () => clearTimeout(timer)
}, [description])
```

**Show a dropdown/popover below the sell price field when suggestions exist:**

```
💡 Price suggestions from your catalogue:

  "Ceramic tiles 600x600"   R185.00/m2  (used 12×)  [Use]
  "Floor tiles 600mm"       R165.00/m2  (used 4×)   [Use]
  "Porcelain tile supply"   R210.00/m2  (used 2×)   [Use]
```

Clicking "Use" sets the sell_price, cost_price, and markup_percent from that catalogue item and sets catalogue_item_id on the line.

**Also call `increment_catalogue_usage`** when user clicks "Use".

---

## SECTION 6 — Wire Buttons into Quote Builder

In the quote builder page (`/money/quotes/[id]/page.tsx` or the quote builder component):

**Add two buttons to the quote toolbar** (near "Add Line" button):

```tsx
{/* AI buttons — show after quote has a title */}
<button onClick={() => setShowBoqModal(true)}>
  📄 Import BOQ
</button>

<button onClick={() => setShowAssistPanel(true)}>
  ✨ AI Assist
</button>
```

**State:**
```typescript
const [showBoqModal, setShowBoqModal] = useState(false)
const [showAssistPanel, setShowAssistPanel] = useState(false)
```

**Render modals/panels:**
```tsx
{showBoqModal && (
  <BoqImportModal
    quoteId={quoteId}
    companyId={companyId}
    onImport={(lines) => { refreshLines(); setShowBoqModal(false) }}
    onClose={() => setShowBoqModal(false)}
  />
)}

{showAssistPanel && (
  <QuoteAssistPanel
    quoteId={quoteId}
    companyId={companyId}
    onAddLines={() => { refreshLines(); setShowAssistPanel(false) }}
    onClose={() => setShowAssistPanel(false)}
  />
)}
```

---

## SECTION 7 — AI Usage Dashboard (in Settings or Reports)

Add a small "AI Usage" card to the Settings > Automations page (or as a tab on the Reports page).

```typescript
// Query last 30 days usage
const { data: usage } = await supabase
  .from('ai_usage_log')
  .select('feature, model, input_tokens, output_tokens, estimated_cost_usd_cents, created_at')
  .eq('company_id', companyId)
  .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
  .order('created_at', { ascending: false })
```

**Show:**
- Total calls this month: {n}
- BOQ extractions: {n}
- Quote assists: {n}
- Estimated cost: ~${totalCents / 100} USD
- Last 10 calls table: Date | Feature | Tokens | Cost | Status

---

## BUILD ORDER

```
1. npm install ai @ai-sdk/anthropic zod
2. Apply migration (Step 0) — verify pg_trgm, tables, RPCs
3. Add TypeScript types to /types/commercial.ts
4. /api/ai/extract-boq/route.ts
5. /api/ai/quote-assist/route.ts
6. BoqImportModal component
7. QuoteAssistPanel component
8. Wire pricing tooltip into quote line row
9. Wire "Import BOQ" + "AI Assist" buttons into quote builder
10. AI usage card in settings/reports
11. tsc --noEmit — must be 0 errors
```

---

## ENV VARS (already set in Vercel)
- `ANTHROPIC_API_KEY` ✅ — added to Production + Preview

## DELIVERABLES CHECKLIST

- [ ] Packages installed (`ai`, `@ai-sdk/anthropic`, `zod`)
- [ ] Migration applied — `pg_trgm`, `ai_usage_log`, catalogue columns, RPCs
- [ ] `/api/ai/extract-boq` route
- [ ] `/api/ai/quote-assist` route
- [ ] `BoqImportModal` — upload PDF or paste text, review table, import
- [ ] `QuoteAssistPanel` — describe job, get suggestions, add to quote + catalogue
- [ ] Smart pricing tooltip on quote line description field
- [ ] "Import BOQ" + "AI Assist" buttons in quote builder
- [ ] AI usage card in settings
- [ ] TypeScript clean build, 0 errors
