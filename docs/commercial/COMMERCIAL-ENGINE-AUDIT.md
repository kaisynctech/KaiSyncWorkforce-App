# KaiSync Commercial Engine — DB Audit Findings
**Date:** 2026-08-11  
**Status:** Pre-build audit — read-only, no changes made  
**Purpose:** Understand what exists before designing the Phase 1 commercial engine schema

---

## 1. WHAT EXISTS TODAY — OVERVIEW

| Table | ID type | Rows | Purpose | Verdict |
|---|---|---|---|---|
| `business_invoices` | bigint | 0 | Outgoing client invoices | ⚠️ Old schema — superseded |
| `business_invoice_payments` | bigint | 0 | Payments on business_invoices | ⚠️ Old schema — superseded |
| `business_quotes` | bigint | 0 | Outgoing client quotes | ⚠️ Too thin — extend or replace |
| `business_quote_items` | bigint | 0 | Quote line items (no cost/markup) | ⚠️ Missing cost fields — rebuild |
| `business_document_sends` | bigint | 0 | Email send log | ✅ Keep |
| `finance_invoices` | UUID | 0 | Newer invoice schema | ✅ Keep & extend |
| `finance_invoice_lines` | UUID | 0 | Invoice line items (has VAT, discount) | ✅ Keep & extend |
| `finance_transactions` | UUID | 0 | Ledger/transaction log | ✅ Keep & wire up |
| `finance_audit_log` | UUID | 0 | Financial audit trail | ✅ Keep & wire up |
| `finance_vat_periods` | UUID | 0 | VAT period tracking | ✅ Keep |
| `supplier_invoices` | UUID | 0 | Supplier bills received | ✅ Well designed — keep |
| `supplier_invoice_lines` | UUID | 0 | Supplier invoice line items | ✅ Keep |
| `client_payments` | bigint | 0 | Payment schedule table | ⚠️ Old schema — superseded |
| `project_client_payments` | UUID | 2 | Actual payment recordings | ✅ Keep & extend |
| `contractor_payouts` | UUID | 0 | Contractor payout approvals | ✅ Good design — keep |
| `contractor_quotes` | UUID | 5 | Inbound contractor quotes | ✅ Keep (different purpose) |
| `contractor_quote_items` | UUID | 4 | Contractor quote line items | ✅ Keep |
| `project_quotation_lines` | UUID | 2 | Basic quote lines on a deal | ⚠️ Supersede with full quote items |
| `client_deals` | UUID | 1 | Projects / deals | ✅ Keep — this IS the project entity |
| `client_deal_updates` | UUID | 5 | Deal status history | ✅ Keep |
| `clients` | UUID | 2 | Client records | ✅ Extend |
| `client_notes` | UUID | 0 | Client notes | ✅ Keep |
| `payment_approvals` | UUID | 5 | **Payroll** approvals (not invoice) | ✅ Keep — different domain |
| `labor_entries` | UUID | 0 | Labor cost per job | ✅ Keep & connect to projects |
| `automation_rules` | bigint | 0 | Automation framework | ✅ Keep & extend |
| `xero_connections` | UUID | 1 | Xero OAuth connection | ✅ Extend for invoices |
| `xero_journal_links` | UUID | 5 | Payroll → Xero (payroll only) | ✅ Extend for invoices |
| `xero_contact_links` | UUID | 0 | KaiSync ↔ Xero contacts | ✅ Ready to use |

---

## 2. CRITICAL FINDING — TWO INVOICE SCHEMAS

There are two invoice systems, **neither has live data**:

### Old system (bigint)
```
business_invoices       → business_invoice_payments
business_quotes         → business_quote_items
client_payments         (payment schedule)
```
Missing: `vat_rate`, `amount_paid`, `project_id`, `created_by`, `is_vat_inclusive`, `discount_amount`

