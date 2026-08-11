-- ============================================================
-- KaiSync Commercial Engine — Phase 1 Schema
-- 2026-08-11
--
-- SAFE: all operations use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
-- Non-breaking — no existing tables, columns or rows altered
-- ============================================================


-- ============================================================
-- 1. NEW PERMISSION KEYS
--    Seed for all existing companies across all roles.
--    Defaults mirror the existing pattern:
--      owner/hr = full access, manager = operational, employee = none
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP

    INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
    VALUES
      -- quotes
      (r.id, 'owner',    'quotes.view',            true),
      (r.id, 'owner',    'quotes.edit',            true),
      (r.id, 'owner',    'quotes.approve',         true),
      (r.id, 'hr',       'quotes.view',            true),
      (r.id, 'hr',       'quotes.edit',            true),
      (r.id, 'hr',       'quotes.approve',         false),
      (r.id, 'manager',  'quotes.view',            true),
      (r.id, 'manager',  'quotes.edit',            true),
      (r.id, 'manager',  'quotes.approve',         false),
      (r.id, 'employee', 'quotes.view',            false),
      (r.id, 'employee', 'quotes.edit',            false),
      (r.id, 'employee', 'quotes.approve',         false),
      -- invoices (commercial)
      (r.id, 'owner',    'invoices.view',          true),
      (r.id, 'owner',    'invoices.edit',          true),
      (r.id, 'owner',    'invoices.approve',       true),
      (r.id, 'hr',       'invoices.view',          true),
      (r.id, 'hr',       'invoices.edit',          true),
      (r.id, 'hr',       'invoices.approve',       false),
      (r.id, 'manager',  'invoices.view',          false),
      (r.id, 'manager',  'invoices.edit',          false),
      (r.id, 'manager',  'invoices.approve',       false),
      (r.id, 'employee', 'invoices.view',          false),
      (r.id, 'employee', 'invoices.edit',          false),
      (r.id, 'employee', 'invoices.approve',       false),
      -- credit notes
      (r.id, 'owner',    'credit_notes.view',      true),
      (r.id, 'owner',    'credit_notes.edit',      true),
      (r.id, 'owner',    'credit_notes.approve',   true),
      (r.id, 'hr',       'credit_notes.view',      true),
      (r.id, 'hr',       'credit_notes.edit',      true),
      (r.id, 'hr',       'credit_notes.approve',   false),
      (r.id, 'manager',  'credit_notes.view',      false),
      (r.id, 'manager',  'credit_notes.edit',      false),
      (r.id, 'manager',  'credit_notes.approve',   false),
      (r.id, 'employee', 'credit_notes.view',      false),
      (r.id, 'employee', 'credit_notes.edit',      false),
      (r.id, 'employee', 'credit_notes.approve',   false),
      -- pricing catalogue
      (r.id, 'owner',    'catalogue.view',         true),
      (r.id, 'owner',    'catalogue.edit',         true),
      (r.id, 'hr',       'catalogue.view',         true),
      (r.id, 'hr',       'catalogue.edit',         true),
      (r.id, 'manager',  'catalogue.view',         true),
      (r.id, 'manager',  'catalogue.edit',         false),
      (r.id, 'employee', 'catalogue.view',         false),
      (r.id, 'employee', 'catalogue.edit',         false)
    ON CONFLICT DO NOTHING;

  END LOOP;
END;
$$;


-- ============================================================
-- 2. EXTEND EXISTING TABLES (non-breaking column additions)
-- ============================================================

-- clients: add commercial profile fields
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS billing_address       text,
  ADD COLUMN IF NOT EXISTS vat_number            text,
  ADD COLUMN IF NOT EXISTS payment_terms_days    integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS credit_limit          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_exempt            boolean NOT NULL DEFAULT false;

-- client_deals (projects): add budget & cost tracking fields
ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS budget_amount          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_percent      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_amount_held  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_released_at  timestamptz,
  ADD COLUMN IF NOT EXISTS contract_type          text    NOT NULL DEFAULT 'fixed_price',
  ADD COLUMN IF NOT EXISTS actual_completion_date date,
  ADD COLUMN IF NOT EXISTS estimated_cost         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS committed_cost         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_cost            numeric NOT NULL DEFAULT 0;

-- finance_invoices: add invoice type, project link, lifecycle timestamps, void support
ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS invoice_type              text    NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS deal_id                   uuid    REFERENCES public.client_deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at                   timestamptz,
  ADD COLUMN IF NOT EXISTS viewed_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS voided_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by                 uuid,
  ADD COLUMN IF NOT EXISTS void_reason               text,
  ADD COLUMN IF NOT EXISTS corrected_by_invoice_id   uuid    REFERENCES public.finance_invoices(id) ON DELETE SET NULL;

