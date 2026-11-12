-- Projects use the normal quote (same builder, PDF, email and online accept). The project follows its quotes:
--   • a quote is sent        → project Sent, client answer "waiting" (draft / negotiation / lost projects only)
--   • a quote is accepted    → project Won, client answer "accepted" (unless already in progress)
--   • a quote is declined    → project back to Negotiation, client answer "asked for changes" (with the reason)
--   • the project's value    = the latest quote that isn't declined (the accepted one when there is one), excl. VAT
-- The client portal's "Accept" on a project now also accepts the quote itself, and the portal shows the quote's
-- number, currency and total.
-- Rollback: DROP TRIGGER trg_quote_project_sync ON public.commercial_quotes;
--           SELECT public._project_quote_restore();   (puts back the previous portal accept and project view)

-- ── 1. Keep the project in step with its quotes ──────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_quote_project_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.client_deals%ROWTYPE; v_value numeric; v_changed boolean;
BEGIN
  SELECT * INTO d FROM public.client_deals WHERE id = NEW.deal_id AND company_id = NEW.company_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_changed := TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status;

  SELECT q.subtotal INTO v_value FROM public.commercial_quotes q
   WHERE q.deal_id = d.id AND q.company_id = d.company_id AND q.status NOT IN ('declined', 'cancelled', 'expired')
   ORDER BY (q.status = 'accepted') DESC, coalesce(q.sent_at, q.updated_at, q.created_at) DESC
   LIMIT 1;

  UPDATE public.client_deals SET
    offer_amount = coalesce(v_value, offer_amount),
    status = CASE
      WHEN v_changed AND NEW.status = 'sent' AND d.status IN ('draft', 'negotiation', 'lost') THEN 'sent'
      WHEN v_changed AND NEW.status = 'accepted' AND d.status NOT IN ('in_progress', 'won') THEN 'won'
      WHEN v_changed AND NEW.status = 'declined' AND d.status IN ('draft', 'sent') THEN 'negotiation'
      ELSE status END,
    quotation_sent_at = CASE WHEN v_changed AND NEW.status = 'sent' THEN coalesce(NEW.sent_at, now()) ELSE quotation_sent_at END,
    quotation_response = CASE
      WHEN v_changed AND NEW.status = 'sent' THEN 'pending'
      WHEN v_changed AND NEW.status = 'accepted' THEN 'accepted'
      WHEN v_changed AND NEW.status = 'declined' THEN 'revision_requested'
      ELSE quotation_response END,
    quotation_response_note = CASE
      WHEN v_changed AND NEW.status IN ('sent', 'accepted') THEN NULL
      WHEN v_changed AND NEW.status = 'declined' THEN coalesce(nullif(trim(NEW.declined_reason), ''), 'Quote declined')
      ELSE quotation_response_note END,
    quotation_response_storage_path = CASE WHEN v_changed AND NEW.status IN ('sent', 'accepted') THEN NULL ELSE quotation_response_storage_path END,
    quotation_response_at = CASE WHEN v_changed AND NEW.status IN ('accepted', 'declined') THEN now() ELSE quotation_response_at END,
    updated_at = now()
  WHERE id = d.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quote_project_sync ON public.commercial_quotes;
CREATE TRIGGER trg_quote_project_sync AFTER INSERT OR UPDATE OF status, subtotal, total_amount, deal_id ON public.commercial_quotes
  FOR EACH ROW WHEN (NEW.deal_id IS NOT NULL) EXECUTE FUNCTION public._trg_quote_project_sync();

-- ── 2. Keep the previous portal functions so they can be put back ────────────
CREATE TABLE IF NOT EXISTS public._project_quote_backup (fn text PRIMARY KEY, def text NOT NULL, saved_at timestamptz DEFAULT now());
ALTER TABLE public._project_quote_backup ENABLE ROW LEVEL SECURITY;
INSERT INTO public._project_quote_backup (fn, def) VALUES
  ('_cpc_accept_quotation', pg_get_functiondef('public._cpc_accept_quotation(uuid,uuid)'::regprocedure)),
  ('_cpc_get_project', pg_get_functiondef('public._cpc_get_project(uuid,uuid)'::regprocedure))
ON CONFLICT (fn) DO NOTHING;
CREATE OR REPLACE FUNCTION public._project_quote_restore() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT def FROM public._project_quote_backup LOOP EXECUTE r.def; END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._project_quote_restore() FROM PUBLIC, anon, authenticated;

-- ── 3. Portal "Accept" also accepts the quote ────────────────────────────────
CREATE OR REPLACE FUNCTION public._cpc_accept_quotation(p_client uuid, p_deal_id uuid)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE v_deal public.client_deals%ROWTYPE; v_has_quote boolean; v_quote uuid;
BEGIN
  SELECT d.* INTO v_deal
  FROM public.clients cl JOIN public.client_deals d ON d.client_id = cl.id AND d.company_id = cl.company_id
  WHERE cl.id = p_client AND d.id = p_deal_id AND d.visibility <> 'private';
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_NOT_AVAILABLE'; END IF;
  IF v_deal.quotation_response = 'accepted' THEN RETURN; END IF;
  SELECT q.id INTO v_quote FROM public.commercial_quotes q
   WHERE q.deal_id = v_deal.id AND q.company_id = v_deal.company_id AND q.status IN ('sent', 'viewed')
   ORDER BY coalesce(q.sent_at, q.updated_at, q.created_at) DESC LIMIT 1;
  SELECT (v_quote IS NOT NULL OR coalesce(v_deal.offer_amount, 0) > 0 OR nullif(trim(coalesce(v_deal.quotation_notes, '')), '') IS NOT NULL
          OR v_deal.quotation_sent_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.project_quotation_lines ql WHERE ql.deal_id = v_deal.id)) INTO v_has_quote;
  IF NOT v_has_quote THEN RAISE EXCEPTION 'QUOTATION_NOT_SHARED'; END IF;
  IF v_quote IS NOT NULL THEN
    UPDATE public.commercial_quotes SET status = 'accepted', accepted_at = now(), updated_at = now() WHERE id = v_quote;
  END IF;
  UPDATE public.client_deals SET quotation_response = 'accepted', quotation_response_note = NULL, quotation_response_storage_path = NULL,
    quotation_response_at = now(), updated_at = now() WHERE id = v_deal.id;
END $function$;

-- ── 4. Portal project view: the quote's number, currency and total ───────────
DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._cpc_get_project(uuid,uuid)'::regprocedure);
  IF position('quote_currency' IN d) > 0 THEN RETURN; END IF;
  IF position('d.job_id, d.created_at, d.updated_at,' IN d) = 0
     OR position('SELECT q.id, q.scope_notes, q.valid_until, q.sent_at, q.total_amount' IN d) = 0 THEN
    RAISE EXCEPTION 'Portal project view has changed — not patched';
  END IF;
  d := replace(d, 'd.job_id, d.created_at, d.updated_at,',
    'd.job_id, d.created_at, d.updated_at, mq.id AS quote_id, mq.quote_number, mq.currency AS quote_currency, mq.status AS quote_status, mq.subtotal AS quote_subtotal, mq.vat_amount AS quote_vat, mq.total_amount AS quote_total,');
  d := replace(d, 'SELECT q.id, q.scope_notes, q.valid_until, q.sent_at, q.total_amount',
    'SELECT q.id, q.scope_notes, q.valid_until, q.sent_at, q.total_amount, q.quote_number, q.currency, q.status, q.subtotal, q.vat_amount');
  EXECUTE d;
END $patch$;
