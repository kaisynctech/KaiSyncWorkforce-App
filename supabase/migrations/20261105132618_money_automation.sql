-- Money automation: automatic overdue reminders and recurring invoices, run once a day by money_daily.

-- 1. Automatic reminders ---------------------------------------------------------------------------------
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS auto_reminders_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS auto_reminder_after_days integer NOT NULL DEFAULT 3;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS auto_reminder_every_days integer NOT NULL DEFAULT 7;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS auto_reminders_off boolean NOT NULL DEFAULT false;
ALTER TABLE public.statement_reminders ADD COLUMN IF NOT EXISTS automatic boolean NOT NULL DEFAULT false;

-- Owner, HR and admins set the reminder rules (other company settings stay as they are).
CREATE OR REPLACE FUNCTION public.set_auto_reminders(p_company_id uuid, p_enabled boolean, p_after_days integer, p_every_days integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids())) OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF p_after_days NOT BETWEEN 0 AND 60 OR p_every_days NOT BETWEEN 3 AND 60 THEN RAISE EXCEPTION 'BAD_DAYS'; END IF;
  UPDATE public.companies SET auto_reminders_enabled = p_enabled, auto_reminder_after_days = p_after_days,
    auto_reminder_every_days = p_every_days WHERE id = p_company_id;
