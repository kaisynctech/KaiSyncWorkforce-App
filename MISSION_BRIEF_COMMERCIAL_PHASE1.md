# MISSION BRIEF — Commercial Engine Phase 1
**Target:** kaisync-web (Next.js, Supabase — project `vcivtjwreybaxgtdhtou`)  
**Rule:** Verify every table and column against the live DB before writing any query. No assumptions.

---

## STEP 0 — APPLY MIGRATION FIRST

Before writing any UI code, apply the migration using the Supabase MCP tool.

The full migration SQL is in:
```
supabase/migrations/20260811000000_commercial_engine_phase1.sql
```

Apply it using `apply_migration` with the project ID `vcivtjwreybaxgtdhtou` and the full contents of that file.

After applying, verify these tables exist before proceeding:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'quote_catalogue_items', 'commercial_quotes', 'commercial_quote_lines',
    'commercial_quote_revisions', 'credit_notes', 'credit_note_lines',
    'customer_ledger_entries'
  )
ORDER BY table_name;
```
Expected: 7 rows returned. If any are missing, re-check the migration output for errors before proceeding.

---

## CONTEXT

KaiSync is adding a full commercial engine. Phase 1 delivers the core Quote-to-Invoice foundation:

1. **Pricing Catalogue** — reusable items with cost + markup
2. **Quote Builder** — professional quotes with line items, cost/margin calculation, PDF
3. **Quote → Invoice** — convert an accepted quote to a `finance_invoices` record
4. **Invoices page upgrade** — existing Money/Invoices page now uses `finance_invoices` (not `business_invoices`)
5. **Credit Notes** — issue credits against issued invoices

All new pages live under `/dashboard/money/` or `/dashboard/commercial/` (see routing below).

---

## ROUTING

Add to the dashboard sidebar under the **Money** section:

| Route | Label | Icon |
|---|---|---|
| `/dashboard/money/quotes` | Quotes | `FileText` |
| `/dashboard/money/quotes/new` | (no nav, nested) | — |
| `/dashboard/money/quotes/[id]` | (no nav, nested) | — |
| `/dashboard/money/catalogue` | Price Catalogue | `Tag` |
| `/dashboard/money/credit-notes` | Credit Notes | `RotateCcw` |

The existing `/dashboard/money/invoices` page stays but is upgraded (see Section 4).

---

## SECTION 1 — PRICING CATALOGUE

**Page:** `/dashboard/money/catalogue/page.tsx`

### UI
- Full-width table: Code | Name | Category | Type | Unit | Cost | Markup % | Sell Price | VAT | Status | Actions
- Filters: item_type (All / Material / Labour / Equipment / Subcontractor / Other), category, is_active toggle
- "New Item" button → opens slide-over drawer (not a separate page)
- Each row: Edit (pencil) and Archive (trash → sets `is_active = false`) actions
- Inactive items shown greyed out; hide by default, show with "Show archived" toggle

### Drawer — Create / Edit Item
Fields:
```
Name*           text input
Code            text input (optional SKU)
Category        text input (free text, autocomplete from existing categories)
Type*           select: Material | Labour | Equipment | Subcontractor | Other
Unit*           select with custom: each | m² | m | kg | l | hrs | day | item
Cost Price*     numeric (R)
Markup %        numeric — updates Sell Price live
Sell Price*     numeric (R) — overridable; recalculates markup % on manual change
VAT Rate        select: 15% (Standard) | 0% (Zero Rated) | Exempt
Active          toggle
Description     textarea (optional)
```

**Margin display** (live, below cost/markup/sell fields):
```
Cost: R1,000   Markup: 25%   Sell: R1,250   Margin: 20.0%
```
Show the formula note: *Markup 25% ≠ Margin 25%. Margin = profit ÷ sell price.*

### DB Queries

**List:**
```typescript
const { data } = await supabase
  .from('quote_catalogue_items')
  .select('*')
  .eq('company_id', member.companyId)
  .order('category', { ascending: true })
  .order('name', { ascending: true })
```

**Upsert:**
```typescript
await supabase
  .from('quote_catalogue_items')
  .upsert({ ...fields, company_id: member.companyId, updated_at: new Date().toISOString() })
