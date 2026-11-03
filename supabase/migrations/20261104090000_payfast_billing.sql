-- KaiSync subscription billing through PayFast (approved 3–4 Nov 2026).
--
-- Decisions (Nyarie): card saved and charged automatically each month, with a "Pay now" link as a
-- fallback; reminders then read-only after 7 days' grace; 30-day free trial for new companies.
--
-- Money never touches our database as card data: PayFast's own page takes the card and gives us a
-- token. Only the edge functions (service role) can read the token.
--
--  billing_checkouts         one row per trip to PayFast (add a card, or pay a bill); its id is the
--                            m_payment_id PayFast echoes back, so a notice can be matched and checked.
--  billing_payment_methods   the saved card token per company (one active at a time).
--  billing_bills             KaiSync's monthly bill to a company (amount frozen when it is made).
--  saas_billing_transactions (existing) one row per successful payment.
--  companies.billing_*       whether automatic billing applies, and the read-only lock.

-- ── New companies: 30-day trial (was 14) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provision_company_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_plan_id uuid;
    v_limit integer;
BEGIN
    SELECT id, included_employees INTO v_plan_id, v_limit
    FROM public.saas_plans
    WHERE code = coalesce(new.plan_code, 'free_trial')
    LIMIT 1;

    IF v_plan_id IS NULL THEN
        SELECT id, included_employees INTO v_plan_id, v_limit
        FROM public.saas_plans WHERE code = 'free_trial' LIMIT 1;
    END IF;

    INSERT INTO public.saas_company_subscriptions (
        company_id, plan_id, billing_status, employee_limit,
        trial_ends_at, subscription_status, next_billing_date
    ) VALUES (
        new.id, v_plan_id, 'trial', v_limit,
        coalesce(new.trial_started_at, now()) + interval '30 days',
        'trialing',
        (coalesce(new.trial_started_at, now()) + interval '30 days')::date
    )
    ON CONFLICT (company_id) DO NOTHING;

    RETURN new;
END;
$$;

-- ── Company flags ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS billing_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS billing_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_lock_reason text;
COMMENT ON COLUMN public.companies.billing_enabled IS
  'Automatic monthly billing through PayFast. Off for companies billed by hand (set by a platform admin).';
COMMENT ON COLUMN public.companies.billing_locked_at IS
  'Set when an unpaid bill passes its 7-day grace: the company becomes read-only until it pays.';

-- Companies that existed before PayFast billing keep being billed by hand until a platform admin
-- switches them over; the Ironvale playground is switched on so billing can be tested end to end.
UPDATE public.companies SET billing_enabled = (id = 'ac99a73d-3768-4191-b8c3-550802d1ae26')
 WHERE created_at < '2026-11-04';

-- ── Tables ───────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  purpose text NOT NULL CHECK (purpose IN ('add_card', 'pay_bill')),
  bill_id uuid,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  mode text NOT NULL CHECK (mode IN ('sandbox', 'live')),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'complete', 'failed', 'cancelled')),
  pf_payment_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_notice jsonb
);
CREATE INDEX IF NOT EXISTS idx_billing_checkouts_company ON public.billing_checkouts (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  provider text NOT NULL DEFAULT 'payfast',
  mode text NOT NULL CHECK (mode IN ('sandbox', 'live')),
  token text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'replaced', 'cancelled')),
  added_by uuid,
  added_by_name text,
  checkout_id uuid REFERENCES public.billing_checkouts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_payment_methods_active ON public.billing_payment_methods (company_id) WHERE status = 'active';

CREATE SEQUENCE IF NOT EXISTS public.billing_bill_number_seq;

