-- Undo 20261126130000_po_bill_payments_returns: back to bills made on delivery, payments to Xero once fully paid.
-- Bills already made from purchase orders, payments and refunds stay as they are (nothing is deleted).
-- The two new columns stay (they only hold data); they are simply no longer used.
BEGIN;
DROP TRIGGER IF EXISTS trg_xero_supplier_payment_tx ON public.finance_transactions;
DROP FUNCTION IF EXISTS public._trg_xero_supplier_payment_tx();
DROP TRIGGER IF EXISTS trg_po_bill ON public.purchase_orders;
DROP FUNCTION IF EXISTS public._trg_po_bill();
DROP FUNCTION IF EXISTS public.po_pay_supplier(uuid, numeric, date, text, text, text);
DROP FUNCTION IF EXISTS public.po_record_refund(uuid, numeric, date, text);

DROP TRIGGER IF EXISTS trg_xero_supplier_invoice ON public.supplier_invoices;
DROP FUNCTION public._trg_xero_supplier_invoice();
ALTER FUNCTION public._trg_xero_supplier_invoice_before_20261126() RENAME TO _trg_xero_supplier_invoice;
CREATE TRIGGER trg_xero_supplier_invoice AFTER INSERT OR UPDATE OF approval_status, status, total_amount ON public.supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION public._trg_xero_supplier_invoice();

DROP FUNCTION public.po_update_lines(uuid, jsonb);
ALTER FUNCTION public.po_update_lines_before_20261126(uuid, jsonb) RENAME TO po_update_lines;
GRANT EXECUTE ON FUNCTION public.po_update_lines(uuid, jsonb) TO authenticated;
DROP FUNCTION public.po_receive_goods(uuid, text, jsonb, text);
ALTER FUNCTION public.po_receive_goods_before_20261126(uuid, text, jsonb, text) RENAME TO po_receive_goods;
GRANT EXECUTE ON FUNCTION public.po_receive_goods(uuid, text, jsonb, text) TO authenticated;

DROP FUNCTION IF EXISTS public._po_sync_bill(uuid, boolean);
DROP FUNCTION IF EXISTS public._po_bill_of(uuid);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261126130000';
COMMIT;
