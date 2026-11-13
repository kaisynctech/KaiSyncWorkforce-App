-- Your business & quotation templates (piece 5b).
-- A company's business types (keys from lib/business-types.ts, main first) and when it set up its workspace;
-- the quotation templates each company keeps; which template a quotation used (old quotations: none).

-- 1. The company's business types and workspace set-up.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS business_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS workspace_setup_at timestamptz;

-- 2. Quotation templates.
CREATE TABLE IF NOT EXISTS public.quote_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  business_type text,                               -- lib/business-types.ts key it started from
  is_default boolean NOT NULL DEFAULT false,
  features text[] NOT NULL DEFAULT '{}',            -- what the quotation shows (products, options, deposit, …)
  header_fields text[] NOT NULL DEFAULT '{}',       -- fields at the top (vehicle, event date, site address, …)
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{ key, label, visible, team_only, custom }]
  defaults jsonb NOT NULL DEFAULT '{}'::jsonb,      -- { valid_days, payment_terms_days, deposit_pct, margin_pct }
  terms text,                                       -- T&Cs printed on this template's quotations
  archived_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS quote_templates_one_default
  ON public.quote_templates (company_id) WHERE is_default AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS quote_templates_company_idx ON public.quote_templates (company_id);

ALTER TABLE public.quote_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_templates_read ON public.quote_templates;
CREATE POLICY quote_templates_read ON public.quote_templates FOR SELECT TO authenticated
  USING (company_id = ANY (public.user_company_ids()));
DROP POLICY IF EXISTS quote_templates_write ON public.quote_templates;
CREATE POLICY quote_templates_write ON public.quote_templates FOR ALL TO authenticated
  USING (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)))
  WITH CHECK (company_id = ANY (public.user_company_ids()) AND public.role_is_hr_or_above(public.get_my_role(company_id)));
REVOKE ALL ON public.quote_templates FROM anon;

-- 3. Which template a quotation used (null = made before templates; looks and works as before).
ALTER TABLE public.commercial_quotes
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.quote_templates(id) ON DELETE SET NULL;

-- 4. Saving "what does your business do?" (sign-up, Settings, set up your workspace). Owner / admin / HR.
CREATE OR REPLACE FUNCTION public.set_business_types(p_company_id uuid, p_types text[], p_mark_setup boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_types text[];
BEGIN
  IF NOT (p_company_id = ANY (public.user_company_ids()))
     OR NOT public.role_is_hr_or_above(public.get_my_role(p_company_id)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  SELECT coalesce(array_agg(t ORDER BY o), '{}') INTO v_types
    FROM (SELECT DISTINCT ON (t) t, o FROM unnest(coalesce(p_types, '{}')) WITH ORDINALITY AS u(t, o)
          WHERE t ~ '^[a-z_]{2,40}$' ORDER BY t, o) x;
  IF coalesce(array_length(v_types, 1), 0) > 6 THEN RAISE EXCEPTION 'TOO_MANY'; END IF;
  UPDATE public.companies SET business_types = v_types,
    workspace_setup_at = CASE WHEN p_mark_setup THEN coalesce(workspace_setup_at, now()) ELSE workspace_setup_at END
  WHERE id = p_company_id;
END $$;
REVOKE ALL ON FUNCTION public.set_business_types(uuid, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_business_types(uuid, text[], boolean) TO authenticated;
