-- Clear SQL/default sentinel dates so client portal and HR do not show 0001-01-01.
UPDATE public.client_deals
SET
  expected_close_date = NULL,
  site_start_date = NULL,
  expected_completion_date = NULL,
  next_visit_date = NULL,
  quotation_valid_until = NULL
WHERE
  expected_close_date < DATE '1900-01-01'
  OR site_start_date < DATE '1900-01-01'
  OR expected_completion_date < DATE '1900-01-01'
  OR next_visit_date < DATE '1900-01-01'
  OR quotation_valid_until < DATE '1900-01-01';
