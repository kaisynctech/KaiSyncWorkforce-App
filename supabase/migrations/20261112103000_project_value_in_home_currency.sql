-- A project's value is in the company's own currency: a quote in another currency counts at its rate
-- (the same rate the company totals use). Recalculates the projects that already have quotes.

CREATE OR REPLACE FUNCTION public._trg_quote_project_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.client_deals%ROWTYPE; v_value numeric; v_changed boolean;
BEGIN
  SELECT * INTO d FROM public.client_deals WHERE id = NEW.deal_id AND company_id = NEW.company_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_changed := TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status;

  SELECT q.subtotal * coalesce(q.exchange_rate, 1) INTO v_value FROM public.commercial_quotes q
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

UPDATE public.client_deals d SET offer_amount = v.value, updated_at = now()
FROM (
  SELECT DISTINCT ON (q.deal_id) q.deal_id, round(q.subtotal * coalesce(q.exchange_rate, 1), 2) AS value
  FROM public.commercial_quotes q
  WHERE q.deal_id IS NOT NULL AND q.status NOT IN ('declined', 'cancelled', 'expired')
  ORDER BY q.deal_id, (q.status = 'accepted') DESC, coalesce(q.sent_at, q.updated_at, q.created_at) DESC
) v
WHERE d.id = v.deal_id AND d.offer_amount IS DISTINCT FROM v.value;
