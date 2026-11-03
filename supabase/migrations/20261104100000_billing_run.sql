-- KaiSync billing, part 2: the daily billing run.
-- Once a day the database wakes the billing_run edge function (key from Vault, as for notify_dispatch).
-- billing_run then: makes this month's bills, charges saved cards, emails reminders and "Pay now"
-- links, and locks companies whose bill is more than 7 days late. Paying unlocks at once.
-- The functions below are for the service role only (billing_run / payfast_itn).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'billing_run_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'billing_run_secret',
      'Private key the daily scheduler sends to the billing_run edge function.');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.billing_run_secret_ok(p_secret text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(length(p_secret) >= 32 AND p_secret = (
    SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'billing_run_secret' LIMIT 1), false);
$$;

CREATE OR REPLACE FUNCTION public.billing_run_kick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'billing_run_secret' LIMIT 1;
  IF v_secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := 'https://vcivtjwreybaxgtdhtou.supabase.co/functions/v1/billing_run',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-billing-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
END $$;

-- Emails and other one-off billing events, so nothing is sent twice.
CREATE TABLE IF NOT EXISTS public.billing_events (
  id bigserial PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  kind text NOT NULL,
  ref text NOT NULL DEFAULT '',
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, ref)
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- The billing period that contains p_day for a company whose billing day comes from its trial end.
CREATE OR REPLACE FUNCTION public.billing_period_for(p_anchor date, p_day date)
RETURNS TABLE (period_start date, period_end date) LANGUAGE sql IMMUTABLE AS $$
  WITH k AS (SELECT (extract(year FROM age(p_day, p_anchor)) * 12 + extract(month FROM age(p_day, p_anchor)))::int n)
  SELECT (p_anchor + make_interval(months => k.n))::date, (p_anchor + make_interval(months => k.n + 1) - interval '1 day')::date FROM k
$$;

-- Make the bill for the current period for every company that should have one. Amount and lines are
-- frozen from the live billing summary at that moment. Returns how many bills were made.
CREATE OR REPLACE FUNCTION public.billing_create_due_bills(p_mode text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_sum jsonb; v_n int := 0; v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date; p record;
BEGIN
  FOR r IN
    SELECT c.id, (s.trial_ends_at AT TIME ZONE 'Africa/Johannesburg')::date anchor
    FROM public.companies c JOIN public.saas_company_subscriptions s ON s.company_id = c.id
    WHERE c.billing_enabled AND s.trial_ends_at IS NOT NULL AND (s.trial_ends_at AT TIME ZONE 'Africa/Johannesburg')::date <= v_today
  LOOP
    SELECT * INTO p FROM public.billing_period_for(r.anchor, v_today);
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = r.id AND b.period_start = p.period_start);
    v_sum := public.kaiflow_sync_company_subscription(r.id);
    CONTINUE WHEN coalesce((v_sum ->> 'billable')::boolean, true) = false;
    CONTINUE WHEN coalesce((v_sum ->> 'monthly_charge')::numeric, 0) <= 0;
    INSERT INTO public.billing_bills (company_id, period_start, period_end, amount, lines, plan_name, due_date, mode)
    VALUES (r.id, p.period_start, p.period_end, round((v_sum ->> 'monthly_charge')::numeric, 2),
            coalesce(v_sum -> 'lines', '[]'::jsonb), v_sum ->> 'plan_name', p.period_start, p_mode)
    ON CONFLICT (company_id, period_start) DO NOTHING;
    IF FOUND THEN
      v_n := v_n + 1;
      UPDATE public.saas_company_subscriptions SET subscription_status = 'active', billing_status = 'active',
             next_billing_date = (p.period_end + 1), updated_at = now()
       WHERE company_id = r.id AND subscription_status = 'trialing';
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- Lock companies with a bill more than 7 days late. Returns the companies locked just now.
CREATE OR REPLACE FUNCTION public.billing_lock_overdue()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.companies c
     SET billing_locked_at = now(),
         billing_lock_reason = 'Unpaid KaiSync bill ' || (SELECT b.bill_number FROM public.billing_bills b
                                 WHERE b.company_id = c.id AND b.status = 'open' ORDER BY b.due_date LIMIT 1)
   WHERE c.billing_enabled AND c.billing_locked_at IS NULL
     AND EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = c.id AND b.status = 'open'
                 AND b.due_date <= (now() AT TIME ZONE 'Africa/Johannesburg')::date - 7)
  RETURNING c.id
$$;

-- After a payment: lift the lock if nothing overdue remains.
CREATE OR REPLACE FUNCTION public.billing_after_payment(p_company_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.companies SET billing_locked_at = NULL, billing_lock_reason = NULL
   WHERE id = p_company_id AND billing_locked_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.billing_bills b WHERE b.company_id = p_company_id AND b.status = 'open'
                     AND b.due_date <= (now() AT TIME ZONE 'Africa/Johannesburg')::date - 7)
$$;

-- People who get billing emails: the company's owners (and the company's contact address).
CREATE OR REPLACE FUNCTION public.billing_recipients(p_company_id uuid)
RETURNS TABLE (email text, name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (lower(x.email)) x.email, x.name FROM (
    SELECT trim(e.email) email, trim(coalesce(e.name, '')) name FROM public.employees e
     WHERE e.company_id = p_company_id AND coalesce(e.is_active, true) AND lower(coalesce(e.access_level, '')) = 'owner'
       AND e.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    UNION ALL
    SELECT trim(c.contact_email), '' FROM public.companies c
     WHERE c.id = p_company_id AND c.contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') x
$$;

SELECT cron.schedule('kaisync-billing-run', '13 5 * * *', 'SELECT public.billing_run_kick()');

-- Permissions (run separately): all of the above → no access for PUBLIC, anon, authenticated
-- (billing_run_secret_ok, billing_create_due_bills, billing_lock_overdue, billing_after_payment,
-- billing_recipients → service_role only).
