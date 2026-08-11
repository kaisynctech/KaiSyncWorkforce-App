-- ============================================================
-- KaiSync Commercial Engine — Phase 3: Project Financials
-- 2026-08-11
--
-- Adds: project milestones, milestone invoicing, project cost
--       entries, retention release workflow, profitability view
--
-- Builds on: client_deals Phase 1 columns (budget_amount,
--   retention_percent, retention_amount_held, estimated_cost,
--   committed_cost, actual_cost, contract_type)
--   and finance_invoices (deal_id, invoice_type) from Phase 1
-- ============================================================


-- ============================================================
-- 1. NEW PERMISSION KEY
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.companies LOOP
    INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
    VALUES
      -- projects.financials: who can see cost/margin data
      (r.id, 'owner',    'projects.financials', true),
      (r.id, 'hr',       'projects.financials', true),
      (r.id, 'manager',  'projects.financials', false),
      (r.id, 'employee', 'projects.financials', false)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;


-- ============================================================
-- 2. EXTEND finance_invoices
--    Add milestone_id so milestone invoices link back to their trigger
-- ============================================================
ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS milestone_id uuid;
  -- FK added after project_milestones is created (see bottom)


-- ============================================================
-- 3. PROJECT MILESTONES
--    Each milestone can trigger an invoice when marked complete.
--    Milestones can also represent retention release.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_milestones (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL,
  deal_id              uuid        NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  sort_order           integer     NOT NULL DEFAULT 0,
  name                 text        NOT NULL,
  description          text,
  due_date             date,
  completion_date      date,
  -- Amount to invoice when this milestone is reached
  invoice_amount       numeric     NOT NULL DEFAULT 0,
  invoice_percentage   numeric     NOT NULL DEFAULT 0,   -- % of contract value; mutually exclusive with invoice_amount
  -- Whether invoicing is triggered by this milestone
  triggers_invoice     boolean     NOT NULL DEFAULT false,
  invoice_id           uuid,                            -- set once invoice is created
  -- Is this the retention release milestone?
  is_retention_release boolean     NOT NULL DEFAULT false,
  status               text        NOT NULL DEFAULT 'pending',
    -- pending | in_progress | completed | cancelled
  completed_by         uuid,
  notes                text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milestones_select" ON public.project_milestones FOR SELECT
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'projects.view'));
CREATE POLICY "milestones_insert" ON public.project_milestones FOR INSERT
  WITH CHECK (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'projects.edit'));
CREATE POLICY "milestones_update" ON public.project_milestones FOR UPDATE
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'projects.edit'));
CREATE POLICY "milestones_delete" ON public.project_milestones FOR DELETE
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'projects.edit'));


-- ============================================================
-- 4. NOW SAFE — add FK from finance_invoices to project_milestones
-- ============================================================
ALTER TABLE public.finance_invoices
  ADD CONSTRAINT fk_invoice_milestone
  FOREIGN KEY (milestone_id) REFERENCES public.project_milestones(id) ON DELETE SET NULL
  NOT VALID;   -- NOT VALID avoids full table scan; validates on next vacuum


-- ============================================================
-- 5. PROJECT COST ENTRIES
--    Granular cost ledger per project.
--    Sources: manual entry, PO (committed), supplier invoice (actual)
--    Categories: labour, materials, subcontract, equipment, overhead, other
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_cost_entries (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL,
  deal_id              uuid        NOT NULL REFERENCES public.client_deals(id) ON DELETE CASCADE,
  -- Cost classification
  cost_type            text        NOT NULL DEFAULT 'actual',
    -- estimated | committed | actual
  category             text        NOT NULL DEFAULT 'materials',
    -- labour | materials | subcontract | equipment | overhead | other
  -- Source linkage (one of these is set, or none for manual)
  source               text        NOT NULL DEFAULT 'manual',
    -- manual | purchase_order | supplier_invoice | quote_estimate
  source_id            uuid,                            -- pk of the linked source record
  source_reference     text,                            -- human-readable: PO number, invoice number, etc.
  -- The cost
  description          text        NOT NULL,
  quantity             numeric     NOT NULL DEFAULT 1,
  unit_cost            numeric     NOT NULL DEFAULT 0,
  total_cost           numeric     NOT NULL DEFAULT 0,   -- = quantity * unit_cost
  -- Metadata
  cost_date            date        NOT NULL DEFAULT CURRENT_DATE,
  notes                text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_cost_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cost_entries_select" ON public.project_cost_entries FOR SELECT
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'projects.financials'));
CREATE POLICY "cost_entries_insert" ON public.project_cost_entries FOR INSERT
  WITH CHECK (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'projects.edit'));
