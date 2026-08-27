-- ============================================================
-- 1) commercial_quote_sends — delivery log for Money quote email
-- 2) Drop dead quote_rfqs / quote_rfq_lines stack (0 live rows)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.commercial_quote_sends (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  quote_id             uuid NOT NULL REFERENCES public.commercial_quotes(id) ON DELETE CASCADE,
  sent_by              uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  recipient_email      text NOT NULL,
  subject              text,
  channel              text NOT NULL DEFAULT 'email',
  provider             text NOT NULL DEFAULT 'resend',
  provider_message_id  text,
  status               text NOT NULL DEFAULT 'sent'
                         CHECK (status IN ('sent', 'failed')),
  error_message        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_quote_sends_quote
  ON public.commercial_quote_sends (quote_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commercial_quote_sends_company
  ON public.commercial_quote_sends (company_id, created_at DESC);

ALTER TABLE public.commercial_quote_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commercial_quote_sends_select" ON public.commercial_quote_sends;
CREATE POLICY "commercial_quote_sends_select" ON public.commercial_quote_sends
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT e.company_id FROM public.employees e
      WHERE e.user_id = auth.uid() AND e.is_active = true
    )
  );

DROP POLICY IF EXISTS "commercial_quote_sends_insert" ON public.commercial_quote_sends;
CREATE POLICY "commercial_quote_sends_insert" ON public.commercial_quote_sends
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id IN (
      SELECT e.company_id FROM public.employees e
      WHERE e.user_id = auth.uid() AND e.is_active = true
    )
  );

GRANT SELECT, INSERT ON public.commercial_quote_sends TO authenticated;

-- ── Drop obsolete quote-builder RFQ stack ───────────────────────────────────
DROP FUNCTION IF EXISTS public.get_quote_sourcing_summary(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_rfq_comparison(uuid, uuid, uuid);

ALTER TABLE public.commercial_quote_lines
  DROP CONSTRAINT IF EXISTS commercial_quote_lines_rfq_line_id_fkey;

ALTER TABLE public.commercial_quote_lines
  DROP COLUMN IF EXISTS rfq_line_id;

DROP TABLE IF EXISTS public.quote_rfq_lines CASCADE;
DROP TABLE IF EXISTS public.quote_rfqs CASCADE;
