-- Quotation engine (piece 7a): the fields a template can put on a quotation. Additions only; quotations made
-- before templates have none of these filled and look and work as before.

-- 1. Fields at the top of the quotation (vehicle, client order no., event date, site address, contract term),
--    stored by key: { "vehicle": "Mercedes Actros 2645", "event_date": "2026-12-20", ... }.
--    Contingency % is kept so it can be changed; its amount is a normal line on the quotation (so invoices,
--    projects and reports keep adding up without knowing about it).
ALTER TABLE public.commercial_quotes
  ADD COLUMN IF NOT EXISTS header_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS contingency_percent numeric NOT NULL DEFAULT 0;
ALTER TABLE public.commercial_quotes DROP CONSTRAINT IF EXISTS commercial_quotes_contingency_percent_check;
ALTER TABLE public.commercial_quotes ADD CONSTRAINT commercial_quotes_contingency_percent_check
  CHECK (contingency_percent >= 0 AND contingency_percent <= 100);

-- 2. On each line:
--    extra            industry fields (part_no, brand, condition, warranty, days, your own columns), by key;
--    option_of        this line is an option the client can choose instead of that line. Options are saved
--                     with is_excluded = true, so they are shown but never counted, invoiced or ordered until
--                     chosen (choosing is piece 8);
--    recurring_period a monthly / weekly / yearly amount, shown as its own total.
ALTER TABLE public.commercial_quote_lines
  ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS option_of uuid REFERENCES public.commercial_quote_lines(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recurring_period text;
ALTER TABLE public.commercial_quote_lines DROP CONSTRAINT IF EXISTS commercial_quote_lines_recurring_period_check;
ALTER TABLE public.commercial_quote_lines ADD CONSTRAINT commercial_quote_lines_recurring_period_check
  CHECK (recurring_period IS NULL OR recurring_period IN ('week', 'month', 'year'));
CREATE INDEX IF NOT EXISTS commercial_quote_lines_option_of_idx ON public.commercial_quote_lines (option_of)
  WHERE option_of IS NOT NULL;

-- Check
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'commercial_quotes'
     AND column_name IN ('header_values', 'contingency_percent')) AS quote_columns,      -- 2
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'commercial_quote_lines'
     AND column_name IN ('extra', 'option_of', 'recurring_period')) AS line_columns;     -- 3