### New system (UUID)
```
finance_invoices        → finance_invoice_lines
                        → finance_transactions (ledger)
```
Has: `vat_rate`, `amount_paid`, `balance_due`, `is_vat_inclusive`, `tax_type`, `discount_amount`, `project_id`, `quote_id`, `created_by`

**Decision: Build on `finance_invoices`. The `business_invoices` tables should be deprecated.**  
The `finance_*` schema is more complete, uses UUID (consistent with rest of DB), and has the right financial fields.

---

## 3. WHAT `client_deals` ACTUALLY IS

`client_deals` is functioning as the **project** entity. It contains:
- `offer_amount` — contract value
- `amount_paid` — running payment total
- `progress_percent` — project completion
- `deposit_required`
- `quotation_notes`, `quotation_valid_until`, `quotation_sent_at` — embedded quotation fields
- `site_start_date`, `expected_completion_date`
- `project_code`
- `manager_employee_id`

The problem: it's doing double duty as both a **deal/quote** and a **project**. The commercial engine needs to separate these clearly:

```
QUOTE (business_quotes, upgraded)
  ↓ accepted
client_deals (project — keep this table, extend it)
```

**Decision: Keep `client_deals` as the project entity. Clean up the embedded quotation fields once a proper quote flow exists. Do NOT rename the table — it has foreign keys elsewhere.**

---

## 4. WHAT `business_quotes` LOOKS LIKE TODAY

```sql
business_quotes:
  id           bigint
  company_id   bigint
  quote_type   text         -- what values exist?
  source_mode  text         -- 'manual' default
  title        text
  partner_id   bigint?
  client_id    bigint?
  job_id       bigint?
  deal_id      bigint?
  status       text         -- 'draft' default
  currency     text         -- 'ZAR'
  subtotal     numeric
  tax_amount   numeric
  total_amount numeric
  valid_until  date?
  notes        text?
  source_file_name text?
  source_file_path text?

business_quote_items:
  id           bigint
  quote_id     bigint
  company_id   bigint
  line_no      int
  description  text
  qty          numeric
  unit_price   numeric      -- SELLING price only
  tax_rate     numeric
  line_total   numeric
```

**Major gaps in `business_quote_items`:**
- No `cost_price` — can't calculate margin
- No `markup_percent` or `margin_percent`
- No `unit` (m², kg, hrs, etc.)
- No `item_type` (material / labour / equipment / subcontractor)
- No `category`
- No `catalogue_item_id` link

**Decision: The `business_quotes` structure is not worth extending — it needs a richer quote line item schema. However, since it has 0 rows we can safely replace rather than migrate.**

---

## 5. WHAT'S MISSING (NEEDS TO BE BUILT)

For Phase 1 of the commercial engine, the following tables do not exist at all:

| Required | Status |
|---|---|
| Pricing catalogue / price list items | ❌ Missing |
| Estimates (pre-quote cost breakdown) | ❌ Missing |
| Quote line items with cost + markup fields | ❌ Missing |
| Quote revisions / versions | ❌ Missing |
| Quote approval workflow | ❌ Missing |
| Credit notes | ❌ Missing |
| Customer ledger (per-client transaction log) | ❌ Missing (finance_transactions exists but unused) |
| Invoice approval workflow | ❌ Missing |
| RFQs + RFQ line items | ❌ Missing (Phase 2) |
| Supplier comparison | ❌ Missing (Phase 2) |
| Purchase orders | ❌ Missing (Phase 2) |

---

## 6. WHAT'S REUSABLE / ALREADY GOOD

These tables are **well-designed and usable as-is or with minor additions**:

