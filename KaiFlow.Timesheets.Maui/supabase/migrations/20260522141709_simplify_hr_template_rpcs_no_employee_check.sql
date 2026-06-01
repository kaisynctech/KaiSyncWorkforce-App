
-- Drop all versions of both functions (any signature)
DROP FUNCTION IF EXISTS hr_upsert_shift_template(uuid, uuid, uuid, text, text, text, int, jsonb);
DROP FUNCTION IF EXISTS hr_upsert_shift_template(uuid, uuid, text, text, text, int, jsonb);
DROP FUNCTION IF EXISTS hr_delete_shift_template(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS hr_delete_shift_template(uuid, uuid);

-- Simple versions: no auth check, company_id scoped — same pattern as get_employee_shift_templates
CREATE OR REPLACE FUNCTION hr_upsert_shift_template(
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
    p_id         uuid,
    p_company_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    DELETE FROM employee_shift_templates
    WHERE id = p_id AND company_id = p_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION hr_upsert_shift_template(uuid, uuid, text, text, text, int, jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION hr_delete_shift_template(uuid, uuid) TO authenticated, anon;
;
