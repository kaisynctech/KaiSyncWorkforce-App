-- Every accepted quote gets a draft invoice, however it was accepted: the online quote page (email link or portal),
-- the portal / linked-company project Accept, or "Mark accepted" in the office. The office checks it and sends it;
-- the client only owes money once it is sent. One invoice per quote (_quote_to_draft_invoice reuses an open one).
-- When the client (not the office) accepted, the office is told, once per quote.
-- Rollback: DROP TRIGGER trg_quote_accepted_invoice ON public.commercial_quotes;

CREATE OR REPLACE FUNCTION public._trg_quote_accepted_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inv uuid; v_office boolean; v_client text;
BEGIN
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  BEGIN
    v_inv := public._quote_to_draft_invoice(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    v_inv := NULL;   -- never block the acceptance itself
  END;
  v_office := EXISTS (SELECT 1 FROM public.employees e WHERE e.company_id = NEW.company_id AND e.user_id = auth.uid());
  IF NOT v_office THEN
    SELECT name INTO v_client FROM public.clients WHERE id = NEW.client_id;
    PERFORM public._notify_office(
      NEW.company_id, 'quote_accepted_online',
      trim(coalesce(v_client, 'A client') || ' accepted quote ' || coalesce(NEW.quote_number, '')),
      coalesce(v_client, 'The client') || ' accepted ' || coalesce(NEW.quote_number, 'the quote')
        || CASE WHEN v_inv IS NOT NULL THEN '. A draft invoice is ready for you to check and send.' ELSE '.' END,
      CASE WHEN v_inv IS NOT NULL THEN 'invoice' ELSE 'quote' END,
      coalesce(v_inv, NEW.id)::text, 'quote_accepted:' || NEW.id::text,
      jsonb_build_object('quote_id', NEW.id, 'invoice_id', v_inv));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quote_accepted_invoice ON public.commercial_quotes;
CREATE TRIGGER trg_quote_accepted_invoice AFTER UPDATE OF status ON public.commercial_quotes
  FOR EACH ROW WHEN (NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted')
  EXECUTE FUNCTION public._trg_quote_accepted_invoice();

-- The draft's note no longer assumes the quote was accepted online.
DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._quote_to_draft_invoice(uuid)'::regprocedure);
  IF position(''', accepted online.''' IN d) > 0 THEN
    EXECUTE replace(d, ''', accepted online.''', ''' (accepted).''');
  END IF;
END $patch$;
