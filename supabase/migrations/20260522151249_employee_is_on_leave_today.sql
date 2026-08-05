
CREATE OR REPLACE FUNCTION employee_is_on_leave_today(
    p_company_id  uuid,
    p_employee_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM leave_requests
        WHERE company_id  = p_company_id
          AND employee_id = p_employee_id
          AND status      = 'approved'
          AND start_date  <= CURRENT_DATE
          AND end_date    >= CURRENT_DATE
    );
END;
$$;

GRANT EXECUTE ON FUNCTION employee_is_on_leave_today(uuid, uuid) TO anon, authenticated;
;