```

**Sell price calculation:**
```typescript
const sellPrice = costPrice * (1 + markupPercent / 100)
const marginPercent = ((sellPrice - costPrice) / sellPrice) * 100
```

---

## SECTION 2 — QUOTE BUILDER

### 2a. Quote List Page
**Page:** `/dashboard/money/quotes/page.tsx`

- Table: # | Client | Title | Value | Status | Created | Valid Until | Actions
- Status badge colours: draft=slate, internal_review=blue, sent=amber, viewed=purple, accepted=green, declined=red, expired=grey
- Filters: status, date range
- "New Quote" button → `/dashboard/money/quotes/new`
- Row click → `/dashboard/money/quotes/[id]`

**DB Query:**
```typescript
const { data } = await supabase
  .from('commercial_quotes')
  .select('id, quote_number, title, status, total_amount, gross_margin_percent, valid_until, created_at, clients(name)')
  .eq('company_id', member.companyId)
  .order('created_at', { ascending: false })
```

---

### 2b. New / Edit Quote Page
**Page:** `/dashboard/money/quotes/new/page.tsx` and `/dashboard/money/quotes/[id]/page.tsx`

This is the main quote builder. Single-page editor with sections.

#### Header section
```
Client*         searchable select (from clients table)
Title*          text input — e.g. "Bathroom renovation — 14 Oak Street"
Valid Until     date picker (default: today + 30 days)
Payment Terms   numeric (days) — default 30
Deposit Required numeric (R) — optional
Salesperson     searchable select (from employees)
Internal Notes  textarea (hidden from client)
```

#### Body tabs: **Line Items | Scope & Terms | Summary**

---

**Tab: Line Items**

Table with rows:
```
[↕] [Type] [Description] [Unit] [Qty] [Cost] [Markup%] [Sell] [VAT] [Total] [⋮]
```

- Each row is editable inline
- Drag handle `↕` for reordering (update `sort_order`)
- `[⋮]` menu: Mark as optional | Mark as excluded | Delete
- "Add Line" button at bottom → appends a blank row
- "Add from Catalogue" button → opens catalogue picker modal (search + filter, click to append)
- "Add Section Heading" button → inserts a heading row (`item_type = 'heading'`, no cost)

**Inline calculations per row (live):**
```typescript
subtotal_sell   = unit_sell_price * quantity
unit_sell_price = cost_price * (1 + markup_percent / 100)
vat_amount      = subtotal_sell * vat_rate
line_total      = subtotal_sell + vat_amount
```

**Quote totals panel (right side, sticky):**
```
Subtotal (excl VAT)     R XX,XXX
Discount                R -X,XXX
VAT (15%)               R X,XXX
─────────────────────────────────
TOTAL                   R XX,XXX
═════════════════════════════════
Cost Total              R XX,XXX   (internal)
Gross Profit            R XX,XXX   (internal)
Gross Margin            XX.X%      (internal)
```

Cost/Profit/Margin rows are highlighted but not shown on the client-facing PDF.

**Margin simulator** (collapsible panel below totals):
- Slider: markup 0% → 100%
- Live update: shows sell price, gross profit, gross margin
- "Set target margin" input: enter 30% → calculates required sell price

---

**Tab: Scope & Terms**
```
Scope of Work       rich textarea (multiline)
Exclusions          textarea
Assumptions         textarea
Terms & Conditions  textarea (with "Use default T&Cs" button → loads from company_settings)
```

---

**Tab: Summary**

Read-only preview of the financial breakdown:
```
Materials          R XX,XXX    XX%
Labour             R XX,XXX    XX%
Equipment          R XX,XXX    XX%
Subcontractors     R XX,XXX    XX%
Other              R XX,XXX    XX%
─────────────────────────────────
Total Cost         R XX,XXX
Total Sell         R XX,XXX
Gross Profit       R XX,XXX
Gross Margin       XX.X%
```

---

#### Quote actions toolbar (top right)
```
[Save Draft]  [Send to Client ▾]  [⋮ More]
```

`Send to Client` → changes status to `sent`, sets `sent_at`, opens "Send" modal with:
- Recipient email (prefilled from client)
- Subject (prefilled: "Quote QT-2026-0001 — {title}")
- Message body (editable)
- PDF preview button
- Send button

`⋮ More`:
- Mark as Accepted → sets `status = accepted`, `accepted_at`, triggers create-project prompt
- Mark as Declined → sets `status = declined`, asks for reason
- Duplicate Quote
- Download PDF

---

#### Auto quote number generation (RPC)

Create Supabase RPC `generate_quote_number(p_company_id uuid)`:
```sql
CREATE OR REPLACE FUNCTION public.generate_quote_number(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year    text := to_char(now(), 'YYYY');
  v_seq     int;
  v_number  text;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(quote_number, '-', 3) AS int)
  ), 0) + 1
  INTO v_seq
  FROM public.commercial_quotes
  WHERE company_id = p_company_id
    AND quote_number LIKE 'QT-' || v_year || '-%';

  v_number := 'QT-' || v_year || '-' || LPAD(v_seq::text, 4, '0');
  RETURN v_number;