CREATE TABLE IF NOT EXISTS public.billing_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  bill_number text NOT NULL UNIQUE DEFAULT ('KS-' || lpad(nextval('public.billing_bill_number_seq')::text, 5, '0')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  plan_name text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
  due_date date NOT NULL,
  charge_attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error text,
  reminders_sent int NOT NULL DEFAULT 0,
  last_reminder_at timestamptz,
  paid_at timestamptz,
  paid_via text CHECK (paid_via IN ('saved_card', 'pay_now', 'manual')),
  pf_payment_id text,
  mode text NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox', 'live')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_billing_bills_open ON public.billing_bills (status, due_date);

ALTER TABLE public.billing_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_bills ENABLE ROW LEVEL SECURITY;
-- No policies: the app reads billing through billing_overview(); only edge functions write.

-- ── Who may see and pay the bill ─────────────────────────────────────────────────────────
-- The same people who see Settings → Billing today: owner, HR and admins (and platform admins).
CREATE OR REPLACE FUNCTION public.billing_can_manage(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.platform_is_admin() OR EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.company_id = p_company_id AND e.user_id = auth.uid() AND coalesce(e.is_active, true)
      AND lower(coalesce(e.access_level, '')) IN ('owner', 'hr', 'hr_admin', 'admin'))
$$;

-- Everything the Billing screen needs, in one call. The card token never leaves the database.
CREATE OR REPLACE FUNCTION public.billing_overview(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.billing_can_manage(p_company_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  SELECT jsonb_build_object(
    'billing_enabled', c.billing_enabled,
    'locked_at', c.billing_locked_at,
    'lock_reason', c.billing_lock_reason,
    'trial_ends_at', s.trial_ends_at,
    'subscription_status', s.subscription_status,
    'card', (SELECT jsonb_build_object('added_at', m.created_at, 'added_by', m.added_by_name, 'mode', m.mode)
             FROM public.billing_payment_methods m WHERE m.company_id = c.id AND m.status = 'active' LIMIT 1),
    'open_bills', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'number', b.bill_number, 'amount', b.amount,
               'period_start', b.period_start, 'period_end', b.period_end, 'due_date', b.due_date,
               'last_error', b.last_error, 'attempts', b.charge_attempts) ORDER BY b.due_date)
             FROM public.billing_bills b WHERE b.company_id = c.id AND b.status = 'open'), '[]'::jsonb),
    'history', coalesce((SELECT jsonb_agg(x ORDER BY x.period_start DESC) FROM (
             SELECT b.id, b.bill_number AS number, b.amount, b.period_start, b.period_end, b.status, b.paid_at, b.paid_via, b.lines, b.plan_name
             FROM public.billing_bills b WHERE b.company_id = c.id AND b.status <> 'void'
             ORDER BY b.period_start DESC LIMIT 24) x), '[]'::jsonb))
  INTO v
  FROM public.companies c LEFT JOIN public.saas_company_subscriptions s ON s.company_id = c.id
  WHERE c.id = p_company_id;
  RETURN v;
END $$;

-- Platform admins: every company's billing position.
CREATE OR REPLACE FUNCTION public.platform_billing_overview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.platform_is_admin() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x.name) FROM (
    SELECT c.id, c.name, c.billing_enabled, c.billing_locked_at AS locked_at, s.subscription_status, s.trial_ends_at,
           cs.monthly_charge,
           EXISTS (SELECT 1 FROM public.billing_payment_methods m WHERE m.company_id = c.id AND m.status = 'active') AS has_card,
           (SELECT coalesce(sum(b.amount), 0) FROM public.billing_bills b WHERE b.company_id = c.id AND b.status = 'open') AS owing,
           (SELECT min(b.due_date) FROM public.billing_bills b WHERE b.company_id = c.id AND b.status = 'open') AS oldest_due,
           (SELECT max(b.paid_at) FROM public.billing_bills b WHERE b.company_id = c.id AND b.status = 'paid') AS last_paid_at
    FROM public.companies c
    LEFT JOIN public.saas_company_subscriptions s ON s.company_id = c.id
    LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id) x), '[]'::jsonb);
END $$;

-- Platform admins switch automatic billing on or off for a company, or lift a lock by hand.
CREATE OR REPLACE FUNCTION public.platform_set_company_billing(p_company_id uuid, p_enabled boolean, p_unlock boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.platform_is_admin() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  UPDATE public.companies
     SET billing_enabled = coalesce(p_enabled, billing_enabled),
         billing_locked_at = CASE WHEN p_unlock THEN NULL ELSE billing_locked_at END,
         billing_lock_reason = CASE WHEN p_unlock THEN NULL ELSE billing_lock_reason END
   WHERE id = p_company_id;
  INSERT INTO public.saas_platform_audit_log (actor_user_id, action, target_type, target_id, company_id, detail_json)
  VALUES (auth.uid(), 'billing_settings_changed', 'company', p_company_id, p_company_id,
          jsonb_build_object('billing_enabled', p_enabled, 'unlocked', p_unlock));
END $$;

-- Permissions (run separately):
--   billing_overview, platform_billing_overview, platform_set_company_billing → authenticated only;
--   billing_can_manage → no direct calls; tables → no access for anon/authenticated.
