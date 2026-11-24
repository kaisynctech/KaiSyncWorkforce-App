-- Company 31 (Kaisync Workforce App) is the platform home.
-- Every other company becomes a client there, and the platform home becomes
-- a contractor on that company. Business profile fields stay in sync.
-- The contractor portal stays off. A client code is issued once so invoices
-- can be opened in the platform home's client portal.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS is_platform_home boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.is_platform_home IS
  'The one company that owns this application. Other companies are registered as its clients.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_one_platform_home
  ON public.companies ((1))
  WHERE is_platform_home;

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS linked_company_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contractors_linked_company_id_fkey'
      AND conrelid = 'public.contractors'::regclass
  ) THEN
    ALTER TABLE public.contractors
      ADD CONSTRAINT contractors_linked_company_id_fkey
      FOREIGN KEY (linked_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contractors_company_linked_company
  ON public.contractors (company_id, linked_company_id)
  WHERE linked_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contractors_linked_company
  ON public.contractors (linked_company_id)
  WHERE linked_company_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'clients_linked_company_id_fkey'
      AND conrelid = 'public.clients'::regclass
  ) THEN
    ALTER TABLE public.clients
      ADD CONSTRAINT clients_linked_company_id_fkey
      FOREIGN KEY (linked_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_company_linked_company
  ON public.clients (company_id, linked_company_id)
  WHERE linked_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_linked_company
  ON public.clients (linked_company_id)
  WHERE linked_company_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_platform_company_link(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_home public.companies%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_owner_name text;
  v_owner_phone text;
  v_owner_email text;
  v_home_contact text;
  v_home_phone text;
  v_home_email text;
  v_client_id uuid;
  v_contractor_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_contractor_before jsonb;
  v_contractor_after jsonb;
  v_actor uuid;
  v_prefix text;
  v_next bigint;
  v_other uuid;
  v_created boolean := false;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_home FROM public.companies WHERE is_platform_home LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
         nullif(btrim(e.phone), ''),
         nullif(btrim(coalesce(nullif(btrim(e.email), ''), u.email)), '')
    INTO v_home_contact, v_home_phone, v_home_email
  FROM public.employees e
  LEFT JOIN auth.users u ON u.id = e.user_id
  WHERE e.company_id = v_home.id
    AND e.is_active = true
  ORDER BY (e.access_level = 'owner') DESC, e.created_at
  LIMIT 1;

  v_home_phone := coalesce(nullif(btrim(v_home.contact_phone), ''), v_home_phone);
  v_home_email := coalesce(nullif(btrim(v_home.contact_email), ''), v_home_email);
  v_actor := coalesce(auth.uid(), v_home.owner_user_id);

  IF v_company.id = v_home.id THEN
    FOR v_other IN SELECT id FROM public.companies WHERE id <> v_home.id LOOP
      PERFORM public.sync_platform_company_link(v_other);
    END LOOP;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_home.id::text || ':' || v_company.id::text, 0));

  SELECT nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
         nullif(btrim(e.phone), ''),
         nullif(btrim(coalesce(nullif(btrim(e.email), ''), u.email)), '')
    INTO v_owner_name, v_owner_phone, v_owner_email
  FROM public.employees e
  LEFT JOIN auth.users u ON u.id = e.user_id
  WHERE e.company_id = v_company.id
    AND e.is_active = true
  ORDER BY (e.access_level = 'owner') DESC, e.created_at
  LIMIT 1;

  v_owner_phone := coalesce(nullif(btrim(v_company.contact_phone), ''), v_owner_phone);
  v_owner_email := coalesce(nullif(btrim(v_company.contact_email), ''), v_owner_email);

  SELECT id
    INTO v_contractor_id
  FROM public.contractors
  WHERE company_id = v_company.id
    AND linked_company_id = v_home.id;

  SELECT jsonb_build_object(
           'name', name,
           'contact_person', contact_person,
           'phone', phone,
           'email', email,
           'address', address,
           'vat_number', vat_number,
           'portal_enabled', portal_enabled
         )
    INTO v_contractor_before
  FROM public.contractors
  WHERE company_id = v_company.id
    AND linked_company_id = v_home.id;

  IF v_contractor_id IS NULL THEN
    INSERT INTO public.contractors (
      company_id, name, partner_kind, profile_tier, contact_person, phone, email, address,
      is_vat_registered, vat_number, portal_enabled, linked_company_id, is_active
    ) VALUES (
      v_company.id,
      v_home.name,
      'contractor',
      'full',
      v_home_contact,
      v_home_phone,
      v_home_email,
      nullif(btrim(v_home.address), ''),
      v_home.is_vat_registered,
      CASE WHEN v_home.is_vat_registered THEN nullif(btrim(v_home.vat_number), '') ELSE NULL END,
      false,
      v_home.id,
      true
    )
    RETURNING id INTO v_contractor_id;
    v_created := true;
  ELSE
    UPDATE public.contractors
    SET name = v_home.name,
        contact_person = v_home_contact,
        phone = v_home_phone,
        email = v_home_email,
        address = nullif(btrim(v_home.address), ''),
        is_vat_registered = v_home.is_vat_registered,
        vat_number = CASE WHEN v_home.is_vat_registered THEN nullif(btrim(v_home.vat_number), '') ELSE vat_number END
    WHERE id = v_contractor_id;
  END IF;

  SELECT jsonb_build_object(
           'name', name,
           'contact_person', contact_person,
           'phone', phone,
           'email', email,
           'address', address,
           'vat_number', vat_number,
           'portal_enabled', portal_enabled
         )
    INTO v_contractor_after
  FROM public.contractors
  WHERE id = v_contractor_id;

  SELECT id INTO v_client_id
  FROM public.clients
  WHERE company_id = v_home.id
    AND linked_company_id = v_company.id;

  SELECT jsonb_build_object(
           'name', name,
           'contact_person', contact_person,
           'phone', phone,
           'email', email,
           'address', address,
           'vat_number', vat_number,
           'legal_name', legal_name
         )
    INTO v_before
  FROM public.clients
  WHERE id = v_client_id;

  IF v_client_id IS NULL THEN
    INSERT INTO public.clients (
      company_id, name, type, contact_person, phone, email, address,
      vat_number, legal_name, linked_company_id, source_contractor_id, portal_enabled
    ) VALUES (
      v_home.id,
      v_company.name,
      'company',
      v_owner_name,
      v_owner_phone,
      v_owner_email,
      nullif(btrim(v_company.address), ''),
      nullif(btrim(v_company.vat_number), ''),
      v_company.name,
      v_company.id,
      v_contractor_id,
      false
    )
    RETURNING id INTO v_client_id;
  ELSE
    UPDATE public.clients
    SET name = v_company.name,
        type = 'company',
        contact_person = v_owner_name,
        phone = v_owner_phone,
        email = v_owner_email,
        address = nullif(btrim(v_company.address), ''),
        vat_number = nullif(btrim(v_company.vat_number), ''),
        legal_name = v_company.name,
        source_contractor_id = v_contractor_id
    WHERE id = v_client_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.clients WHERE id = v_client_id AND client_code IS NULL) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('platform-client-code:' || v_home.id::text, 0));
    v_prefix := 'C' || upper(regexp_replace(coalesce(v_home.code, ''), '[^A-Za-z0-9]', '', 'g'));
    SELECT coalesce(max(substring(upper(btrim(client_code)) FROM char_length(v_prefix) + 1)::bigint), 0) + 1
      INTO v_next
    FROM public.clients
    WHERE company_id = v_home.id
      AND client_code IS NOT NULL
      AND upper(btrim(client_code)) ~ ('^' || v_prefix || '[0-9]+$');

    UPDATE public.clients
    SET client_code = v_prefix || lpad(v_next::text, 4, '0'),
        portal_enabled = true
    WHERE id = v_client_id
      AND client_code IS NULL;
  END IF;

  SELECT jsonb_build_object(
           'name', name,
           'contact_person', contact_person,
           'phone', phone,
           'email', email,
           'address', address,
           'vat_number', vat_number,
           'legal_name', legal_name
         )
    INTO v_after
  FROM public.clients
  WHERE id = v_client_id;

  IF v_actor IS NOT NULL AND (v_created OR v_before IS DISTINCT FROM v_after OR v_contractor_before IS DISTINCT FROM v_contractor_after) THEN
    BEGIN
      INSERT INTO public.audit_events (
        company_id, actor_user_id, action, target_type, target_id, before_state, after_state, meta
      ) VALUES (
        v_home.id,
        v_actor,
        'platform.client_linked',
        'client',
        v_client_id::text,
        public.mask_sensitive_fields(v_before),
        public.mask_sensitive_fields(v_after),
        jsonb_build_object('company_code', v_company.code, 'linked_company_id', v_company.id)
      );
      INSERT INTO public.audit_events (
        company_id, actor_user_id, action, target_type, target_id, before_state, after_state, meta
      ) VALUES (
        v_company.id,
        v_actor,
        'platform.contractor_linked',
        'contractor',
        v_contractor_id::text,
        public.mask_sensitive_fields(v_contractor_before),
        public.mask_sensitive_fields(v_contractor_after),
        jsonb_build_object('platform_company_code', v_home.code, 'linked_company_id', v_home.id)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'platform link audit skipped: %', SQLERRM;
    END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_platform_company_link(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_sync_platform_company_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  PERFORM public.sync_platform_company_link(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sync_platform_company_link() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_sync_platform_owner_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF NEW.access_level = 'owner'
     OR (TG_OP = 'UPDATE' AND OLD.access_level = 'owner') THEN
    PERFORM public.sync_platform_company_link(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_sync_platform_owner_link() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_companies_platform_link ON public.companies;
CREATE CONSTRAINT TRIGGER trg_companies_platform_link
  AFTER INSERT OR UPDATE OF name, contact_email, contact_phone, address, vat_number, is_vat_registered, code, is_platform_home
  ON public.companies
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_platform_company_link();

DROP TRIGGER IF EXISTS trg_employees_platform_owner_link ON public.employees;
CREATE CONSTRAINT TRIGGER trg_employees_platform_owner_link
  AFTER INSERT OR UPDATE OF name, surname, phone, email, access_level, is_active, user_id
  ON public.employees
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_platform_owner_link();

UPDATE public.companies
SET is_platform_home = true
WHERE code = '31'
  AND name = 'Kaisync Workforce App'
  AND NOT EXISTS (SELECT 1 FROM public.companies WHERE is_platform_home);

DO $$
DECLARE
  v_company_id uuid;
BEGIN
  FOR v_company_id IN
    SELECT id FROM public.companies WHERE NOT is_platform_home
  LOOP
    PERFORM public.sync_platform_company_link(v_company_id);
  END LOOP;
END $$;
