CREATE OR REPLACE FUNCTION public.employee_update_profile(
  p_employee_id       uuid,
  p_company_id        uuid,
  p_first_name        text    DEFAULT NULL,
  p_last_name         text    DEFAULT NULL,
  p_phone             text    DEFAULT NULL,
  p_id_number         text    DEFAULT NULL,
  p_bank_account      text    DEFAULT NULL,
  p_bank_name         text    DEFAULT NULL,
  p_bank_branch_code  text    DEFAULT NULL,
  p_profile_photo_url text    DEFAULT NULL,
  p_session_token     text    DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old employees%rowtype;
    v_emp employees%rowtype;
    v_bank_changed boolean := false;
    v_name text;
    r record;
BEGIN
  PERFORM public._assert_worker_access(p_company_id, p_employee_id, p_session_token);
    SELECT * INTO v_old
    FROM employees
    WHERE id = p_employee_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found';
    END IF;
    v_bank_changed := (
        (p_bank_account IS NOT NULL AND p_bank_account IS DISTINCT FROM v_old.bank_account)
        OR (p_bank_name IS NOT NULL AND p_bank_name IS DISTINCT FROM v_old.bank_name)
        OR (p_bank_branch_code IS NOT NULL AND p_bank_branch_code IS DISTINCT FROM v_old.bank_branch_code)
    );
    UPDATE employees SET
        name             = coalesce(p_first_name,          name),
        surname          = coalesce(p_last_name,           surname),
        phone            = coalesce(p_phone,               phone),
        id_number        = coalesce(p_id_number,           id_number),
        bank_account     = coalesce(p_bank_account,        bank_account),
        bank_name        = coalesce(p_bank_name,           bank_name),
        bank_branch_code = coalesce(p_bank_branch_code,    bank_branch_code),
        profile_photo_url = coalesce(p_profile_photo_url,  profile_photo_url),
        bank_details_updated_at = CASE WHEN v_bank_changed THEN now() ELSE bank_details_updated_at END,
        bank_details_updated_by = CASE WHEN v_bank_changed THEN 'employee' ELSE bank_details_updated_by END
    WHERE id = p_employee_id
    RETURNING * INTO v_emp;
    IF v_bank_changed THEN
        v_name := trim(coalesce(v_emp.name, '') || ' ' || coalesce(v_emp.surname, ''));
        FOR r IN
            SELECT DISTINCT hr.user_id AS auth_user_id
            FROM employees hr
            WHERE hr.company_id = p_company_id
              AND hr.user_id IS NOT NULL
              AND hr.is_active = true
              AND hr.access_level IN ('owner', 'hr_admin', 'admin', 'hr')
              AND hr.id <> p_employee_id
        LOOP
            INSERT INTO app_notifications (
                company_id, audience, recipient_auth_user_id, recipient_employee_id,
                type, title, body, ref_type, ref_id, dedupe_key, data
            ) VALUES (
                p_company_id,
                'hr',
                r.auth_user_id,
                NULL,
                'bank_details_updated',
                'Banking details updated',
                v_name || ' updated their banking details for payroll.',
                'employee',
                p_employee_id::text,
                'bank_details_updated:' || p_employee_id::text || ':' || r.auth_user_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
                jsonb_build_object(
                    'employee_id', p_employee_id,
                    'company_id', p_company_id,
                    'employee_name', v_name
                )
            );
        END LOOP;
    END IF;
    RETURN row_to_json(v_emp);
END;
$$;;
