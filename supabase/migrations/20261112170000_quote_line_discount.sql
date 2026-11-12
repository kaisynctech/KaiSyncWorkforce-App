-- Quote lines: a discount % per line. The line's subtotal_sell / line_total are already after the discount,
-- so totals everywhere stay right. When an accepted quote becomes a draft invoice, the invoice line gets the
-- price after discount and says "(10% discount)" in its description (invoices have no discount column on screen yet).
-- Additive only: the live app doesn't send the new column and keeps working.
-- Rollback:
--   DO $r$ BEGIN EXECUTE (SELECT def FROM public._fn_backup WHERE name = '_quote_to_draft_invoice before discount'); END $r$;
--   ALTER TABLE public.commercial_quote_lines DROP COLUMN discount_percent;

ALTER TABLE public.commercial_quote_lines ADD COLUMN IF NOT EXISTS discount_percent numeric NOT NULL DEFAULT 0;

-- Earlier versions of changed functions, so they can be put back.
CREATE TABLE IF NOT EXISTS public._fn_backup (name text PRIMARY KEY, def text NOT NULL, saved_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public._fn_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._fn_backup FROM PUBLIC, anon, authenticated;

DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._quote_to_draft_invoice(uuid)'::regprocedure);
  IF position('discount_percent' IN d) > 0 THEN RETURN; END IF;
  IF position('coalesce(nullif(trim(l.description), ''''), q.title), coalesce(l.quantity, 1), coalesce(l.unit_sell_price, 0),' IN d) = 0 THEN
    RAISE EXCEPTION 'Quote-to-invoice function has changed — not patched';
  END IF;
  INSERT INTO public._fn_backup (name, def) VALUES ('_quote_to_draft_invoice before discount', d)
    ON CONFLICT (name) DO UPDATE SET def = EXCLUDED.def, saved_at = now();
  EXECUTE replace(d,
    'coalesce(nullif(trim(l.description), ''''), q.title), coalesce(l.quantity, 1), coalesce(l.unit_sell_price, 0),',
    'coalesce(nullif(trim(l.description), ''''), q.title)'
    || ' || CASE WHEN coalesce(l.discount_percent, 0) > 0 THEN '' ('' || trim_scale(l.discount_percent)::text || ''% discount)'' ELSE '''' END,'
    || ' coalesce(l.quantity, 1),'
    || ' CASE WHEN coalesce(l.discount_percent, 0) > 0 AND coalesce(l.quantity, 0) > 0 THEN round(coalesce(l.subtotal_sell, 0) / l.quantity, 4) ELSE coalesce(l.unit_sell_price, 0) END,');
END $patch$;
