-- Phase 2D.2: Contractor Quotes — schema foundation + portal RPCs.
--
-- Tables: contractor_quotes, contractor_quote_items, contractor_quote_attachments
-- Storage: workforce-media/contractor_quotes/ folder policies
-- RPCs:   list, get, save_draft, submit, upload, delete_draft
-- Helper: notify_hr_contractor_quote
--
-- Schema is ready for Phase 2D.3 (HR approve/reject) and 2D.4 (PDF, convert to job).


-- ── 1. contractor_quotes ──────────────────────────────────────────────────────

CREATE TABLE public.contractor_quotes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id)   ON DELETE CASCADE,
  contractor_id       uuid        NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,

  -- Identity
  quote_number        text,
  title               text        NOT NULL,
  description         text,

  -- Creation mode
  source_mode         text        NOT NULL DEFAULT 'manual'
    CHECK (source_mode IN ('manual', 'upload')),

  -- Financials (mirrors finance_invoice pattern — SA VAT-aware)
  currency            text        NOT NULL DEFAULT 'ZAR',
  subtotal            numeric     NOT NULL DEFAULT 0,
  discount_amount     numeric     NOT NULL DEFAULT 0,
  vat_rate            numeric     NOT NULL DEFAULT 0.15,
  vat_amount          numeric     NOT NULL DEFAULT 0,
  total_amount        numeric     NOT NULL DEFAULT 0,
  is_vat_inclusive    boolean     NOT NULL DEFAULT false,

  -- Dates
  quote_date          date        NOT NULL DEFAULT CURRENT_DATE,
  valid_until         date,

  -- Status workflow (Phase 2D.3 adds approve/reject; Phase 2D.4 adds convert)
  status              text        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected','expired','converted')),

  -- HR review placeholders (populated in Phase 2D.3)
  reviewed_by         uuid        REFERENCES public.employees(id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  rejection_reason    text,

  -- Job conversion placeholder (Phase 2D.4)
  converted_to_job_id uuid        REFERENCES public.jobs(id) ON DELETE SET NULL,
  converted_at        timestamptz,

  -- Notes
  terms               text,
  contractor_notes    text,       -- visible to contractor + HR
  internal_notes      text,       -- HR-only, never returned to portal RPCs

  -- Sender branding snapshot (captured at submission; immutable)
  sender_name         text,
  sender_reg_number   text,
  sender_vat_number   text,

  -- Timestamps
  submitted_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_contractor_quote_number
  ON public.contractor_quotes (company_id, contractor_id, quote_number)
  WHERE quote_number IS NOT NULL;

CREATE INDEX idx_contractor_quotes_contractor
  ON public.contractor_quotes (contractor_id, company_id, status, created_at DESC);

CREATE INDEX idx_contractor_quotes_company_submitted
  ON public.contractor_quotes (company_id, submitted_at DESC)
  WHERE status = 'submitted';

CREATE OR REPLACE TRIGGER trg_contractor_quotes_updated_at
  BEFORE UPDATE ON public.contractor_quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.contractor_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_contractor_quotes_authenticated ON public.contractor_quotes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE public.contractor_quotes IS
  'Contractor-submitted quotes to the company. Phase 2D.2. '
  'Status workflow: draft→submitted→approved/rejected→converted. '
  'Phase 2D.3 adds HR approve/reject; Phase 2D.4 adds convert-to-job and PDF.';


-- ── 2. contractor_quote_items ─────────────────────────────────────────────────

CREATE TABLE public.contractor_quote_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        uuid        NOT NULL
                              REFERENCES public.contractor_quotes(id) ON DELETE CASCADE,
  company_id      uuid        NOT NULL,
  line_no         int         NOT NULL DEFAULT 1,
  description     text        NOT NULL,
  quantity        numeric     NOT NULL DEFAULT 1,
  unit_price      numeric     NOT NULL DEFAULT 0,
  discount_amount numeric     NOT NULL DEFAULT 0,
  subtotal        numeric     NOT NULL DEFAULT 0,
  vat_rate        numeric     NOT NULL DEFAULT 0.15,
  vat_amount      numeric     NOT NULL DEFAULT 0,
  line_total      numeric     NOT NULL DEFAULT 0,
  is_vat_inclusive boolean    NOT NULL DEFAULT false,
  sort_order      int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_quote_line_no UNIQUE (quote_id, line_no)
);