| Table | What's good |
|---|---|
| `clients` | Solid. Add: billing_address, vat_number, payment_terms, credit_limit |
| `client_deals` | Good project entity. Add: budget_amount, retention_percent, contract_type |
| `finance_invoices` | Complete invoice schema. Just needs wiring into UI |
| `finance_invoice_lines` | Has VAT, discount per line — ready |
| `finance_transactions` | Ledger architecture is correct — wire it up |
| `finance_audit_log` | Ready — just needs to be called on every financial action |
| `supplier_invoices` | Well designed — keep |
| `contractor_payouts` | Has retention_amount already — excellent |
| `labor_entries` | Cost tracking per job — connect to project financials |
| `automation_rules` | WHEN/action framework in place — extend |
| `xero_connections` | OAuth + account codes already there for payroll — extend for invoices |
| `xero_contact_links` | Generic link table — ready for clients + suppliers |
| `business_document_sends` | Email send log — ready |

---

## 7. ID TYPE INCONSISTENCY

There's a split in the DB between old bigint tables and newer UUID tables:

**Bigint (old):** `business_invoices`, `business_quotes`, `business_quote_items`, `client_payments`, `automation_rules`, `company_id` on some tables

**UUID (new):** `finance_invoices`, `clients`, `client_deals`, `supplier_invoices`, `contractor_payouts`, `finance_transactions`

**Decision: All new commercial engine tables use UUID. No new bigint IDs. The deprecated `business_*` bigint tables will be removed in a future cleanup migration after the UI is fully on the new schema.**

Note: `company_id` is bigint on some tables and uuid on others — be careful when writing queries that join across these tables.

---

## 8. XERO INTEGRATION STATUS

Xero is partially integrated for **payroll only**:
- `xero_connections` — OAuth tokens, 1 active connection
- `xero_journal_links` — pushes payslips as manual journals to Xero
- `xero_contact_links` — generic table ready to map clients/suppliers to Xero contacts

**For the commercial engine, Xero needs to handle:**
- Invoices → push to Xero as Invoices (AR)
- Payments → reconcile in Xero
- Credit notes → push to Xero as Credit Notes
- Supplier invoices → push to Xero as Bills (AP)

**The account code infrastructure exists.** What needs to be added:
- `sales_account_code` on `xero_connections` (currently only has wages/PAYE codes)
- `vat_account_code`
- A `xero_invoice_links` table (like `xero_journal_links` but for finance_invoices)

---

## 9. ACCOUNTING INTEGRATION STRATEGY

Based on the existing Xero integration:

**KaiSync = operational layer**
- Creates and manages quotes, invoices, credit notes, payments
- Tracks project costs, labour, materials
- Sends documents to clients

**Xero / Sage / QuickBooks = accounting layer**
- Receives pushed data from KaiSync
- Handles bank reconciliation, tax returns, management accounts

**For businesses without an accounting platform:**
- `finance_transactions` + `finance_vat_periods` provide enough for basic cash flow and VAT reporting
- Customer statements can be generated from the ledger
- No accounting platform required to use KaiSync commercially

**Priority of integrations:** Xero first (already partially built), then Sage One (popular in SA), then QuickBooks.

---

## 10. RECOMMENDED PHASE 1 SCHEMA ADDITIONS

These are the new tables needed for Phase 1 of the commercial engine. **No existing table is deleted or broken — only additions and non-breaking column additions.**

### New tables to create:

```
quote_catalogue_items     -- pricing catalogue
  (company_id, code, name, description, unit, cost_price, sell_price,
   markup_percent, category, item_type, is_active)

quote_revisions           -- version control for quotes
  (company_id, quote_id, version_number, snapshot_data jsonb,
   created_by, created_at, change_summary)

quote_line_items          -- replaces business_quote_items, with cost + markup
  (company_id, quote_id, revision_id?, line_no, sort_order,
   item_type, catalogue_item_id?, description, unit,
   quantity, cost_price, markup_percent, unit_sell_price,
   subtotal_cost, subtotal_sell, vat_rate, vat_amount,
   line_total, is_optional, is_excluded)

credit_notes              -- credit notes linked to finance_invoices
  (company_id, invoice_id, credit_note_number, status,
   reason_code, reason_notes, subtotal, vat_amount, total_amount,
   applied_amount, refund_amount, created_by, approved_by,
   approved_at, created_at, updated_at)

credit_note_lines         -- line-item credits
  (company_id, credit_note_id, invoice_line_id?,
   description, quantity, unit_price, subtotal, vat_amount, total_amount)

customer_ledger_entries   -- per-client double-entry log
  (company_id, client_id, entry_type, source_table, source_id,
   reference_number, debit, credit, balance_after,
   entry_date, notes, created_by)
```