END;
$$;
```

Call this RPC when a new quote is first saved (status moves from unsaved → draft).

---

#### DB Save pattern

Save header + lines in a single async flow:
1. Upsert `commercial_quotes` → get `id`
2. Delete existing lines for this quote: `.delete().eq('quote_id', id)`
3. Insert all current lines with `quote_id`
4. Recalculate and update quote totals in the same upsert

```typescript
// Recalculate totals from lines
const subtotal       = lines.reduce((s, l) => s + l.subtotal_sell, 0)
const vatAmount      = lines.reduce((s, l) => s + l.vat_amount, 0)
const totalAmount    = subtotal - discountAmount + vatAmount
const costTotal      = lines.reduce((s, l) => s + l.subtotal_cost, 0)
const grossProfit    = totalAmount - costTotal
const grossMargin    = totalAmount > 0 ? (grossProfit / totalAmount) * 100 : 0
```

---

### 2c. Quote → Project Prompt

When `status` is set to `accepted`:

Show a modal:
```
✅ Quote Accepted
This quote can automatically create a project.

Project Title:   [prefilled from quote title]
Contract Value:  R XX,XXX (prefilled, editable)
Start Date:      [date picker]
Manager:         [employee select]

[Create Project]    [Skip for now]
```

On "Create Project" → insert into `client_deals`:
```typescript
{
  company_id:   quote.company_id,
  client_id:    quote.client_id,
  title:        quote.title,
  status:       'active',
  offer_amount: quote.total_amount,
  budget_amount: quote.total_amount,
  estimated_cost: quote.cost_total,
  deposit_required: quote.deposit_required,
  manager_employee_id: selectedManagerId,
  site_start_date: selectedStartDate,
}
```

Then update the quote: `deal_id = newDealId`.

---

## SECTION 3 — QUOTE → INVOICE

On a quote with `status = accepted`, show "Create Invoice" button in `⋮ More`.

Opens modal:
```
Invoice Type:   [Standard ▾]   (Standard | Deposit | Progress | Final)
Issue Date:     [today]
Due Date:       [today + payment_terms_days]
Invoice covers: ○ Full quote amount   ○ Custom amount
Amount:         R XX,XXX
```

On confirm → insert `finance_invoices`:
```typescript
{
  company_id:   quote.company_id,
  client_id:    quote.client_id,
  quote_id:     quote.id,
  deal_id:      quote.deal_id,
  invoice_type: selectedType,
  status:       'draft',
  currency:     quote.currency,
  subtotal:     ...,
  vat_amount:   ...,
  total_amount: selectedAmount,
  balance_due:  selectedAmount,
  issue_date:   issueDate,
  due_date:     dueDate,
  created_by:   auth.uid(),
}
```

Then insert matching `finance_invoice_lines` (copied from quote lines).

Redirect to `/dashboard/money/invoices/[newInvoiceId]`.

---

## SECTION 4 — UPGRADE MONEY/INVOICES PAGE

**Current state:** `/dashboard/money/invoices/page.tsx` — queries `business_invoices` (0 rows, old schema).

**Required:** Switch to `finance_invoices` + `finance_invoice_lines`.

### New invoice list query:
```typescript
const { data } = await supabase
  .from('finance_invoices')
  .select(`
    id, invoice_number, invoice_type, status,
    total_amount, amount_paid, balance_due,
    issue_date, due_date, paid_date,
    clients(name),
    client_deals(title)
  `)
  .eq('company_id', member.companyId)
  .order('created_at', { ascending: false })