CREATE POLICY "cost_entries_update" ON public.project_cost_entries FOR UPDATE
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'projects.edit'));
CREATE POLICY "cost_entries_delete" ON public.project_cost_entries FOR DELETE
  USING (company_id = ANY(public.user_company_ids()) AND public.user_has_permission(company_id, 'projects.edit'));


-- ============================================================
-- 6. PROJECT FINANCIAL SUMMARY VIEW
--    One row per project. Aggregates revenue, costs, margin.
--    Used for the profitability dashboard and Financials tab.
-- ============================================================
CREATE OR REPLACE VIEW public.project_financial_summary AS
SELECT
  d.id                                                            AS deal_id,
  d.company_id,
  d.title,
  d.status,
  d.contract_type,
  d.offer_amount                                                  AS contract_value,
  d.budget_amount,
  d.estimated_cost,
  d.committed_cost,
  d.actual_cost,
  d.retention_percent,
  d.retention_amount_held,
  d.retention_released_at,
  d.site_start_date,
  d.expected_completion_date,
  d.actual_completion_date,

  -- Revenue: total invoiced (finance_invoices)
  COALESCE(inv.total_invoiced, 0)                                 AS total_invoiced,
  COALESCE(inv.total_received, 0)                                 AS total_received,
  COALESCE(inv.invoice_count, 0)                                  AS invoice_count,
  COALESCE(inv.outstanding_balance, 0)                            AS outstanding_balance,

  -- Costs from project_cost_entries (structured cost ledger)
  COALESCE(ce.estimated_cost_entries, 0)                          AS estimated_cost_entries,
  COALESCE(ce.committed_cost_entries, 0)                          AS committed_cost_entries,
  COALESCE(ce.actual_cost_entries, 0)                             AS actual_cost_entries,

  -- Costs from purchase orders (committed spend via POs)
  COALESCE(po.total_po_value, 0)                                  AS total_po_value,
  COALESCE(po.total_po_received, 0)                               AS total_po_received,

  -- Supplier invoices (actual spend billed by suppliers)
  COALESCE(si.total_supplier_invoiced, 0)                         AS total_supplier_invoiced,
  COALESCE(si.total_supplier_paid, 0)                             AS total_supplier_paid,

  -- Milestones
  COALESCE(ms.total_milestones, 0)                                AS total_milestones,
  COALESCE(ms.completed_milestones, 0)                            AS completed_milestones,
  COALESCE(ms.invoiced_milestones, 0)                             AS invoiced_milestones,

  -- Profitability calculations (using actual costs as the base)
  -- Actual cost = MAX(actual_cost column, actual_cost_entries, total_supplier_invoiced)
  -- We use total_supplier_invoiced as the primary actual cost signal when available
  GREATEST(
    d.actual_cost,
    COALESCE(ce.actual_cost_entries, 0),
    COALESCE(si.total_supplier_invoiced, 0)
  )                                                               AS best_actual_cost,

  COALESCE(inv.total_invoiced, 0)
    - GREATEST(
        d.actual_cost,
        COALESCE(ce.actual_cost_entries, 0),
        COALESCE(si.total_supplier_invoiced, 0)
      )                                                           AS gross_profit,

  CASE
    WHEN COALESCE(inv.total_invoiced, 0) = 0 THEN 0
    ELSE ROUND(
      (COALESCE(inv.total_invoiced, 0)
        - GREATEST(
            d.actual_cost,
            COALESCE(ce.actual_cost_entries, 0),
            COALESCE(si.total_supplier_invoiced, 0)
          )
      ) / COALESCE(inv.total_invoiced, 0) * 100,
      2
    )
  END                                                             AS gross_margin_percent,

  -- Budget variance (offer_amount as budget reference)
  d.offer_amount - GREATEST(
    d.estimated_cost,
    COALESCE(ce.estimated_cost_entries, 0)
  )                                                               AS estimated_budget_variance,

  d.offer_amount - GREATEST(
    d.actual_cost,
    COALESCE(ce.actual_cost_entries, 0),
    COALESCE(si.total_supplier_invoiced, 0)
  )                                                               AS actual_budget_variance

