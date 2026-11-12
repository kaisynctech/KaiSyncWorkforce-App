-- Xero Release 4: tracking (Project / Job), items, and the invoice PDF attached in Xero.
-- Adds only columns, list values and one small function; xero_sync_status gets four more fields.
-- Rollback:
--   DO $r$ BEGIN EXECUTE (SELECT def FROM public._fn_backup WHERE name = 'xero_sync_status before release 4'); END $r$;
--   DROP FUNCTION IF EXISTS public.xero_save_options(uuid, boolean, boolean, boolean);
--   (the new columns and list values can stay: nothing else uses them)

ALTER TABLE public.xero_connections
  ADD COLUMN IF NOT EXISTS track_projects_jobs boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS link_items boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS attach_pdfs boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tracking_project_id text,
  ADD COLUMN IF NOT EXISTS tracking_job_id text,
  ADD COLUMN IF NOT EXISTS tracking_note text;

-- The PDF that went to the client (saved when the invoice is emailed or marked sent).
ALTER TABLE public.finance_invoices
  ADD COLUMN IF NOT EXISTS pdf_path text,
  ADD COLUMN IF NOT EXISTS pdf_saved_at timestamptz;

ALTER TABLE public.xero_doc_links DROP CONSTRAINT IF EXISTS xero_doc_links_entity_check;
ALTER TABLE public.xero_doc_links ADD CONSTRAINT xero_doc_links_entity_check CHECK (entity = ANY (ARRAY[
  'invoice', 'credit_note', 'payment', 'po_bill', 'supplier_bill', 'supplier_payment', 'xero_payment', 'xero_supplier_payment',
  'tracking_project', 'tracking_job', 'item_inventory', 'item_catalogue', 'invoice_pdf']));

ALTER TABLE public.xero_sync_queue DROP CONSTRAINT IF EXISTS xero_sync_queue_entity_check;
ALTER TABLE public.xero_sync_queue ADD CONSTRAINT xero_sync_queue_entity_check CHECK (entity = ANY (ARRAY[
  'client', 'supplier', 'invoice', 'invoice_void', 'credit_note', 'payment', 'po_bill', 'supplier_bill', 'supplier_payment', 'invoice_pdf']));

-- Settings → Xero: the three switches.
CREATE OR REPLACE FUNCTION public.xero_save_options(p_company_id uuid, p_track boolean, p_items boolean, p_pdfs boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF public.xero_can_manage(p_company_id) IS NOT TRUE THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  UPDATE public.xero_connections SET track_projects_jobs = coalesce(p_track, true), link_items = coalesce(p_items, true),
    attach_pdfs = coalesce(p_pdfs, true), tracking_note = CASE WHEN p_track THEN tracking_note ELSE NULL END, updated_at = now()
  WHERE company_id = p_company_id;
END $$;
REVOKE ALL ON FUNCTION public.xero_save_options(uuid, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.xero_save_options(uuid, boolean, boolean, boolean) TO authenticated;

-- xero_sync_status: also say whether PDFs can be attached (needs the newer Xero permission) and the switches.
DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.xero_sync_status(uuid)'::regprocedure);
  IF position('can_attach_pdfs' IN d) > 0 THEN RETURN; END IF;
  INSERT INTO public._fn_backup (name, def) VALUES ('xero_sync_status before release 4', d)
    ON CONFLICT (name) DO UPDATE SET def = EXCLUDED.def, saved_at = now();
  IF position('''tenant_name'', c.tenant_name,' IN d) = 0 THEN RAISE EXCEPTION 'xero_sync_status changed: not patched'; END IF;
  EXECUTE replace(d, '''tenant_name'', c.tenant_name,',
    '''tenant_name'', c.tenant_name, ''can_attach_pdfs'', coalesce(c.scopes, '''') ILIKE ''%accounting.attachments%'',
    ''track_projects_jobs'', c.track_projects_jobs, ''link_items'', c.link_items, ''attach_pdfs'', c.attach_pdfs, ''tracking_note'', c.tracking_note,');
END $patch$;
