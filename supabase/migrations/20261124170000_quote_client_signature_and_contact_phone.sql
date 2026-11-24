-- Quote round 2: the client's typed name and drawn signature when they accept online, and a phone number for
-- a customer's extra contacts. Additions only: three nullable columns and one guard trigger. Nothing existing changes.

ALTER TABLE public.commercial_quotes
  ADD COLUMN IF NOT EXISTS accepted_by_name   text,
  ADD COLUMN IF NOT EXISTS accepted_signature text;   -- PNG data URL, written only by the public_document edge function

COMMENT ON COLUMN public.commercial_quotes.accepted_by_name   IS 'Name the client typed when accepting online.';
COMMENT ON COLUMN public.commercial_quotes.accepted_signature IS 'Signature the client drew when accepting online (PNG data URL). Set by the server only.';

ALTER TABLE public.client_contacts
  ADD COLUMN IF NOT EXISTS phone text;

-- The signature is the client's own mark: staff cannot write or change it from the app. Only the server
-- (service role, used by the public_document function) may set it.
CREATE OR REPLACE FUNCTION public._quote_signature_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.accepted_signature := NULL;
      NEW.accepted_by_name   := NULL;
    ELSIF NEW.accepted_signature IS DISTINCT FROM OLD.accepted_signature
       OR NEW.accepted_by_name IS DISTINCT FROM OLD.accepted_by_name THEN
      RAISE EXCEPTION 'QUOTE_SIGNATURE_LOCKED' USING HINT = 'Only the client can sign a quote, from their link.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quote_signature_guard ON public.commercial_quotes;
CREATE TRIGGER trg_quote_signature_guard
  BEFORE INSERT OR UPDATE OF accepted_signature, accepted_by_name ON public.commercial_quotes
  FOR EACH ROW EXECUTE FUNCTION public._quote_signature_guard();