CREATE INDEX idx_contractor_quote_items_quote
  ON public.contractor_quote_items (quote_id, sort_order);

ALTER TABLE public.contractor_quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_contractor_quote_items_authenticated ON public.contractor_quote_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 3. contractor_quote_attachments ──────────────────────────────────────────

CREATE TABLE public.contractor_quote_attachments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        uuid        NOT NULL
                              REFERENCES public.contractor_quotes(id) ON DELETE CASCADE,
  company_id      uuid        NOT NULL,
  contractor_id   uuid        NOT NULL,
  file_name       text        NOT NULL,
  file_url        text        NOT NULL,
  storage_path    text,
  file_size_bytes bigint,
  mime_type       text,
  is_primary      boolean     NOT NULL DEFAULT true,
  uploaded_by     text        NOT NULL DEFAULT 'contractor_portal'
    CHECK (uploaded_by IN ('contractor_portal', 'hr')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contractor_quote_attachments_quote
  ON public.contractor_quote_attachments (quote_id, is_primary DESC);

ALTER TABLE public.contractor_quote_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_contractor_quote_attachments_authenticated ON public.contractor_quote_attachments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── 4. Storage policies for contractor_quotes/ folder ────────────────────────

DROP POLICY IF EXISTS p_workforce_media_contractor_quotes_insert ON storage.objects;
CREATE POLICY p_workforce_media_contractor_quotes_insert ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'workforce-media'
    AND (storage.foldername(name))[1] = 'contractor_quotes'
  );

DROP POLICY IF EXISTS p_workforce_media_contractor_quotes_select ON storage.objects;
CREATE POLICY p_workforce_media_contractor_quotes_select ON storage.objects
  FOR SELECT TO anon
  USING (
    bucket_id = 'workforce-media'
    AND (storage.foldername(name))[1] = 'contractor_quotes'
  );