FROM public.client_deals d

-- Revenue aggregates from finance_invoices
LEFT JOIN (
  SELECT
    deal_id,
    SUM(total_amount)                 AS total_invoiced,
    SUM(amount_paid)                  AS total_received,
    COUNT(*)                          AS invoice_count,
    SUM(balance_due)                  AS outstanding_balance
  FROM public.finance_invoices
  WHERE status NOT IN ('void', 'draft')
  GROUP BY deal_id
) inv ON inv.deal_id = d.id

-- Cost entry aggregates
LEFT JOIN (
  SELECT
    deal_id,
    SUM(total_cost) FILTER (WHERE cost_type = 'estimated')  AS estimated_cost_entries,
    SUM(total_cost) FILTER (WHERE cost_type = 'committed')  AS committed_cost_entries,
    SUM(total_cost) FILTER (WHERE cost_type = 'actual')     AS actual_cost_entries
  FROM public.project_cost_entries
  GROUP BY deal_id
) ce ON ce.deal_id = d.id

-- PO aggregates
LEFT JOIN (
  SELECT
    deal_id,
    SUM(total_amount)           AS total_po_value,
    SUM(amount_received_value)  AS total_po_received
  FROM public.purchase_orders
  WHERE status NOT IN ('cancelled', 'draft')
  GROUP BY deal_id
) po ON po.deal_id = d.id

-- Supplier invoice aggregates (project_id field on supplier_invoices)
LEFT JOIN (
  SELECT
    project_id,
    SUM(total_amount)   AS total_supplier_invoiced,
    SUM(amount_paid)    AS total_supplier_paid
  FROM public.supplier_invoices
  WHERE status != 'cancelled'
  GROUP BY project_id
) si ON si.project_id = d.id

-- Milestone aggregates
LEFT JOIN (
  SELECT
    deal_id,
    COUNT(*)                                            AS total_milestones,
    COUNT(*) FILTER (WHERE status = 'completed')       AS completed_milestones,
    COUNT(*) FILTER (WHERE invoice_id IS NOT NULL)     AS invoiced_milestones
  FROM public.project_milestones
  GROUP BY deal_id
) ms ON ms.deal_id = d.id;