### Columns to ADD to existing tables (non-breaking):

**`clients`:**
```
billing_address     text
vat_number          text
payment_terms_days  int     DEFAULT 30
credit_limit        numeric DEFAULT 0
tax_exempt          bool    DEFAULT false
xero_contact_id     text    (or use xero_contact_links)
```

**`client_deals` (projects):**
```
budget_amount           numeric DEFAULT 0
retention_percent       numeric DEFAULT 0
retention_amount_held   numeric DEFAULT 0
retention_released_at   timestamptz
contract_type           text    -- 'fixed_price' | 'time_and_materials' | 'cost_plus'
contract_start_date     date
actual_completion_date  date
estimated_cost          numeric DEFAULT 0
committed_cost          numeric DEFAULT 0
actual_cost             numeric DEFAULT 0
```

**`finance_invoices`:**
```
invoice_type        text    -- 'standard' | 'deposit' | 'progress' | 'milestone' | 'final' | 'recurring' | 'proforma'
deal_id             uuid    FK → client_deals
milestone_id        uuid?   FK → future milestones table
sent_at             timestamptz
viewed_at           timestamptz
voided_at           timestamptz
voided_by           uuid
void_reason         text
corrected_by_invoice_id uuid?  -- if this invoice was replaced
```

**`xero_connections`:**
```
sales_account_code      text    DEFAULT '200'
vat_output_account_code text    DEFAULT '820'
vat_input_account_code  text    DEFAULT '820'
invoice_sync_enabled    bool    DEFAULT false
```

---

## 11. TABLES TO DEPRECATE (FUTURE CLEANUP)

These tables should be removed after the new schema is wired into the UI and all zero-row old tables are confirmed unused:

| Table | Reason |
|---|---|
| `business_invoices` | Superseded by `finance_invoices` |
| `business_invoice_payments` | Superseded by `finance_transactions` |
| `business_quote_items` | Too thin — replaced by `quote_line_items` |
| `client_payments` | Superseded by `project_client_payments` |
| `project_quotation_lines` | Superseded by `quote_line_items` |

**Do NOT drop these now.** First wire the new schema into the UI, confirm 0 rows remain, then drop in a separate migration. `business_quotes` itself (the header) can be kept and upgraded since it already has the right shape — just replace its items table.

---

## 12. SUMMARY FOR PHASE 1 BUILD

### Build sequence:

1. **Extend `clients`** — add billing_address, vat_number, payment_terms_days, credit_limit
2. **Create `quote_catalogue_items`** — pricing catalogue foundation
3. **Create `quote_line_items`** — full cost + markup line items
4. **Upgrade `business_quotes`** — add quote_number, salesperson_id, payment_terms, scope, exclusions, terms
5. **Create `quote_revisions`** — version history
6. **Upgrade `finance_invoices`** — add invoice_type, deal_id, sent_at, viewed_at, void fields
7. **Create `credit_notes` + `credit_note_lines`**
8. **Create `customer_ledger_entries`** — wire finance_transactions into a per-client ledger view
9. **Extend `xero_connections`** — add sales + VAT account codes
10. **Wire `finance_audit_log`** — call it on every financial action

### What NOT to touch in Phase 1:
- RFQ tables (Phase 2)
- Purchase orders (Phase 2)
- Project cost tracking / milestones (Phase 3)
- AI features (Phase 5)
- Retention release workflow (Phase 3 — schema columns added in Phase 1 are enough)

---

*Audit complete. No DB changes have been made. All findings are based on read-only schema inspection.*