```

### Invoice detail page: `/dashboard/money/invoices/[id]/page.tsx`

Sections:
- Header: invoice number, status badge, client, project link, dates
- Line items table (from `finance_invoice_lines`)
- Totals: subtotal, discount, VAT, total, amount_paid, **balance_due**
- Payment history panel (from `finance_transactions` where `source_table = 'finance_invoices'` and `source_id = invoiceId`)

Actions:
- **Record Payment** → insert `finance_transactions` + update `finance_invoices.amount_paid` and `balance_due` + insert `customer_ledger_entries`
- **Send Invoice** → sets `sent_at`
- **Void Invoice** → sets `status = voided`, `voided_at`, requires `void_reason`. Only allowed on unpaid invoices.
- **Issue Credit Note** → opens credit note flow (see Section 5)

### Record Payment modal:
```
Payment Date:    [date picker]
Amount:          R [number] (max = balance_due)
Payment Method:  [Bank Transfer | Cash | EFT | Cheque | Card | Other]
Reference:       [text]
Notes:           [text]
```

On save:
```typescript
// 1. Insert finance_transaction
await supabase.from('finance_transactions').insert({
  company_id, transaction_type: 'payment', direction: 'in',
  source_table: 'finance_invoices', source_id: invoiceId,
  amount, total_amount: amount, transaction_date, payment_method, reference, notes, created_by
})

// 2. Update invoice
const newAmountPaid = invoice.amount_paid + amount
const newBalance    = invoice.total_amount - newAmountPaid
await supabase.from('finance_invoices').update({
  amount_paid: newAmountPaid,
  balance_due: newBalance,
  status: newBalance <= 0 ? 'paid' : 'partially_paid',
  paid_date: newBalance <= 0 ? new Date().toISOString().split('T')[0] : null,
}).eq('id', invoiceId)

// 3. Insert ledger entry
await supabase.from('customer_ledger_entries').insert({
  company_id, client_id: invoice.client_id,
  entry_type: 'payment',
  source_table: 'finance_invoices', source_id: invoiceId,
  reference_number: invoice.invoice_number,
  description: `Payment received — ${invoice.invoice_number}`,
  debit: 0, credit: amount, entry_date: transaction_date
})
```

---

## SECTION 5 — CREDIT NOTES

**Page:** `/dashboard/money/credit-notes/page.tsx`

### List page
Table: # | Invoice | Client | Amount | Reason | Status | Date | Actions

### Create Credit Note

Triggered from invoice detail page via "Issue Credit Note" button.

**Modal / drawer:**
```
Original Invoice:   INV-2026-0001   R115,000   (read-only)
Credit Type:        ○ Full credit   ● Partial credit
Reason:             [select: Incorrect Amount | Returned Goods | Cancelled Service |
                     Duplicate Invoice | Overbilling | Pricing Adjustment |
                     Damaged Goods | Project Variation | Goodwill | Other]
