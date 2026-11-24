-- VAT-correct invoicing.
-- 1. New companies start as NOT VAT-registered; the owner ticks "VAT registered" in Settings if they are.
--    Existing companies keep their current setting.
-- 2. The client portal's invoice now carries the client's address and VAT number, so the PDF's
--    "Bill to" is complete (SARS: a full tax invoice above R5,000 names the recipient's address and VAT number).

ALTER TABLE public.companies ALTER COLUMN is_vat_registered SET DEFAULT false;

CREATE OR REPLACE FUNCTION public._cpc_get_invoice(p_client uuid, p_invoice_id uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'id', i.id, 'invoice_number', i.invoice_number, 'status', i.status,
    'issue_date', i.issue_date, 'due_date', i.due_date, 'notes', i.notes,
    'subtotal', i.subtotal, 'vat_amount', i.vat_amount, 'total_amount', i.total_amount,
    'amount_paid', i.amount_paid, 'balance_due', i.balance_due,
    'client_name', c2.name, 'client_legal_name', nullif(trim(c2.legal_name), ''), 'client_email', c2.email,
    'client_address', coalesce(nullif(trim(c2.billing_address), ''), nullif(trim(c2.address), '')),
    'client_vat_number', nullif(trim(c2.vat_number), ''),
    'company_name', co.name,
    'lines', coalesce((
      SELECT json_agg(json_build_object('description', l.description, 'qty', l.quantity, 'unit_price', l.unit_price,
                                        'vat_amount', l.vat_amount, 'total', l.total_amount) ORDER BY l.line_no)
      FROM public.finance_invoice_lines l WHERE l.invoice_id = i.id AND l.company_id = i.company_id
    ), '[]'::json)
  )
  FROM public.clients c2
  JOIN public.finance_invoices i ON i.client_id = c2.id AND i.company_id = c2.company_id AND i.id = p_invoice_id
  JOIN public.companies co ON co.id = c2.company_id
  WHERE c2.id = p_client AND i.status NOT IN ('draft', 'cancelled');
$function$;
