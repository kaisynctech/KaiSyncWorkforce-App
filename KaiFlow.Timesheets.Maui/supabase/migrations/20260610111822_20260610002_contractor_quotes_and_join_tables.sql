-- =============================================================================
-- Schema recovery: contractor_quotes, join tables, and conversion RPCs
-- =============================================================================
-- These objects were created directly on the live database and were missing
-- from the migrations folder (schema drift). This file documents them so the
-- repo reflects the actual database state.
--
-- All statements use CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE FUNCTION
-- so the file is safe to run on a database that already has these objects.
--
-- Captured from live DB on 2026-06-10.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- TABLE: contractor_quotes
-- HR-submitted quotes from contractors, flowing through draft → submitted →
-- approved / rejected → converted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contractor_quotes (
    id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
    company_id           uuid        NOT NULL REFERENCES public.companies(id)    ON DELETE CASCADE,
    contractor_id        uuid        NOT NULL REFERENCES public.contractors(id)  ON DELETE CASCADE,
    quote_number         text,
    title                text        NOT NULL,
    description          text,
    source_mode          text        NOT NULL DEFAULT 'manual',
    currency             text        NOT NULL DEFAULT 'ZAR',
    subtotal             numeric     NOT NULL DEFAULT 0,
    discount_amount      numeric     NOT NULL DEFAULT 0,
    vat_rate             numeric     NOT NULL DEFAULT 0.15,
    vat_amount           numeric     NOT NULL DEFAULT 0,
    total_amount         numeric     NOT NULL DEFAULT 0,
    is_vat_inclusive     boolean     NOT NULL DEFAULT false,
    vat_mode             text        NOT NULL DEFAULT 'exclusive',
    quote_date           date        NOT NULL DEFAULT CURRENT_DATE,
    valid_until          date,
    status               text        NOT NULL DEFAULT 'draft',
    reviewed_by          uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
    reviewed_at          timestamptz,
    rejection_reason     text,
    converted_to_job_id  uuid        REFERENCES public.jobs(id)      ON DELETE SET NULL,
    converted_at         timestamptz,
    submitted_at         timestamptz,
    freight_amount       numeric     NOT NULL DEFAULT 0,
    duty_amount          numeric     NOT NULL DEFAULT 0,
    levies_amount        numeric     NOT NULL DEFAULT 0,
    other_charges_amount numeric     NOT NULL DEFAULT 0,
    taxable_amount       numeric     NOT NULL DEFAULT 0,
    terms                text,
    contractor_notes     text,
    internal_notes       text,
    hr_notes             text,
    revision_comments    text,
    sender_name          text,
    sender_reg_number    text,
    sender_vat_number    text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contractor_quotes_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contractor_quote_number
    ON public.contractor_quotes (company_id, contractor_id, quote_number)
    WHERE quote_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contractor_quotes_contractor
    ON public.contractor_quotes (contractor_id, company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contractor_quotes_company_submitted
    ON public.contractor_quotes (company_id, submitted_at DESC)
    WHERE status = 'submitted';

ALTER TABLE public.contractor_quotes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'contractor_quotes'
          AND policyname = 'p_contractor_quotes_authenticated'
    ) THEN
        CREATE POLICY p_contractor_quotes_authenticated
            ON public.contractor_quotes
            FOR ALL
            USING (true);
    END IF;
END;
$$;


-- ---------------------------------------------------------------------------
-- TABLE: contractor_quote_items
-- Line items for each contractor quote.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contractor_quote_items (
    id               uuid        NOT NULL DEFAULT gen_random_uuid(),
    quote_id         uuid        NOT NULL REFERENCES public.contractor_quotes(id) ON DELETE CASCADE,
    company_id       uuid        NOT NULL REFERENCES public.companies(id)         ON DELETE CASCADE,
    line_no          integer     NOT NULL DEFAULT 1,
    description      text        NOT NULL,
    quantity         numeric     NOT NULL DEFAULT 1,
    unit_price       numeric     NOT NULL DEFAULT 0,
    discount_amount  numeric     NOT NULL DEFAULT 0,
    subtotal         numeric     NOT NULL DEFAULT 0,
    vat_rate         numeric     NOT NULL DEFAULT 0.15,
    vat_amount       numeric     NOT NULL DEFAULT 0,
    line_total       numeric     NOT NULL DEFAULT 0,
    is_vat_inclusive boolean     NOT NULL DEFAULT false,
    sort_order       integer     NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contractor_quote_items_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_line_no
    ON public.contractor_quote_items (quote_id, line_no);

CREATE INDEX IF NOT EXISTS idx_contractor_quote_items_quote
    ON public.contractor_quote_items (quote_id, sort_order);

ALTER TABLE public.contractor_quote_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'contractor_quote_items'
          AND policyname = 'p_contractor_quote_items_authenticated'
    ) THEN
        CREATE POLICY p_contractor_quote_items_authenticated
            ON public.contractor_quote_items
            FOR ALL
            USING (true);
    END IF;
END;
$$;


-- ---------------------------------------------------------------------------
-- TABLE: contractor_quote_attachments
-- Supporting documents (PDFs, images) attached to a contractor quote.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contractor_quote_attachments (
    id              uuid        NOT NULL DEFAULT gen_random_uuid(),
    quote_id        uuid        NOT NULL REFERENCES public.contractor_quotes(id) ON DELETE CASCADE,
    company_id      uuid        NOT NULL REFERENCES public.companies(id)         ON DELETE CASCADE,
    contractor_id   uuid        NOT NULL REFERENCES public.contractors(id)       ON DELETE CASCADE,
    file_name       text        NOT NULL,
    file_url        text        NOT NULL,
    storage_path    text,
    file_size_bytes bigint,
    mime_type       text,
    is_primary      boolean     NOT NULL DEFAULT true,
    uploaded_by     text        NOT NULL DEFAULT 'contractor_portal',
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contractor_quote_attachments_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_contractor_quote_attachments_quote
    ON public.contractor_quote_attachments (quote_id, is_primary DESC);

ALTER TABLE public.contractor_quote_attachments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'contractor_quote_attachments'
          AND policyname = 'p_contractor_quote_attachments_authenticated'
    ) THEN
        CREATE POLICY p_contractor_quote_attachments_authenticated
            ON public.contractor_quote_attachments
            FOR ALL
            USING (true);
    END IF;
END;
$$;


-- ---------------------------------------------------------------------------
-- TABLE: job_contractors
-- Many-to-many join between jobs and contractors.
-- Unique constraint on (job_id, contractor_id) prevents duplicate rows.
-- All writes go through hr_convert_quote_to_job or hr_upsert_job_contractor
-- (both SECURITY DEFINER) to bypass the user_company_ids() RLS check.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_contractors (
    id           uuid        NOT NULL DEFAULT gen_random_uuid(),
    company_id   uuid        NOT NULL REFERENCES public.companies(id)   ON DELETE CASCADE,
    job_id       uuid        NOT NULL REFERENCES public.jobs(id)        ON DELETE CASCADE,
    contractor_id uuid       NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
    quote_id     uuid        REFERENCES public.contractor_quotes(id)    ON DELETE SET NULL,
    role         text        NOT NULL DEFAULT 'general',
    scope_notes  text,
    quoted_amount numeric    NOT NULL DEFAULT 0,
    agreed_amount numeric    NOT NULL DEFAULT 0,
    status       text        NOT NULL DEFAULT 'assigned',
    assigned_at  timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    created_by   uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT job_contractors_pkey              PRIMARY KEY (id),
    CONSTRAINT job_contractors_job_contractor_uq UNIQUE (job_id, contractor_id)
);

CREATE INDEX IF NOT EXISTS idx_job_contractors_job
    ON public.job_contractors (job_id);

CREATE INDEX IF NOT EXISTS idx_job_contractors_contractor
    ON public.job_contractors (company_id, contractor_id);

CREATE INDEX IF NOT EXISTS idx_job_contractors_quote
    ON public.job_contractors (quote_id)
    WHERE quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_contractors_active
    ON public.job_contractors (company_id, status)
    WHERE status <> 'cancelled';

ALTER TABLE public.job_contractors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'job_contractors'
          AND policyname = 'job_contractors_all'
    ) THEN
        CREATE POLICY job_contractors_all
            ON public.job_contractors
            FOR ALL
            USING (company_id = ANY (public.user_company_ids()));
    END IF;
