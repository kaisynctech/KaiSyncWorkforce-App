-- Cross-company relationship groundwork:
-- Company A can link Company B as contractor-company.
-- When linked, Company A can be auto-created as a client in Company B.

ALTER TABLE IF EXISTS public.contractors
  ADD COLUMN IF NOT EXISTS linked_company_id bigint REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_company_status text NOT NULL DEFAULT 'unlinked';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contractors_linked_company_status_chk'
      AND conrelid = 'public.contractors'::regclass
  ) THEN
    ALTER TABLE public.contractors
      ADD CONSTRAINT contractors_linked_company_status_chk
      CHECK (linked_company_status IN ('unlinked', 'pending', 'linked', 'rejected'));
  END IF;
END $$;

ALTER TABLE IF EXISTS public.clients
  ADD COLUMN IF NOT EXISTS linked_company_id bigint REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_contractor_id bigint REFERENCES public.contractors(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_company_linked_company
  ON public.clients(company_id, linked_company_id)
  WHERE linked_company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.company_relationships (
  id bigserial PRIMARY KEY,
  requester_company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipient_company_id bigint NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  relationship_type text NOT NULL DEFAULT 'client_contractor',
  status text NOT NULL DEFAULT 'active',
  source_contractor_id bigint REFERENCES public.contractors(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_relationships_distinct_companies_chk CHECK (requester_company_id <> recipient_company_id),
  CONSTRAINT company_relationships_status_chk CHECK (status IN ('pending', 'active', 'rejected', 'cancelled')),
  CONSTRAINT company_relationships_type_chk CHECK (relationship_type IN ('client_contractor'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_company_relationship_type_pair
  ON public.company_relationships(requester_company_id, recipient_company_id, relationship_type);

CREATE INDEX IF NOT EXISTS idx_company_relationships_requester
  ON public.company_relationships(requester_company_id, status);

CREATE INDEX IF NOT EXISTS idx_company_relationships_recipient
  ON public.company_relationships(recipient_company_id, status);

ALTER TABLE public.company_relationships ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_company_relationships_hr_requester') THEN
    CREATE POLICY p_company_relationships_hr_requester ON public.company_relationships
      FOR ALL USING (requester_company_id = current_hr_company_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname='p_company_relationships_hr_recipient_read') THEN
    CREATE POLICY p_company_relationships_hr_recipient_read ON public.company_relationships
      FOR SELECT USING (recipient_company_id = current_hr_company_id());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.company_link_existing_contractor_company(
  p_requester_company_id bigint,
  p_contractor_id bigint,
  p_recipient_company_code text,
  p_auto_create_client boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipient_company_id bigint;
  v_requester_company_name text;
  v_requester_company_code text;
  v_contractors_row public.contractors%ROWTYPE;
BEGIN
  SELECT * INTO v_contractors_row
  FROM public.contractors c
  WHERE c.id = p_contractor_id
    AND c.company_id = p_requester_company_id;

  IF v_contractors_row.id IS NULL THEN
    RAISE EXCEPTION 'Contractor not found for requester company';
  END IF;

  SELECT c.id INTO v_recipient_company_id
  FROM public.companies c
  WHERE lower(c.company_code) = lower(trim(coalesce(p_recipient_company_code, '')))
  LIMIT 1;

  IF v_recipient_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'recipient_company_not_found');
  END IF;

  IF v_recipient_company_id = p_requester_company_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'same_company_not_allowed');
  END IF;

  INSERT INTO public.company_relationships (
    requester_company_id,
    recipient_company_id,
    relationship_type,
    status,
    source_contractor_id,
    updated_at
  )
  VALUES (
    p_requester_company_id,
    v_recipient_company_id,
    'client_contractor',
    'active',
    p_contractor_id,
    now()
  )
  ON CONFLICT (requester_company_id, recipient_company_id, relationship_type)
  DO UPDATE SET
    status = 'active',
    source_contractor_id = excluded.source_contractor_id,
    updated_at = now();

  UPDATE public.contractors c
  SET linked_company_id = v_recipient_company_id,
      linked_company_status = 'linked',
      updated_at = now()
  WHERE c.id = p_contractor_id
    AND c.company_id = p_requester_company_id;

  IF p_auto_create_client THEN
    SELECT name, company_code
      INTO v_requester_company_name, v_requester_company_code
    FROM public.companies
    WHERE id = p_requester_company_id;

    INSERT INTO public.clients (
      company_id,
      name,
      notes,
      client_type,
      linked_company_id,
      source_contractor_id
    )
    VALUES (
      v_recipient_company_id,
      coalesce(v_requester_company_name, 'Linked company'),
      'Auto-created from contractor link. Company code: ' || coalesce(v_requester_company_code, ''),
      'company',
      p_requester_company_id,
      p_contractor_id
    )
    ON CONFLICT (company_id, linked_company_id)
    WHERE linked_company_id IS NOT NULL
    DO UPDATE SET
      name = excluded.name,
      source_contractor_id = excluded.source_contractor_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'recipient_company_id', v_recipient_company_id,
    'contractor_id', p_contractor_id,
    'linked', true
  );
END;
$$;