-- ============================================================
-- 7. MILESTONE COMPLETION RPC
--    Marks milestone complete + optionally creates finance_invoice
--    Returns the invoice id (or null if no invoice triggered)
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_milestone(
  p_milestone_id uuid,
  p_create_invoice boolean DEFAULT true,
  p_invoice_due_days integer DEFAULT 30
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_milestone  public.project_milestones%ROWTYPE;
  v_deal       public.client_deals%ROWTYPE;
  v_invoice_id uuid;
  v_inv_number text;
  v_inv_amount numeric;
BEGIN
  -- Load milestone
  SELECT * INTO v_milestone FROM public.project_milestones WHERE id = p_milestone_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Milestone % not found', p_milestone_id;
  END IF;

  -- Permission check
  PERFORM public.user_has_permission(v_milestone.company_id, 'projects.edit');

  -- Load deal
  SELECT * INTO v_deal FROM public.client_deals WHERE id = v_milestone.deal_id;

  -- Determine invoice amount
  IF v_milestone.invoice_percentage > 0 THEN
    v_inv_amount := ROUND(v_deal.offer_amount * v_milestone.invoice_percentage / 100, 2);
  ELSE
    v_inv_amount := v_milestone.invoice_amount;
  END IF;

  -- Mark milestone complete
  UPDATE public.project_milestones
  SET status = 'completed',
      completion_date = CURRENT_DATE,
      updated_at = now()
  WHERE id = p_milestone_id;

  -- Create invoice if triggered and amount > 0
  IF p_create_invoice AND v_milestone.triggers_invoice AND v_inv_amount > 0 THEN
    -- Generate invoice number
    SELECT public.generate_invoice_number(v_milestone.company_id) INTO v_inv_number;

    INSERT INTO public.finance_invoices (
      company_id, client_id, deal_id, milestone_id,
      invoice_number, invoice_type, status,
      subtotal, vat_rate, vat_amount, total_amount, balance_due,
      issue_date, due_date, notes
    )
    VALUES (
      v_milestone.company_id,
      v_deal.client_id,
      v_deal.id,
      p_milestone_id,
      v_inv_number,
      'milestone',
      'draft',
      v_inv_amount,
      0.15,
      ROUND(v_inv_amount * 0.15, 2),
      ROUND(v_inv_amount * 1.15, 2),
      ROUND(v_inv_amount * 1.15, 2),
      CURRENT_DATE,
      CURRENT_DATE + p_invoice_due_days,
      'Milestone: ' || v_milestone.name
    )
    RETURNING id INTO v_invoice_id;

    -- Link invoice back to milestone
    UPDATE public.project_milestones
    SET invoice_id = v_invoice_id
    WHERE id = p_milestone_id;
  END IF;

  -- Handle retention release milestone
  IF v_milestone.is_retention_release THEN
    UPDATE public.client_deals
    SET retention_released_at = now(),
        updated_at = now()
    WHERE id = v_milestone.deal_id;
  END IF;

  RETURN jsonb_build_object(
    'milestone_id', p_milestone_id,
    'invoice_id',   v_invoice_id,
    'invoice_amount', v_inv_amount
  );
END;
$$;


-- ============================================================
-- 8. GENERATE INVOICE NUMBER RPC (if not already exists from Phase 1)
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_company_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_year text := to_char(now(), 'YYYY');
  v_seq  int;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS int)), 0) + 1
  INTO v_seq
  FROM public.finance_invoices
  WHERE company_id = p_company_id AND invoice_number LIKE 'INV-' || v_year || '-%';
  RETURN 'INV-' || v_year || '-' || LPAD(v_seq::text, 4, '0');
END;
$$;


-- ============================================================
-- 9. POPULATE committed_cost AND actual_cost ON client_deals
--    Trigger: keep client_deals.committed_cost in sync with POs
--             and actual_cost in sync with supplier_invoices
--    (These columns were added in Phase 1 but never wired)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_project_costs(p_deal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.client_deals
  SET
    committed_cost = (
      SELECT COALESCE(SUM(total_amount), 0)
      FROM public.purchase_orders
      WHERE deal_id = p_deal_id AND status NOT IN ('cancelled', 'draft')
    ),
    actual_cost = (
      SELECT COALESCE(SUM(total_amount), 0)
      FROM public.supplier_invoices
      WHERE project_id = p_deal_id AND status != 'cancelled'
    ),
    updated_at = now()
  WHERE id = p_deal_id;
END;
$$;


-- ============================================================
-- 10. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_milestones_deal       ON public.project_milestones(deal_id);
CREATE INDEX IF NOT EXISTS idx_milestones_company    ON public.project_milestones(company_id);
CREATE INDEX IF NOT EXISTS idx_milestones_status     ON public.project_milestones(company_id, status);
CREATE INDEX IF NOT EXISTS idx_cost_entries_deal     ON public.project_cost_entries(deal_id);
CREATE INDEX IF NOT EXISTS idx_cost_entries_company  ON public.project_cost_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_cost_entries_type     ON public.project_cost_entries(deal_id, cost_type);
CREATE INDEX IF NOT EXISTS idx_finance_inv_deal      ON public.finance_invoices(deal_id);
CREATE INDEX IF NOT EXISTS idx_finance_inv_milestone ON public.finance_invoices(milestone_id);

-- ============================================================
-- END OF MIGRATION
-- ============================================================