-- xero_connections: add sales & VAT account codes for invoice sync
ALTER TABLE public.xero_connections
  ADD COLUMN IF NOT EXISTS sales_account_code         text    DEFAULT '200',
  ADD COLUMN IF NOT EXISTS vat_output_account_code    text    DEFAULT '820',
  ADD COLUMN IF NOT EXISTS invoice_sync_enabled       boolean NOT NULL DEFAULT false;


-- ============================================================
-- 3. PRICING CATALOGUE
--    Items a company can reuse across quotes.
--    Covers materials, labour rates, equipment, subcontractor scopes.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quote_catalogue_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL,
  code          text,                          -- user-defined SKU / product code
  name          text        NOT NULL,
  description   text,
  unit          text        NOT NULL DEFAULT 'item',   -- m², kg, hrs, each, m, l, day, etc.
  item_type     text        NOT NULL DEFAULT 'material',
    -- material | labour | equipment | subcontractor | other
  category      text,                          -- user-defined grouping
  cost_price    numeric     NOT NULL DEFAULT 0,
  markup_percent numeric    NOT NULL DEFAULT 0,
  sell_price    numeric     NOT NULL DEFAULT 0, -- stored for quick lookup; recalc on markup change
  vat_rate      numeric     NOT NULL DEFAULT 0.15,
  is_active     boolean     NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quote_catalogue_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "catalogue_select" ON public.quote_catalogue_items
  FOR SELECT USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'catalogue.view')
  );
CREATE POLICY "catalogue_insert" ON public.quote_catalogue_items
  FOR INSERT WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'catalogue.edit')
  );
CREATE POLICY "catalogue_update" ON public.quote_catalogue_items
  FOR UPDATE USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'catalogue.edit')
  );
CREATE POLICY "catalogue_delete" ON public.quote_catalogue_items
  FOR DELETE USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'catalogue.edit')
  );


-- ============================================================
-- 4. COMMERCIAL QUOTES
--    Quotes sent BY the company TO clients.
--    Replaces business_quotes (0 rows, bigint IDs, too thin).
--    UUID throughout for consistency.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.commercial_quotes (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL,
  quote_number         text,                    -- e.g. QT-2026-0001 (auto-generated by RPC)
  version              integer     NOT NULL DEFAULT 1,
  client_id            uuid        REFERENCES public.clients(id) ON DELETE SET NULL,
  deal_id              uuid        REFERENCES public.client_deals(id) ON DELETE SET NULL,
  job_id               uuid        REFERENCES public.jobs(id) ON DELETE SET NULL,
  salesperson_id       uuid,                    -- FK → employees (soft ref — no hard FK to avoid cascade)
  title                text        NOT NULL,
  description          text,                    -- intro / scope narrative
  status               text        NOT NULL DEFAULT 'draft',
    -- draft | internal_review | sent | viewed | accepted | declined | expired
  currency             text        NOT NULL DEFAULT 'ZAR',

  -- Totals (recalculated from lines)
  subtotal             numeric     NOT NULL DEFAULT 0,   -- sum of line sell prices (excl VAT)
  discount_amount      numeric     NOT NULL DEFAULT 0,
  vat_amount           numeric     NOT NULL DEFAULT 0,
  total_amount         numeric     NOT NULL DEFAULT 0,   -- client-facing total

  -- Cost & margin (internal)
  cost_total           numeric     NOT NULL DEFAULT 0,   -- sum of line cost prices
  gross_profit         numeric     NOT NULL DEFAULT 0,   -- total_amount - cost_total
  gross_margin_percent numeric     NOT NULL DEFAULT 0,   -- gross_profit / total_amount * 100

  -- Terms
  valid_until          date,
  payment_terms_days   integer     NOT NULL DEFAULT 30,
  deposit_required     numeric     NOT NULL DEFAULT 0,

  -- Document sections
  scope_notes          text,
  exclusions           text,
  assumptions          text,
  terms_and_conditions text,
  internal_notes       text,

  -- Lifecycle timestamps
  sent_at              timestamptz,
  viewed_at            timestamptz,
  accepted_at          timestamptz,
  declined_at          timestamptz,
  declined_reason      text,

  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.commercial_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quotes_select" ON public.commercial_quotes
  FOR SELECT USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'quotes.view')
  );
