
-- Drop old versions that use auth.uid()
DROP FUNCTION IF EXISTS hr_upsert_shift_template(uuid, uuid, text, text, text, int, jsonb);
DROP FUNCTION IF EXISTS hr_delete_shift_template(uuid, uuid);

-- Recreate: validate via employees table, same pattern as all other RPCs in this app
CREATE OR REPLACE FUNCTION hr_upsert_shift_template(
    p_hr_employee_id  uuid,
    p_company_id      uuid,
    p_id              uuid,
    p_name            text,
    p_start_time      text,
    p_end_time        text,
    p_break_minutes   int,
    p_breaks          jsonb
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_row employee_shift_templates%rowtype;
BEGIN
    -- Validate the caller is an active HR/owner/manager employee for this company
    IF NOT EXISTS (
        SELECT 1 FROM employees
        WHERE id = p_hr_employee_id
          AND company_id = p_company_id
          AND is_active = true
          AND access_level IN ('hr', 'owner', 'manager')
    ) THEN
        RAISE EXCEPTION 'Not authorised for this company';
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO employee_shift_templates
            (id, company_id, name, start_time, end_time, break_minutes, breaks)
        VALUES
            (gen_random_uuid(), p_company_id, p_name,
             p_start_time::time, p_end_time::time, p_break_minutes, p_breaks)
        RETURNING * INTO v_row;
    ELSE
        UPDATE employee_shift_templates SET
            name          = p_name,
            start_time    = p_start_time::time,
            end_time      = p_end_time::time,
            break_minutes = p_break_minutes,
            breaks        = p_breaks
        WHERE id = p_id AND company_id = p_company_id
        RETURNING * INTO v_row;
    END IF;

    RETURN row_to_json(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION hr_delete_shift_template(
    p_hr_employee_id  uuid,
    p_id              uuid,
    p_company_id      uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM employees
        WHERE id = p_hr_employee_id
          AND company_id = p_company_id
          AND is_active = true
          AND access_level IN ('hr', 'owner', 'manager')
    ) THEN
        RAISE EXCEPTION 'Not authorised for this company';
    END IF;

    DELETE FROM employee_shift_templates
    WHERE id = p_id AND company_id = p_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION hr_upsert_shift_template(uuid, uuid, uuid, text, text, text, int, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION hr_delete_shift_template(uuid, uuid, uuid) TO authenticated, anon;
;