-- ── 5. Auto-number generator ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_contractor_quote_number(
    p_company_id    uuid,
    p_contractor_id uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_company_code     text;
    v_contractor_code  text;
    v_next_seq         int;
BEGIN
    SELECT c.code, ct.contractor_code
    INTO   v_company_code, v_contractor_code
    FROM   public.contractors ct
    JOIN   public.companies   c ON c.id = ct.company_id
    WHERE  ct.id = p_contractor_id AND ct.company_id = p_company_id;

    SELECT coalesce(max(
        CASE WHEN quote_number ~ '-([0-9]+)$'
             THEN (regexp_match(quote_number, '-([0-9]+)$'))[1]::int
             ELSE 0 END
    ), 0) + 1
    INTO  v_next_seq
    FROM  public.contractor_quotes
    WHERE contractor_id = p_contractor_id AND company_id = p_company_id;

    RETURN 'QT-' || coalesce(v_company_code, 'XX')
        || '-' || coalesce(v_contractor_code, 'CT')
        || '-' || lpad(v_next_seq::text, 4, '0');
END;
$$;


-- ── 6. HR notify helper ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_hr_contractor_quote(
    p_company_id      uuid,
    p_contractor_id   uuid,
    p_contractor_name text,
    p_quote_number    text,
    p_total_amount    numeric
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    r             RECORD;
    v_hour_window text := to_char(now(), 'YYYYMMDDHH24');
    v_body        text;
BEGIN
    v_body := coalesce(nullif(trim(p_contractor_name), ''), 'Contractor')
        || ' submitted quote '
        || coalesce(p_quote_number, '')
        || ' for R' || to_char(p_total_amount, 'FM999,999,990.00')
        || ' — please review.';

    FOR r IN
        SELECT DISTINCT e.user_id AS auth_user_id, e.id AS employee_id
        FROM   public.employees e
        WHERE  e.company_id  = p_company_id
          AND  e.is_active   = true
          AND  e.user_id     IS NOT NULL
          AND  e.access_level IN ('owner', 'hr_admin', 'admin', 'hr', 'manager')
    LOOP
        INSERT INTO public.app_notifications (
            company_id, audience,
            recipient_auth_user_id, recipient_employee_id,
            type, title, body,
            ref_type, ref_id, dedupe_key, data
        ) VALUES (
            p_company_id, 'hr',
            r.auth_user_id, r.employee_id,
            'contractor_quote_submitted',
            'Quote Submitted for Review',
            v_body,
            'contractor', p_contractor_id::text,
            'contractor_quote_submitted:' || p_contractor_id::text
                || ':' || r.employee_id::text || ':' || v_hour_window,
            jsonb_build_object(
                'contractor_id',  p_contractor_id,
                'quote_number',   p_quote_number,
                'total_amount',   p_total_amount
            )
        )
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_hr_contractor_quote TO anon, authenticated;


-- ── 7. Portal: list quotes ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contractor_portal_list_quotes(
    p_contractor_id uuid,
    p_company_id    uuid
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.contractors
        WHERE id = p_contractor_id AND company_id = p_company_id AND is_active = true
    ) THEN RETURN '[]'::json; END IF;

    RETURN coalesce((
        SELECT json_agg(row_to_json(q) ORDER BY q.created_at DESC)
        FROM (
            SELECT
                id, quote_number, title, description, source_mode, currency,
                subtotal, vat_amount, total_amount, quote_date, valid_until,
                -- Apply virtual expiry: submitted/approved past valid_until → expired
                CASE
                    WHEN status IN ('submitted','approved')
                         AND valid_until IS NOT NULL
                         AND valid_until < CURRENT_DATE
                    THEN 'expired'
                    ELSE status
                END AS status,
                contractor_notes, submitted_at, created_at, updated_at,
                reviewed_at, rejection_reason
            FROM public.contractor_quotes
            WHERE contractor_id = p_contractor_id
              AND company_id    = p_company_id
            ORDER BY
                CASE status WHEN 'draft' THEN 0 WHEN 'submitted' THEN 1 ELSE 2 END,
                created_at DESC
        ) q
    ), '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_list_quotes TO anon, authenticated;


-- ── 8. Portal: get single quote with items + attachments ──────────────────────

CREATE OR REPLACE FUNCTION public.contractor_portal_get_quote(
    p_contractor_id uuid,
    p_company_id    uuid,
    p_quote_id      uuid
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_quote record;
    v_items json;
    v_attachments json;
BEGIN
    SELECT * INTO v_quote
    FROM   public.contractor_quotes
    WHERE  id            = p_quote_id
      AND  contractor_id = p_contractor_id
      AND  company_id    = p_company_id;

    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT coalesce(json_agg(row_to_json(i) ORDER BY i.sort_order, i.line_no), '[]'::json)
    INTO   v_items
    FROM   public.contractor_quote_items i
    WHERE  i.quote_id = p_quote_id;

    SELECT coalesce(json_agg(row_to_json(a) ORDER BY a.is_primary DESC, a.created_at), '[]'::json)
    INTO   v_attachments
    FROM   public.contractor_quote_attachments a
    WHERE  a.quote_id = p_quote_id;

    RETURN json_build_object(
        'id',                 v_quote.id,
        'quote_number',       v_quote.quote_number,
        'title',              v_quote.title,
        'description',        v_quote.description,
        'source_mode',        v_quote.source_mode,
        'currency',           v_quote.currency,
        'subtotal',           v_quote.subtotal,
        'discount_amount',    v_quote.discount_amount,
        'vat_rate',           v_quote.vat_rate,
        'vat_amount',         v_quote.vat_amount,
        'total_amount',       v_quote.total_amount,
        'is_vat_inclusive',   v_quote.is_vat_inclusive,
        'quote_date',         v_quote.quote_date,
        'valid_until',        v_quote.valid_until,
        'status',             CASE
                                  WHEN v_quote.status IN ('submitted','approved')
                                       AND v_quote.valid_until IS NOT NULL
                                       AND v_quote.valid_until < CURRENT_DATE
                                  THEN 'expired' ELSE v_quote.status END,
        'terms',              v_quote.terms,
        'contractor_notes',   v_quote.contractor_notes,
        'submitted_at',       v_quote.submitted_at,
        'reviewed_at',        v_quote.reviewed_at,
        'rejection_reason',   v_quote.rejection_reason,
        'created_at',         v_quote.created_at,
        'updated_at',         v_quote.updated_at,
        'items',              v_items,
        'attachments',        v_attachments
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_get_quote TO anon, authenticated;


-- ── 9. Portal: save quote draft (create or update) ───────────────────────────
--
-- p_quote_id NULL → create new draft
-- p_quote_id set  → update existing draft (only drafts can be updated)
-- p_items: [{description,quantity,unit_price,discount_amount,vat_rate,is_vat_inclusive}]
-- Totals are computed server-side from items.

CREATE OR REPLACE FUNCTION public.contractor_portal_save_quote_draft(
    p_contractor_id     uuid,
    p_company_id        uuid,
    p_quote_id          uuid,       -- NULL = new draft
    p_title             text,
    p_description       text,
    p_quote_number      text,
    p_valid_until       date,
    p_vat_rate          numeric,
    p_terms             text,
    p_contractor_notes  text,
    p_items             jsonb       -- array of line item objects
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_ct            public.contractors%ROWTYPE;
    v_quote_id      uuid := p_quote_id;
    v_subtotal      numeric := 0;
    v_vat_amount    numeric := 0;
    v_total         numeric := 0;
    v_line_no       int    := 1;
    item            jsonb;
    v_qty           numeric;
    v_price         numeric;
    v_disc          numeric;
    v_vat           numeric;
    v_item_sub      numeric;
    v_item_vat      numeric;
    v_item_total    numeric;
BEGIN
    -- Validate contractor
    SELECT * INTO v_ct
    FROM   public.contractors
    WHERE  id = p_contractor_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contractor not found or inactive'; END IF;

    IF trim(coalesce(p_title,'')) = '' THEN RAISE EXCEPTION 'Title is required'; END IF;

    -- Compute totals from items
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
    LOOP
        v_qty   := coalesce((item->>'quantity')::numeric,    1);
        v_price := coalesce((item->>'unit_price')::numeric,  0);
        v_disc  := coalesce((item->>'discount_amount')::numeric, 0);
        v_vat   := coalesce((item->>'vat_rate')::numeric,   coalesce(p_vat_rate, 0.15));
        v_item_sub   := round(v_qty * v_price - v_disc, 4);
        v_item_vat   := round(v_item_sub * v_vat, 4);
        v_item_total := v_item_sub + v_item_vat;
        v_subtotal   := v_subtotal + v_item_sub;
        v_vat_amount := v_vat_amount + v_item_vat;
        v_total      := v_total + v_item_total;
    END LOOP;
    v_subtotal   := round(v_subtotal,   2);
    v_vat_amount := round(v_vat_amount, 2);
    v_total      := round(v_total,      2);

    IF v_quote_id IS NULL THEN
        -- Create new draft
        INSERT INTO public.contractor_quotes (
            company_id, contractor_id, quote_number, title, description,
            source_mode, vat_rate, subtotal, vat_amount, total_amount,
            valid_until, terms, contractor_notes, status, created_at, updated_at
        ) VALUES (
            p_company_id, p_contractor_id,
            nullif(trim(coalesce(p_quote_number,'')), ''),
            trim(p_title),
            nullif(trim(coalesce(p_description,'')), ''),
            'manual', coalesce(p_vat_rate, 0.15),
            v_subtotal, v_vat_amount, v_total,
            p_valid_until,
            nullif(trim(coalesce(p_terms,'')), ''),
            nullif(trim(coalesce(p_contractor_notes,'')), ''),
            'draft', now(), now()
        )
        RETURNING id INTO v_quote_id;
    ELSE
        -- Update existing draft (only drafts can be edited)
        UPDATE public.contractor_quotes
        SET
            quote_number     = nullif(trim(coalesce(p_quote_number,'')), ''),
            title            = trim(p_title),
            description      = nullif(trim(coalesce(p_description,'')), ''),
            vat_rate         = coalesce(p_vat_rate, 0.15),
            subtotal         = v_subtotal,
            vat_amount       = v_vat_amount,
            total_amount     = v_total,
            valid_until      = p_valid_until,
            terms            = nullif(trim(coalesce(p_terms,'')), ''),
            contractor_notes = nullif(trim(coalesce(p_contractor_notes,'')), ''),
            updated_at       = now()
        WHERE id            = v_quote_id
          AND contractor_id = p_contractor_id
          AND company_id    = p_company_id
          AND status        = 'draft';

        IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found or not editable'; END IF;

        -- Remove existing items before re-inserting
        DELETE FROM public.contractor_quote_items WHERE quote_id = v_quote_id;
    END IF;

    -- Insert line items
    v_line_no := 1;
    FOR item IN SELECT * FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
    LOOP
        v_qty   := coalesce((item->>'quantity')::numeric,    1);
        v_price := coalesce((item->>'unit_price')::numeric,  0);
        v_disc  := coalesce((item->>'discount_amount')::numeric, 0);
        v_vat   := coalesce((item->>'vat_rate')::numeric,   coalesce(p_vat_rate, 0.15));
        v_item_sub   := round(v_qty * v_price - v_disc, 4);
        v_item_vat   := round(v_item_sub * v_vat, 4);
        v_item_total := round(v_item_sub + v_item_vat, 4);

        INSERT INTO public.contractor_quote_items (
            quote_id, company_id, line_no, description,
            quantity, unit_price, discount_amount,
            subtotal, vat_rate, vat_amount, line_total,
            is_vat_inclusive, sort_order
        ) VALUES (
            v_quote_id, p_company_id, v_line_no,
            coalesce(item->>'description', ''),
            v_qty, v_price, v_disc,
            v_item_sub, v_vat, v_item_vat, v_item_total,
            coalesce((item->>'is_vat_inclusive')::boolean, false),
            v_line_no
        );
        v_line_no := v_line_no + 1;
    END LOOP;

    RETURN v_quote_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_save_quote_draft TO anon, authenticated;


-- ── 10. Portal: submit a draft quote ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contractor_portal_submit_quote(
    p_contractor_id uuid,
    p_company_id    uuid,
    p_quote_id      uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_ct    public.contractors%ROWTYPE;
    v_quote public.contractor_quotes%ROWTYPE;
BEGIN
    SELECT * INTO v_ct
    FROM   public.contractors
    WHERE  id = p_contractor_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contractor not found or inactive'; END IF;

    SELECT * INTO v_quote
    FROM   public.contractor_quotes
    WHERE  id = p_quote_id AND contractor_id = p_contractor_id
      AND  company_id = p_company_id AND status = 'draft';
    IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found'; END IF;

    IF v_quote.total_amount <= 0 AND NOT EXISTS (
        SELECT 1 FROM public.contractor_quote_items WHERE quote_id = p_quote_id
    ) THEN RAISE EXCEPTION 'Quote must have at least one line item or a total amount'; END IF;

    -- Capture branding snapshot at submission time
    UPDATE public.contractor_quotes
    SET
        status            = 'submitted',
        submitted_at      = now(),
        updated_at        = now(),
        -- Auto-generate quote number if not set
        quote_number      = coalesce(quote_number,
                              public.generate_contractor_quote_number(p_company_id, p_contractor_id)),
        -- Branding snapshot
        sender_name       = v_ct.name,
        sender_reg_number = v_ct.registration_number,
        sender_vat_number = v_ct.vat_number
    WHERE id = p_quote_id;

    -- Activity log
    INSERT INTO public.app_events (
        company_id, auth_user_id, screen, action, level, meta, created_at
    ) VALUES (
        p_company_id, NULL, 'ContractorPortal', 'contractor_quote_submitted', 'info',
        jsonb_build_object(
            'contractor_id', p_contractor_id,
            'quote_id',      p_quote_id,
            'quote_number',  v_quote.quote_number,
            'total_amount',  v_quote.total_amount
        ),
        now()
    );

    -- HR notifications
    PERFORM public.notify_hr_contractor_quote(
        p_company_id, p_contractor_id, v_ct.name,
        coalesce(v_quote.quote_number, p_quote_id::text),
        v_quote.total_amount
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_submit_quote TO anon, authenticated;


-- ── 11. Portal: upload quote (external document) ──────────────────────────────
-- Creates a submitted quote with an attachment in one call.
-- No line items — totals are entered manually from the uploaded document.

CREATE OR REPLACE FUNCTION public.contractor_portal_upload_quote(
    p_contractor_id    uuid,
    p_company_id       uuid,
    p_title            text,
    p_description      text,
    p_quote_number     text,
    p_subtotal         numeric,
    p_vat_amount       numeric,
    p_total_amount     numeric,
    p_valid_until      date,
    p_contractor_notes text,
    p_file_url         text,
    p_file_name        text,
    p_storage_path     text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_ct        public.contractors%ROWTYPE;
    v_quote_id  uuid;
    v_qnum      text;
BEGIN
    SELECT * INTO v_ct
    FROM   public.contractors
    WHERE  id = p_contractor_id AND company_id = p_company_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contractor not found or inactive'; END IF;

    IF trim(coalesce(p_title,'')) = '' THEN RAISE EXCEPTION 'Title is required'; END IF;
    IF trim(coalesce(p_file_url,'')) = '' THEN RAISE EXCEPTION 'File URL is required'; END IF;

    v_qnum := coalesce(
        nullif(trim(coalesce(p_quote_number,'')), ''),
        public.generate_contractor_quote_number(p_company_id, p_contractor_id)
    );

    INSERT INTO public.contractor_quotes (
        company_id, contractor_id, quote_number, title, description,
        source_mode, subtotal, vat_amount, total_amount,
        valid_until, contractor_notes,
        status, submitted_at,
        sender_name, sender_reg_number, sender_vat_number,
        created_at, updated_at
    ) VALUES (
        p_company_id, p_contractor_id, v_qnum, trim(p_title),
        nullif(trim(coalesce(p_description,'')), ''),
        'upload',
        coalesce(p_subtotal, 0), coalesce(p_vat_amount, 0), coalesce(p_total_amount, 0),
        p_valid_until, nullif(trim(coalesce(p_contractor_notes,'')), ''),
        'submitted', now(),
        v_ct.name, v_ct.registration_number, v_ct.vat_number,
        now(), now()
    )
    RETURNING id INTO v_quote_id;

    -- Attach uploaded document
    INSERT INTO public.contractor_quote_attachments (
        quote_id, company_id, contractor_id,
        file_name, file_url, storage_path, is_primary, uploaded_by
    ) VALUES (
        v_quote_id, p_company_id, p_contractor_id,
        p_file_name, p_file_url, p_storage_path, true, 'contractor_portal'
    );

    -- Activity log
    INSERT INTO public.app_events (
        company_id, auth_user_id, screen, action, level, meta, created_at
    ) VALUES (
        p_company_id, NULL, 'ContractorPortal', 'contractor_quote_submitted', 'info',
        jsonb_build_object(
            'contractor_id', p_contractor_id,
            'quote_id',      v_quote_id,
            'quote_number',  v_qnum,
            'total_amount',  p_total_amount,
            'source_mode',   'upload'
        ),
        now()
    );

    PERFORM public.notify_hr_contractor_quote(
        p_company_id, p_contractor_id, v_ct.name, v_qnum, coalesce(p_total_amount, 0)
    );

    RETURN v_quote_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_upload_quote TO anon, authenticated;


-- ── 12. Portal: delete a draft quote ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.contractor_portal_delete_draft(
    p_contractor_id uuid,
    p_company_id    uuid,
    p_quote_id      uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    DELETE FROM public.contractor_quotes
    WHERE  id            = p_quote_id
      AND  contractor_id = p_contractor_id
      AND  company_id    = p_company_id
      AND  status        = 'draft';   -- only drafts can be deleted

    IF NOT FOUND THEN RAISE EXCEPTION 'Draft not found or not deletable'; END IF;
    -- Items + attachments cascade-deleted automatically
END;
$$;

GRANT EXECUTE ON FUNCTION public.contractor_portal_delete_draft TO anon, authenticated;;