END;
$$;


-- ---------------------------------------------------------------------------
-- TABLE: project_contractors
-- Many-to-many join between client_deals (projects) and contractors.
-- Unique constraint on (deal_id, contractor_id) prevents duplicate rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_contractors (
    id            uuid        NOT NULL DEFAULT gen_random_uuid(),
    company_id    uuid        NOT NULL REFERENCES public.companies(id)     ON DELETE CASCADE,
    deal_id       uuid        NOT NULL REFERENCES public.client_deals(id)  ON DELETE CASCADE,
    contractor_id uuid        NOT NULL REFERENCES public.contractors(id)   ON DELETE CASCADE,
    role          text        NOT NULL DEFAULT 'general',
    scope_notes   text,
    status        text        NOT NULL DEFAULT 'active',
    assigned_at   timestamptz NOT NULL DEFAULT now(),
    completed_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_contractors_pkey              PRIMARY KEY (id),
    CONSTRAINT project_contractors_deal_contractor_uq UNIQUE (deal_id, contractor_id)
);

CREATE INDEX IF NOT EXISTS idx_project_contractors_deal
    ON public.project_contractors (deal_id);

CREATE INDEX IF NOT EXISTS idx_project_contractors_contractor
    ON public.project_contractors (company_id, contractor_id);