Notes:              [textarea]
```

For partial credit — show line item table (copied from invoice lines):
```
[✓] Labour          R40,000    Credit: R0        [R input]
[✓] Materials       R50,000    Credit: R25,000   [R input]
[✓] Equipment       R15,000    Credit: R0        [R input]
[✓] Delivery        R10,000    Credit: R0        [R input]
```

Total credit calculated live from inputs.

On create:
1. Insert `credit_notes`
2. Insert `credit_note_lines`
3. Insert `customer_ledger_entries` (entry_type: `credit_note`, debit: 0, credit: total)
4. If credit_note total = invoice total → update `finance_invoices.status = voided` and set `corrected_by_invoice_id` if applicable

### Credit note detail
Shows: linked invoice, reason, lines, totals, status trail, approval (if pending_approval).

---

## SECTION 6 — CLIENT COMMERCIAL PROFILE

**Existing page:** `/dashboard/operations/clients/[id]/page.tsx`

Add a new **"Commercial"** tab to the client detail page showing:

- Payment terms, credit limit, VAT number (editable fields from new columns)
- Quote history table (from `commercial_quotes`)
- Invoice history table (from `finance_invoices`)
- Customer ledger (from `customer_ledger_entries`)
- Outstanding balance = sum(debit) - sum(credit) from ledger

---

## GENERAL RULES

1. **Never use `business_invoices`** for new code. All invoice work uses `finance_invoices`.
2. **Every financial write** (invoice created, payment recorded, credit note issued) must insert a `customer_ledger_entries` row.
3. **Never delete** issued invoices or credit notes — void them (set `voided_at`).
4. **Finance audit log** — call `finance_audit_log` insert for: invoice sent, invoice voided, credit note created, credit note approved, payment recorded.
5. All amounts stored as `numeric` — no floating point. Use `toFixed(2)` for display.
6. Verify `member.companyId` is a UUID before any query to `finance_invoices` (it's UUID; don't pass a bigint).

---

## TYPESCRIPT TYPES (add to types file)

```typescript
export type QuoteCatalogueItem = {
  id: string
  company_id: string
  code: string | null
  name: string
  description: string | null
  unit: string
  item_type: 'material' | 'labour' | 'equipment' | 'subcontractor' | 'other'
  category: string | null
  cost_price: number
  markup_percent: number
  sell_price: number
  vat_rate: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type CommercialQuote = {
  id: string
  company_id: string
  quote_number: string | null
  version: number
  client_id: string | null
  deal_id: string | null
  job_id: string | null
  salesperson_id: string | null
  title: string
  description: string | null
  status: 'draft' | 'internal_review' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired'
  currency: string
  subtotal: number
  discount_amount: number
  vat_amount: number
  total_amount: number
  cost_total: number
  gross_profit: number
  gross_margin_percent: number
  valid_until: string | null
  payment_terms_days: number
  deposit_required: number
  scope_notes: string | null
  exclusions: string | null
  assumptions: string | null
  terms_and_conditions: string | null
  internal_notes: string | null
  sent_at: string | null
  viewed_at: string | null
  accepted_at: string | null
  declined_at: string | null
  declined_reason: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CommercialQuoteLine = {
  id: string
  company_id: string
  quote_id: string
  sort_order: number
  section_heading: string | null
  item_type: 'material' | 'labour' | 'equipment' | 'subcontractor' | 'other' | 'heading'
  catalogue_item_id: string | null
  description: string
  unit: string
  quantity: number
  cost_price: number
  markup_percent: number
  unit_sell_price: number
  subtotal_cost: number
  subtotal_sell: number
  vat_rate: number
  vat_amount: number
  line_total: number
  is_optional: boolean
  is_excluded: boolean
}

export type CreditNote = {
  id: string
  company_id: string
  credit_note_number: string | null
  invoice_id: string | null
  client_id: string | null
  deal_id: string | null
  status: 'draft' | 'pending_approval' | 'approved' | 'applied' | 'voided'
  reason_code: string
  reason_notes: string | null
  currency: string
  subtotal: number
  vat_amount: number
  total_amount: number
  applied_amount: number
  refund_amount: number
  issue_date: string
  approved_by: string | null
  approved_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CustomerLedgerEntry = {
  id: string
  company_id: string
  client_id: string
  entry_type: 'invoice' | 'payment' | 'credit_note' | 'credit_applied' | 'refund' | 'adjustment'
  source_table: string | null
  source_id: string | null
  reference_number: string | null
  description: string | null
  debit: number
  credit: number
  entry_date: string
  created_at: string
}
```

---

## BUILD ORDER

1. Apply migration → verify new tables exist via Supabase dashboard
2. Pricing Catalogue page + drawer (standalone, no dependencies)
3. Quote List + Quote Builder (depends on catalogue for "Add from Catalogue")
4. Quote → Invoice conversion (depends on finance_invoices being queryable)
5. Upgrade Money/Invoices to finance_invoices (parallel with above)
6. Credit Notes page
7. Client commercial tab (depends on all above)
