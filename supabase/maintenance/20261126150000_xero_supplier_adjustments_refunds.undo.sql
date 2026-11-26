-- Undo 20261126150000: back to 20261126130000's behaviour. Run BEFORE the 20261126130000 undo if undoing both.
BEGIN;
CREATE OR REPLACE FUNCTION public._trg_po_bill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bill uuid;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.supplier_invoices SET status = 'cancelled', updated_at = now()
     WHERE po_id = NEW.id AND grn_id IS NULL AND status <> 'cancelled' AND coalesce(amount_paid, 0) = 0;
    RETURN NEW;
  END IF;
  IF NEW.status IN ('sent', 'partially_received', 'received') AND public._po_bill_of(NEW.id) IS NULL THEN
    v_bill := public._po_sync_bill(NEW.id, true);
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public._trg_xero_supplier_payment_tx() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.transaction_type = 'supplier_payment' AND NEW.direction = 'outgoing' AND NEW.source_table = 'supplier_invoices' THEN
    PERFORM public.xero_enqueue(NEW.company_id, 'supplier_payment', NEW.id,
      'Supplier payment ' || coalesce(NEW.reference_number, ''), NEW.transaction_date);
  END IF;
  RETURN NEW;
END $$;
-- (po_record_refund and _trg_xero_supplier_invoice keep working as they are; the extra column and check values are harmless.)
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261126150000';
COMMIT;