CREATE INDEX IF NOT EXISTS idx_project_contractors_active
    ON public.project_contractors (company_id, status)
    WHERE status <> 'removed';

ALTER TABLE public.project_contractors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'project_contractors'
          AND policyname = 'project_contractors_all'
    ) THEN
        CREATE POLICY project_contractors_all
            ON public.project_contractors
            FOR ALL
            USING (company_id = ANY (public.user_company_ids()));
    END IF;
END;
$$;


-- ---------------------------------------------------------------------------
-- RPC: hr_convert_quote_to_job (9-param, with p_deal_id)
-- Atomically creates a job from an approved contractor quote, writes
-- job_contractors, and (when p_deal_id is provided) project_contractors.
-- SECURITY DEFINER bypasses RLS on the join tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_convert_quote_to_job(
    p_company_id     uuid,
    p_hr_user_id     uuid,
    p_quote_id       uuid,
    p_job_title      text,
    p_description    text                     DEFAULT NULL,
    p_priority       text                     DEFAULT 'normal',
    p_scheduled_start timestamp with time zone DEFAULT NULL,
    p_scheduled_end   timestamp with time zone DEFAULT NULL,
    p_deal_id        uuid                     DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_quote  record;
    v_job_id uuid;
    v_code   text;
BEGIN
    -- Validate (row lock prevents races)
    SELECT * INTO v_quote
    FROM public.contractor_quotes
    WHERE id = p_quote_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found';
    END IF;
    IF v_quote.status != 'approved' THEN
        RAISE EXCEPTION 'Only approved quotes can be converted (current status: %)', v_quote.status;
    END IF;
    IF v_quote.converted_to_job_id IS NOT NULL THEN
        RAISE EXCEPTION 'Quote has already been converted to job %', v_quote.converted_to_job_id;
    END IF;

    -- Generate job code
    v_code := public._next_job_code(p_company_id);

    -- Create job (include deal_id if provided)
    INSERT INTO public.jobs (
        company_id, title, description, status, priority,
        contractor_id, contractor_cost, estimated_cost,
        source_quote_id, external_ref, deal_id,
        scheduled_start, scheduled_end,
        created_by_employee_id, job_code, created_at, updated_at
    ) VALUES (
        p_company_id,
        trim(p_job_title),
        trim(coalesce(p_description, '')),
        'scheduled',
        coalesce(p_priority, 'normal'),
        v_quote.contractor_id,
        v_quote.total_amount,
        v_quote.total_amount,
        p_quote_id,
        'quote:' || p_quote_id::text,
        p_deal_id,
        p_scheduled_start,
        p_scheduled_end,
        p_hr_user_id,
        v_code,
        now(),
        now()
    )
    RETURNING id INTO v_job_id;

    -- Mark quote as converted
    UPDATE public.contractor_quotes SET
        status              = 'converted',
        converted_to_job_id = v_job_id,
        converted_at        = now(),
        updated_at          = now()
    WHERE id = p_quote_id AND company_id = p_company_id;

    -- Write job_contractors (idempotent)
    INSERT INTO public.job_contractors (
        company_id, job_id, contractor_id, quote_id,
        role, agreed_amount, quoted_amount, status,
        assigned_at, created_at, updated_at
    ) VALUES (
        p_company_id, v_job_id, v_quote.contractor_id, p_quote_id,
        'general', v_quote.total_amount, v_quote.total_amount, 'assigned',
        now(), now(), now()
    )
    ON CONFLICT (job_id, contractor_id) DO NOTHING;

    -- Write project_contractors if deal provided (idempotent)
    IF p_deal_id IS NOT NULL THEN
        INSERT INTO public.project_contractors (
            company_id, deal_id, contractor_id,
            role, status, assigned_at, created_at, updated_at
        ) VALUES (
            p_company_id, p_deal_id, v_quote.contractor_id,
            'general', 'active', now(), now(), now()
        )
        ON CONFLICT (deal_id, contractor_id) DO NOTHING;
    END IF;

    -- Audit log
    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (
        p_company_id, p_hr_user_id,
        'contractor_quotes', 'contractor_quote_converted_to_job', 'info',
        jsonb_build_object(
            'quote_id',      p_quote_id,
            'job_id',        v_job_id,
            'job_code',      v_code,
            'job_title',     p_job_title,
            'quote_number',  v_quote.quote_number,
            'total_amount',  v_quote.total_amount,
            'contractor_id', v_quote.contractor_id,
            'deal_id',       p_deal_id
        )
    );

    RETURN json_build_object(
        'job_id',   v_job_id,
        'job_code', v_code
    );
END;
$function$;


-- ---------------------------------------------------------------------------
-- RPC: hr_upsert_job_contractor
-- Writes job_contractors and (when p_deal_id is provided) project_contractors.
-- Called by AssignToExistingJobAsync after hr_assign_quote_to_job.
-- SECURITY DEFINER bypasses RLS on the join tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_upsert_job_contractor(
    p_company_id    uuid,
    p_job_id        uuid,
    p_contractor_id uuid,
    p_quote_id      uuid    DEFAULT NULL,
    p_agreed_amount numeric DEFAULT 0,
    p_deal_id       uuid    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    -- Upsert job_contractors
    INSERT INTO public.job_contractors (
        company_id, job_id, contractor_id, quote_id,
        role, agreed_amount, quoted_amount, status,
        assigned_at, created_at, updated_at
    ) VALUES (
        p_company_id, p_job_id, p_contractor_id, p_quote_id,
        'general', p_agreed_amount, p_agreed_amount, 'assigned',
        now(), now(), now()
    )
    ON CONFLICT (job_id, contractor_id) DO NOTHING;

    -- Upsert project_contractors if deal provided
    IF p_deal_id IS NOT NULL THEN
        INSERT INTO public.project_contractors (
            company_id, deal_id, contractor_id,
            role, status, assigned_at, created_at, updated_at
        ) VALUES (
            p_company_id, p_deal_id, p_contractor_id,
            'general', 'active', now(), now(), now()
        )
        ON CONFLICT (deal_id, contractor_id) DO NOTHING;
    END IF;
END;
$function$;


-- ---------------------------------------------------------------------------
-- RPC: hr_assign_quote_to_job
-- Links an approved contractor quote to an existing job.
-- Does NOT write job_contractors — that is handled separately by
-- hr_upsert_job_contractor in the C# AssignToExistingJobAsync flow.
-- SECURITY DEFINER bypasses RLS on contractor_quotes and jobs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hr_assign_quote_to_job(
    p_company_id uuid,
    p_hr_user_id uuid,
    p_quote_id   uuid,
    p_job_id     uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_quote  record;
    v_job    record;
BEGIN
    -- Validate quote (lock row to prevent duplicate assignments)
    SELECT * INTO v_quote
    FROM public.contractor_quotes
    WHERE id = p_quote_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote not found';
    END IF;
    IF v_quote.status != 'approved' THEN
        RAISE EXCEPTION 'Only approved quotes can be assigned to a job (current status: %)',
            v_quote.status;
    END IF;
    IF v_quote.converted_to_job_id IS NOT NULL THEN
        RAISE EXCEPTION 'Quote has already been linked to job %',
            v_quote.converted_to_job_id;
    END IF;

    -- Validate job (must belong to same company)
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = p_job_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job not found or belongs to a different company';
    END IF;

    -- Link quote → job
    UPDATE public.contractor_quotes SET
        status              = 'converted',
        converted_to_job_id = p_job_id,
        converted_at        = now(),
        updated_at          = now()
    WHERE id = p_quote_id AND company_id = p_company_id;

    -- Update job
    UPDATE public.jobs SET
        contractor_id   = CASE
                              WHEN contractor_id IS NULL THEN v_quote.contractor_id
                              ELSE contractor_id
                          END,
        contractor_cost = contractor_cost + v_quote.total_amount,
        updated_at      = now()
    WHERE id = p_job_id AND company_id = p_company_id;

    -- Audit log
    INSERT INTO public.app_events (company_id, auth_user_id, screen, action, level, meta)
    VALUES (
        p_company_id,
        p_hr_user_id,
        'contractor_quotes',
        'contractor_quote_assigned_to_existing_job',
        'info',
        jsonb_build_object(
            'quote_id',      p_quote_id,
            'job_id',        p_job_id,
            'job_code',      v_job.job_code,
            'job_title',     v_job.title,
            'quote_number',  v_quote.quote_number,
            'total_amount',  v_quote.total_amount,
            'contractor_id', v_quote.contractor_id
        )
    );
END;
$function$;
