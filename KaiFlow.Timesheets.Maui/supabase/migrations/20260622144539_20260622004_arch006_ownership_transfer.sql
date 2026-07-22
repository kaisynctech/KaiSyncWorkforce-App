-- ============================================================
-- ARCH-006 Migration 1
-- ownership_transfer_requests table + initiate + verify RPCs
-- ============================================================

-- Table ----------------------------------------------------------
CREATE TABLE public.ownership_transfer_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    initiated_by        uuid NOT NULL,
    target_employee_id  uuid NOT NULL REFERENCES public.employees(id),
    otp                 text NOT NULL,
    expires_at          timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
    failed_attempts     int NOT NULL DEFAULT 0,
    status              text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'verified', 'expired', 'invalidated')),
    verified_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ownership_transfer_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "otr_select_owner"
    ON public.ownership_transfer_requests
    FOR SELECT
    TO authenticated
    USING (
        company_id = ANY(user_company_ids())
        AND get_my_role(company_id) = 'owner'
    );

CREATE INDEX idx_otr_company_status
    ON public.ownership_transfer_requests (company_id, status, expires_at);

COMMENT ON TABLE public.ownership_transfer_requests IS
    'Server-issued OTP records for ownership transfer confirmation. '
    'Expires in 15 minutes. Max 3 failed attempts. Single-use. '
    'All writes via SECURITY DEFINER RPCs only.';

-- RPC 1: initiate_ownership_transfer --------------------------------
CREATE OR REPLACE FUNCTION public.initiate_ownership_transfer(
    p_company_id        uuid,
    p_target_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role   text;
    v_target_level  text;
    v_target_name   text;
    v_otp           text;
    v_request_id    uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;

    v_caller_role := get_my_role(p_company_id);
    IF v_caller_role != 'owner' THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE: only the owner can initiate a transfer'
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT hr_check_step_up_valid(p_company_id) THEN
        RAISE EXCEPTION 'STEP_UP_REQUIRED: complete step-up verification first'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT access_level,
           trim(coalesce(name,'') || ' ' || coalesce(surname,''))
    INTO   v_target_level, v_target_name
    FROM   public.employees
    WHERE  id         = p_target_employee_id
      AND  company_id = p_company_id
      AND  is_active  = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TARGET_NOT_FOUND: employee not found or inactive'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_target_level NOT IN ('hr', 'manager') THEN
        RAISE EXCEPTION 'TARGET_ROLE_INSUFFICIENT: target must have hr or manager role. Current role: %. Promote them first, then initiate transfer.',
            v_target_level
            USING ERRCODE = 'P0002';
    END IF;

    IF p_target_employee_id IN (
        SELECT id FROM public.employees
        WHERE company_id = p_company_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Cannot transfer ownership to yourself' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.ownership_transfer_requests
    SET status = 'expired'
    WHERE company_id = p_company_id
      AND status     = 'pending';

    v_otp := lpad(
        (abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int4) % 900000 + 100000)::text,
        6, '0'
    );

    INSERT INTO public.ownership_transfer_requests (
        company_id, initiated_by, target_employee_id, otp
    ) VALUES (
        p_company_id, auth.uid(), p_target_employee_id, v_otp
    ) RETURNING id INTO v_request_id;

    BEGIN
        PERFORM write_audit_event(
            p_company_id  := p_company_id,
            p_event_type  := 'ownership_transfer.initiated',
            p_table_name  := 'ownership_transfer_requests',
            p_record_id   := v_request_id::text,
            p_payload     := jsonb_build_object(
                'transfer_id',          v_request_id,
                'target_employee_id',   p_target_employee_id,
                'target_name',          v_target_name,
                'initiated_by',         auth.uid(),
                'expires_at',           now() + interval '15 minutes'
            )
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;

    RETURN jsonb_build_object(
        'transfer_id', v_request_id,
        'otp',         v_otp,
        'expires_at',  now() + interval '15 minutes',
        'target_name', v_target_name
    );
END;
$$;

REVOKE ALL ON FUNCTION public.initiate_ownership_transfer(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initiate_ownership_transfer(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.initiate_ownership_transfer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_ownership_transfer(uuid, uuid) TO service_role;

-- RPC 2: verify_ownership_transfer_otp -------------------------------
CREATE OR REPLACE FUNCTION public.verify_ownership_transfer_otp(
    p_company_id  uuid,
    p_transfer_id uuid,
    p_otp         text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_request       ownership_transfer_requests%ROWTYPE;
    v_caller_role   text;
    v_initiation_ts timestamptz;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
    END IF;

    v_caller_role := get_my_role(p_company_id);
    IF v_caller_role != 'owner' THEN
        RAISE EXCEPTION 'INSUFFICIENT_ROLE: caller is no longer owner'
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT hr_check_step_up_valid(p_company_id) THEN
        RAISE EXCEPTION 'STEP_UP_REQUIRED: step-up session expired — re-authenticate and try again'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_request
    FROM   public.ownership_transfer_requests
    WHERE  id         = p_transfer_id
      AND  company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'TRANSFER_NOT_FOUND: transfer request not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_request.initiated_by != auth.uid() THEN
        RAISE EXCEPTION 'TRANSFER_NOT_FOUND: transfer request not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_request.status != 'pending' THEN
        RAISE EXCEPTION 'TRANSFER_INVALID: transfer is % — initiate a new transfer',
            v_request.status
            USING ERRCODE = 'P0002';
    END IF;

    IF v_request.expires_at < now() THEN
        UPDATE public.ownership_transfer_requests
        SET status = 'expired' WHERE id = p_transfer_id;
        RAISE EXCEPTION 'TRANSFER_EXPIRED: the 15-minute window has passed — initiate a new transfer'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_request.otp != p_otp THEN
        UPDATE public.ownership_transfer_requests
        SET failed_attempts = failed_attempts + 1,
            status = CASE WHEN failed_attempts + 1 >= 3 THEN 'invalidated' ELSE status END
        WHERE id = p_transfer_id;

        IF v_request.failed_attempts + 1 >= 3 THEN
            RAISE EXCEPTION 'TRANSFER_INVALIDATED: too many incorrect attempts — initiate a new transfer'
                USING ERRCODE = 'P0002';
        ELSE
            RAISE EXCEPTION 'OTP_INCORRECT: incorrect code — % attempt(s) remaining',
                (3 - v_request.failed_attempts - 1)
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    v_initiation_ts := v_request.created_at;

    UPDATE public.ownership_transfer_requests
    SET status      = 'verified',
        verified_at = now()
    WHERE id = p_transfer_id;

    BEGIN
        PERFORM write_audit_event(
            p_company_id  := p_company_id,
            p_event_type  := 'ownership_transfer.otp_verified',
            p_table_name  := 'ownership_transfer_requests',
            p_record_id   := p_transfer_id::text,
            p_payload     := jsonb_build_object(
                'transfer_id',           p_transfer_id,
                'target_employee_id',    v_request.target_employee_id,
                'initiated_by',          v_request.initiated_by,
                'initiated_by_role',     'owner',
                'initiated_at',          v_initiation_ts,
                'otp_verified_at',       now()
            )
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'audit_write_failed: % %', SQLSTATE, SQLERRM;
    END;

    PERFORM transfer_company_ownership(p_company_id, v_request.target_employee_id);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_ownership_transfer_otp(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_ownership_transfer_otp(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_ownership_transfer_otp(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_ownership_transfer_otp(uuid, uuid, text) TO service_role;;
