-- Mark one time template per company as the default for employee import / onboarding.

ALTER TABLE public.employee_shift_templates
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_employee_shift_templates_company_default
  ON public.employee_shift_templates (company_id)
  WHERE is_default = true;

CREATE OR REPLACE FUNCTION public.hr_set_default_shift_template(
  p_company_id uuid,
  p_template_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.employee_shift_templates%rowtype;
BEGIN
  UPDATE public.employee_shift_templates
  SET is_default = false
  WHERE company_id = p_company_id;

  UPDATE public.employee_shift_templates
  SET is_default = true
  WHERE id = p_template_id AND company_id = p_company_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Time template not found for this company';
  END IF;

  RETURN row_to_json(v_row);
END;
$$;

GRANT EXECUTE ON FUNCTION public.hr_set_default_shift_template(uuid, uuid) TO authenticated, anon;