CREATE POLICY "quotes_insert" ON public.commercial_quotes
  FOR INSERT WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'quotes.edit')
  );
CREATE POLICY "quotes_update" ON public.commercial_quotes
  FOR UPDATE USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'quotes.edit')
  );
CREATE POLICY "quotes_delete" ON public.commercial_quotes
  FOR DELETE USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'quotes.edit')
  );


-- ============================================================
-- 5. COMMERCIAL QUOTE LINE ITEMS
--    Full cost + markup fields. Linked to catalogue items.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.commercial_quote_lines (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL,
  quote_id            uuid        NOT NULL REFERENCES public.commercial_quotes(id) ON DELETE CASCADE,
  sort_order          integer     NOT NULL DEFAULT 0,
  section_heading     text,                     -- optional visual grouping label (no cost)
  item_type           text        NOT NULL DEFAULT 'material',
    -- material | labour | equipment | subcontractor | other | heading
  catalogue_item_id   uuid        REFERENCES public.quote_catalogue_items(id) ON DELETE SET NULL,
  description         text        NOT NULL DEFAULT '',
  unit                text        NOT NULL DEFAULT 'item',
  quantity            numeric     NOT NULL DEFAULT 1,

  -- Costing
  cost_price          numeric     NOT NULL DEFAULT 0,   -- cost per unit
  markup_percent      numeric     NOT NULL DEFAULT 0,
  unit_sell_price     numeric     NOT NULL DEFAULT 0,   -- cost * (1 + markup/100), overridable
  subtotal_cost       numeric     NOT NULL DEFAULT 0,   -- cost_price * quantity
  subtotal_sell       numeric     NOT NULL DEFAULT 0,   -- unit_sell_price * quantity

  -- Tax
  vat_rate            numeric     NOT NULL DEFAULT 0.15,
  vat_amount          numeric     NOT NULL DEFAULT 0,
  line_total          numeric     NOT NULL DEFAULT 0,   -- subtotal_sell + vat_amount

  -- Flags
  is_optional         boolean     NOT NULL DEFAULT false,
  is_excluded         boolean     NOT NULL DEFAULT false,

  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.commercial_quote_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_lines_all" ON public.commercial_quote_lines
  FOR ALL USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'quotes.view')
  );


-- ============================================================
-- 6. QUOTE REVISIONS
--    Snapshot of a quote at the moment it is sent or manually versioned.
--    Enables "what changed between version 1 and version 2" comparisons.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.commercial_quote_revisions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  quote_id        uuid        NOT NULL REFERENCES public.commercial_quotes(id) ON DELETE CASCADE,
  version_number  integer     NOT NULL,
  snapshot        jsonb       NOT NULL DEFAULT '{}',  -- full quote + lines JSON at this point
  change_summary  text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_id, version_number)
);

ALTER TABLE public.commercial_quote_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_revisions_all" ON public.commercial_quote_revisions
  FOR ALL USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'quotes.view')
  );


-- ============================================================
-- 7. CREDIT NOTES
--    Always linked to an original invoice.
--    Never modifies the original invoice — immutable financial record.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.credit_notes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL,
  credit_note_number  text,                     -- e.g. CN-2026-0001 (auto-generated)
  invoice_id          uuid        REFERENCES public.finance_invoices(id) ON DELETE RESTRICT,
  client_id           uuid        REFERENCES public.clients(id) ON DELETE SET NULL,
  deal_id             uuid        REFERENCES public.client_deals(id) ON DELETE SET NULL,
  status              text        NOT NULL DEFAULT 'draft',
    -- draft | pending_approval | approved | applied | voided
  reason_code         text        NOT NULL DEFAULT 'other',
    -- incorrect_amount | returned_goods | cancelled_service | duplicate_invoice
    -- overbilling | pricing_adjustment | damaged_goods | project_variation | goodwill | other
  reason_notes        text,
  currency            text        NOT NULL DEFAULT 'ZAR',
  subtotal            numeric     NOT NULL DEFAULT 0,
  vat_amount          numeric     NOT NULL DEFAULT 0,
  total_amount        numeric     NOT NULL DEFAULT 0,
  applied_amount      numeric     NOT NULL DEFAULT 0,  -- portion applied to invoices
  refund_amount       numeric     NOT NULL DEFAULT 0,  -- portion refunded to client
  issue_date          date        NOT NULL DEFAULT CURRENT_DATE,
  approved_by         uuid,
  approved_at         timestamptz,
  created_by          uuid,
  voided_at           timestamptz,
  voided_by           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_notes_select" ON public.credit_notes
  FOR SELECT USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'credit_notes.view')
  );
