-- CLIENT-PORTAL-SPEC-002 P3: client statement + invoice detail (read-only, additive).
-- Applied 21 Oct 2026 (daytime, Nyarie approved) as migration client_portal_statement_and_invoice_detail.
-- Verified with a test invoice/payment/credit note inside a rolled-back transaction.

CREATE OR REPLACE FUNCTION public.client_portal_get_statement(p_company_code text, p_client_code text)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH cl AS (
    SELECT x.client_id, x.company_id FROM public._client_portal_client(p_company_code, p_client_code) x
  ),
  inv AS (
    SELECT i.* FROM public.finance_invoices i JOIN cl ON i.client_id = cl.client_id AND i.company_id = cl.company_id
    WHERE i.status NOT IN ('draft', 'cancelled', 'voided') AND i.voided_at IS NULL
  ),
  pay AS (
    SELECT t.source_id AS invoice_id, t.transaction_date, t.created_at, t.amount, t.reference_number, t.payment_method
    FROM public.finance_transactions t JOIN inv ON inv.id = t.source_id AND inv.company_id = t.company_id
    WHERE t.source_table = 'finance_invoices' AND t.direction = 'incoming'
  ),
  entries AS (
    SELECT coalesce(inv.issue_date, inv.created_at::date) AS entry_date, inv.created_at AS sort_at, 1 AS ord,
           'invoice' AS kind, inv.id AS invoice_id, inv.invoice_number AS reference,
           'Invoice ' || coalesce(inv.invoice_number, '') AS description,
           inv.total_amount AS debit, 0::numeric AS credit, inv.due_date, inv.status
    FROM inv
    UNION ALL
    SELECT coalesce(pay.transaction_date, pay.created_at::date), pay.created_at, 2,
           'payment', pay.invoice_id, coalesce(pay.reference_number, inv.invoice_number),
           'Payment received' || coalesce(' (' || nullif(pay.payment_method, '') || ')', ''),
           0, pay.amount, NULL, NULL
    FROM pay JOIN inv ON inv.id = pay.invoice_id
    UNION ALL
    -- Payments recorded on the invoice without a transaction row (older data)
    SELECT coalesce(inv.paid_date, inv.issue_date, inv.created_at::date), inv.created_at, 3,
           'payment', inv.id, inv.invoice_number, 'Payment received',
           0, inv.amount_paid - coalesce((SELECT sum(p.amount) FROM pay p WHERE p.invoice_id = inv.id), 0), NULL, NULL
    FROM inv
    WHERE inv.amount_paid - coalesce((SELECT sum(p.amount) FROM pay p WHERE p.invoice_id = inv.id), 0) > 0.009
    UNION ALL
    SELECT coalesce(cn.issue_date, cn.created_at::date), cn.created_at, 4,
           'credit_note', cn.invoice_id, cn.credit_note_number,
           'Credit note' || coalesce(' — ' || nullif(cn.reason_notes, ''), ''),
           0, cn.total_amount, NULL, cn.status
    FROM public.credit_notes cn JOIN cl ON cn.client_id = cl.client_id AND cn.company_id = cl.company_id
    WHERE coalesce(cn.status, '') NOT IN ('draft', 'void', 'voided', 'cancelled') AND cn.voided_at IS NULL
    UNION ALL
    SELECT coalesce(cn.issue_date, cn.created_at::date), cn.created_at, 5,
           'refund', cn.invoice_id, cn.credit_note_number, 'Refund paid to you',
           cn.refund_amount, 0, NULL, cn.status
    FROM public.credit_notes cn JOIN cl ON cn.client_id = cl.client_id AND cn.company_id = cl.company_id
    WHERE coalesce(cn.status, '') NOT IN ('draft', 'void', 'voided', 'cancelled') AND cn.voided_at IS NULL
      AND coalesce(cn.refund_amount, 0) > 0
  )
  SELECT coalesce(json_agg(row_to_json(e) ORDER BY e.entry_date, e.sort_at, e.ord), '[]'::json)
  FROM entries e;
$$;

CREATE OR REPLACE FUNCTION public.client_portal_get_invoice(p_company_code text, p_client_code text, p_invoice_id uuid)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT json_build_object(
    'id', i.id, 'invoice_number', i.invoice_number, 'status', i.status,
    'issue_date', i.issue_date, 'due_date', i.due_date, 'notes', i.notes,
    'subtotal', i.subtotal, 'vat_amount', i.vat_amount, 'total_amount', i.total_amount,
    'amount_paid', i.amount_paid, 'balance_due', i.balance_due,
    'client_name', c2.name, 'client_email', c2.email, 'company_name', co.name,
    'lines', coalesce((
      SELECT json_agg(json_build_object('description', l.description, 'qty', l.quantity, 'unit_price', l.unit_price,
                                        'vat_amount', l.vat_amount, 'total', l.total_amount) ORDER BY l.line_no)
      FROM public.finance_invoice_lines l WHERE l.invoice_id = i.id AND l.company_id = i.company_id
    ), '[]'::json)
  )
  FROM public._client_portal_client(p_company_code, p_client_code) x
  JOIN public.finance_invoices i ON i.client_id = x.client_id AND i.company_id = x.company_id AND i.id = p_invoice_id
  JOIN public.clients c2 ON c2.id = x.client_id
  JOIN public.companies co ON co.id = x.company_id
  WHERE i.status NOT IN ('draft', 'cancelled');
$$;

GRANT EXECUTE ON FUNCTION public.client_portal_get_statement(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_get_invoice(text, text, uuid) TO anon, authenticated;
