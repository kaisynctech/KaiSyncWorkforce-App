
CREATE TABLE employee_shift_templates (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id     uuid        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name           text        NOT NULL,
    start_time     time        NOT NULL,
    end_time       time        NOT NULL,
    break_minutes  int         NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_shift_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_members_can_access_employee_shift_templates"
    ON employee_shift_templates FOR ALL
    USING (
        company_id IN (
            SELECT company_id FROM employees
            WHERE user_id = auth.uid() AND is_active = true
        )
    );

ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS shift_template_id uuid
    REFERENCES employee_shift_templates(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION get_employee_shift_templates(p_company_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN (
        SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.name), '[]'::json)
        FROM employee_shift_templates t
        WHERE t.company_id = p_company_id
    );
END; $$;

GRANT EXECUTE ON FUNCTION get_employee_shift_templates(uuid) TO anon, authenticated;
;