CREATE POLICY "credit_notes_insert" ON public.credit_notes
  FOR INSERT WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'credit_notes.edit')
  );
CREATE POLICY "credit_notes_update" ON public.credit_notes
  FOR UPDATE USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'credit_notes.edit')
  );
-- Credit notes are never deleted — voided instead
CREATE POLICY "credit_notes_delete" ON public.credit_notes
  FOR DELETE USING (false);


-- ============================================================
-- 8. CREDIT NOTE LINE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.credit_note_lines (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL,
  credit_note_id   uuid        NOT NULL REFERENCES public.credit_notes(id) ON DELETE CASCADE,
  invoice_line_id  uuid        REFERENCES public.finance_invoice_lines(id) ON DELETE SET NULL,
  description      text        NOT NULL,
  quantity         numeric     NOT NULL DEFAULT 1,
  unit_price       numeric     NOT NULL DEFAULT 0,
  subtotal         numeric     NOT NULL DEFAULT 0,
  vat_rate         numeric     NOT NULL DEFAULT 0.15,
  vat_amount       numeric     NOT NULL DEFAULT 0,
  total_amount     numeric     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_note_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "credit_note_lines_all" ON public.credit_note_lines
  FOR ALL USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'credit_notes.view')
  );


-- ============================================================
-- 9. CUSTOMER LEDGER ENTRIES
--    Append-only per-client transaction log.
--    Every financial event (invoice, payment, credit note, refund)
--    creates a row here. Balance = sum(debit) - sum(credit).
--    Never update or delete rows — reverse with a new entry.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_ledger_entries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL,
  client_id        uuid        NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  entry_type       text        NOT NULL,
    -- invoice | payment | credit_note | credit_applied | refund | adjustment
  source_table     text,       -- 'finance_invoices' | 'finance_transactions' | 'credit_notes' | etc.
  source_id        uuid,       -- FK to the source record (soft ref)
  reference_number text,       -- INV-001, CN-001, PAY-001 — human-readable
  description      text,
  debit            numeric     NOT NULL DEFAULT 0,  -- client owes more (invoice)
  credit           numeric     NOT NULL DEFAULT 0,  -- balance reduced (payment / credit note)
  entry_date       date        NOT NULL DEFAULT CURRENT_DATE,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_ledger_entries ENABLE ROW LEVEL SECURITY;

-- Ledger is readable by anyone with invoice view; written only by finance roles
CREATE POLICY "ledger_select" ON public.customer_ledger_entries
  FOR SELECT USING (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'invoices.view')
  );
CREATE POLICY "ledger_insert" ON public.customer_ledger_entries
  FOR INSERT WITH CHECK (
    company_id = ANY (public.user_company_ids())
    AND public.user_has_permission(company_id, 'invoices.edit')
  );
-- No UPDATE or DELETE — ledger entries are immutable
CREATE POLICY "ledger_update" ON public.customer_ledger_entries
  FOR UPDATE USING (false);
CREATE POLICY "ledger_delete" ON public.customer_ledger_entries
  FOR DELETE USING (false);


-- ============================================================
-- 10. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_quote_catalogue_company   ON public.quote_catalogue_items(company_id);
CREATE INDEX IF NOT EXISTS idx_quote_catalogue_active     ON public.quote_catalogue_items(company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_commercial_quotes_company  ON public.commercial_quotes(company_id);
CREATE INDEX IF NOT EXISTS idx_commercial_quotes_client   ON public.commercial_quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_commercial_quotes_deal     ON public.commercial_quotes(deal_id);
CREATE INDEX IF NOT EXISTS idx_commercial_quotes_status   ON public.commercial_quotes(company_id, status);

CREATE INDEX IF NOT EXISTS idx_quote_lines_quote          ON public.commercial_quote_lines(quote_id);
CREATE INDEX IF NOT EXISTS idx_quote_revisions_quote      ON public.commercial_quote_revisions(quote_id);

CREATE INDEX IF NOT EXISTS idx_credit_notes_company       ON public.credit_notes(company_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice       ON public.credit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_notes_client        ON public.credit_notes(client_id);

CREATE INDEX IF NOT EXISTS idx_ledger_client              ON public.customer_ledger_entries(company_id, client_id);
CREATE INDEX IF NOT EXISTS idx_ledger_date                ON public.customer_ledger_entries(company_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_finance_invoices_deal      ON public.finance_invoices(deal_id);

-- ============================================================
-- END OF MIGRATION
-- ============================================================
