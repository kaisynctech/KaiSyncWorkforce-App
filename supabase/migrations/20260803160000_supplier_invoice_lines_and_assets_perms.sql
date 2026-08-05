-- Wave 4 + 5: supplier invoice lines + assets permission keys

-- ─── W4: supplier_invoice_lines ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_invoice_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  invoice_id        uuid NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
  line_no           int  NOT NULL DEFAULT 1,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  description       text NOT NULL,
  quantity          numeric(12,3) NOT NULL DEFAULT 1,
  unit_price        numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount   numeric(14,2) NOT NULL DEFAULT 0,
  discount_percent  numeric(6,4)  NOT NULL DEFAULT 0,
  subtotal          numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate          numeric(6,4)  NOT NULL DEFAULT 0.1500,
  vat_amount        numeric(14,2) NOT NULL DEFAULT 0,
  total_amount      numeric(14,2) NOT NULL DEFAULT 0,
  is_vat_inclusive  boolean NOT NULL DEFAULT false,
  tax_type          text NOT NULL DEFAULT 'standard',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_invoice
  ON public.supplier_invoice_lines (invoice_id, line_no);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_company
  ON public.supplier_invoice_lines (company_id);

ALTER TABLE public.supplier_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_invoice_lines_all ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_all ON public.supplier_invoice_lines
  FOR ALL TO authenticated
  USING (company_id = ANY (public.user_company_ids()))
  WITH CHECK (company_id = ANY (public.user_company_ids()));

-- ─── W5: assets.view / assets.edit for all companies ─────────────────────────
INSERT INTO public.company_role_permissions (company_id, role, permission_key, allowed)
SELECT c.id, v.role, v.permission_key, v.allowed
FROM public.companies c
CROSS JOIN (
  VALUES
    ('owner',    'assets.view', true),
    ('owner',    'assets.edit', true),
    ('hr',       'assets.view', true),
    ('hr',       'assets.edit', true),
    ('manager',  'assets.view', true),
    ('manager',  'assets.edit', true),
    ('employee', 'assets.view', false),
    ('employee', 'assets.edit', false)
) AS v(role, permission_key, allowed)
ON CONFLICT (company_id, role, permission_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