END $$;
REVOKE ALL ON FUNCTION public.set_auto_reminders(uuid, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_auto_reminders(uuid, boolean, integer, integer) TO authenticated;

-- 2. Recurring invoices -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurring_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  -- [{description, quantity, unit_price, item_type, source_id, unit}]
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  vat_rate numeric(6,4) NOT NULL DEFAULT 0 CHECK (vat_rate BETWEEN 0 AND 1),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_run date NOT NULL,
  end_date date,
  payment_terms_days integer CHECK (payment_terms_days BETWEEN 0 AND 365),
  auto_send boolean NOT NULL DEFAULT true,
  notes text,
  active boolean NOT NULL DEFAULT true,
  runs integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  last_invoice_id uuid,
  last_error text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_invoices_due_idx ON public.recurring_invoices (next_run) WHERE active;
CREATE INDEX IF NOT EXISTS recurring_invoices_company_idx ON public.recurring_invoices (company_id);
ALTER TABLE public.recurring_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY recurring_invoices_office ON public.recurring_invoices FOR ALL TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND coalesce(public.get_my_role(company_id), 'employee') <> 'employee')
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND coalesce(public.get_my_role(company_id), 'employee') <> 'employee');
CREATE POLICY billing_read_only_insert ON public.recurring_invoices AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.company_writable(company_id));
CREATE POLICY billing_read_only_update ON public.recurring_invoices AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.company_writable(company_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_invoices TO authenticated;

CREATE OR REPLACE FUNCTION public._recurring_next(p_date date, p_frequency text)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_frequency
    WHEN 'weekly' THEN p_date + 7
    WHEN 'quarterly' THEN (p_date + interval '3 months')::date
    WHEN 'yearly' THEN (p_date + interval '1 year')::date
    ELSE (p_date + interval '1 month')::date END
$$;

-- Make this period's invoice from a recurring invoice (sent, so it gets its number, or a draft) and move
-- next_run on. Returns the new invoice id. Service role only (money_daily) or the office's "Run now".
CREATE OR REPLACE FUNCTION public._recurring_generate(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.recurring_invoices%ROWTYPE; v_id uuid; v_sub numeric := 0; v_vat numeric; v_terms int; l jsonb; n int := 0;
  v_qty numeric; v_price numeric; v_line numeric; v_tax text;
BEGIN
  SELECT * INTO r FROM public.recurring_invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT r.active THEN RAISE EXCEPTION 'RECURRING_NOT_ACTIVE'; END IF;
  IF jsonb_array_length(r.lines) = 0 THEN RAISE EXCEPTION 'NO_LINES'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
    v_sub := v_sub + round(coalesce((l->>'quantity')::numeric, 1) * coalesce((l->>'unit_price')::numeric, 0), 2);
  END LOOP;
  v_vat := round(v_sub * r.vat_rate, 2);
  v_tax := CASE WHEN r.vat_rate > 0 THEN 'standard' ELSE 'exempt' END;
  SELECT coalesce(r.payment_terms_days, c.payment_terms_days, 30) INTO v_terms FROM public.clients c WHERE c.id = r.client_id;
  INSERT INTO public.finance_invoices (company_id, client_id, invoice_number, status, currency, subtotal, vat_rate, vat_amount,
    total_amount, amount_paid, balance_due, is_vat_inclusive, tax_type, issue_date, due_date, invoice_type, notes, sent_at)
  VALUES (r.company_id, r.client_id, NULL, 'draft', 'ZAR', v_sub, r.vat_rate, v_vat, v_sub + v_vat, 0, v_sub + v_vat, false,
    v_tax, current_date, current_date + coalesce(v_terms, 30), 'standard', r.notes, NULL)
  RETURNING id INTO v_id;
  FOR l IN SELECT * FROM jsonb_array_elements(r.lines) LOOP
    n := n + 1;
    v_qty := coalesce((l->>'quantity')::numeric, 1);
    v_price := coalesce((l->>'unit_price')::numeric, 0);
    v_line := round(v_qty * v_price, 2);
    INSERT INTO public.finance_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, subtotal,
      vat_rate, vat_amount, total_amount, is_vat_inclusive, tax_type, item_type, source_id, unit)
    VALUES (r.company_id, v_id, n, coalesce(nullif(trim(l->>'description'), ''), r.title), v_qty, v_price, v_line,
      r.vat_rate, round(v_line * r.vat_rate, 2), v_line + round(v_line * r.vat_rate, 2), false, v_tax,
      coalesce(nullif(l->>'item_type', ''), 'custom'), nullif(l->>'source_id', '')::uuid, nullif(l->>'unit', ''));
  END LOOP;
  -- Send it (the database gives it its number now) unless the office wants to check drafts first.
  IF r.auto_send THEN
    UPDATE public.finance_invoices SET status = 'sent', sent_at = now() WHERE id = v_id;
  END IF;
  UPDATE public.recurring_invoices SET runs = runs + 1, last_run_at = now(), last_invoice_id = v_id, last_error = NULL,
    next_run = public._recurring_next(greatest(next_run, current_date), frequency), updated_at = now(),
    active = CASE WHEN end_date IS NOT NULL AND public._recurring_next(greatest(next_run, current_date), frequency) > end_date THEN false ELSE active END
  WHERE id = r.id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._recurring_generate(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Daily run -------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'money_daily_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'money_daily_secret',
      'Private key the daily scheduler sends to the money_daily edge function.');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.money_daily_secret_ok(p_secret text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(length(p_secret) >= 32 AND p_secret = (
    SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'money_daily_secret' LIMIT 1), false);
$$;
REVOKE ALL ON FUNCTION public.money_daily_secret_ok(text) FROM PUBLIC, anon, authenticated;

-- p_options lets a test run touch one company only: {"company_id": "...", "site_url": "..."}.
CREATE OR REPLACE FUNCTION public.money_daily_kick(p_options jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'money_daily_secret' LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://vcivtjwreybaxgtdhtou.supabase.co/functions/v1/money_daily',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-money-secret', v_secret),
    body := coalesce(p_options, '{}'::jsonb),
    timeout_milliseconds := 120000);
END $$;
REVOKE ALL ON FUNCTION public.money_daily_kick(jsonb) FROM PUBLIC, anon, authenticated;

-- "Create now" from the office (owner/admin/HR/managers of that company): this period's invoice today.
CREATE OR REPLACE FUNCTION public.recurring_run_now(p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.recurring_invoices WHERE id = p_id;
  IF v_company IS NULL OR NOT (v_company = ANY (public.user_company_ids()))
     OR coalesce(public.get_my_role(v_company), 'employee') = 'employee' THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF NOT public.company_writable(v_company) THEN RAISE EXCEPTION 'billing_read_only'; END IF;
  RETURN public._recurring_generate(p_id);
END $$;
REVOKE ALL ON FUNCTION public.recurring_run_now(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recurring_run_now(uuid) TO authenticated;

-- Who set it up (tables created before this default existed).
ALTER TABLE public.recurring_invoices ALTER COLUMN created_by SET DEFAULT auth.uid();
