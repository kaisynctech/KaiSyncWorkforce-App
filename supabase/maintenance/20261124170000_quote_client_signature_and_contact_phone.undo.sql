-- Undo for 20261124170000 (removes the columns and any signatures stored in them).
DROP TRIGGER IF EXISTS trg_quote_signature_guard ON public.commercial_quotes;
DROP FUNCTION IF EXISTS public._quote_signature_guard();
ALTER TABLE public.commercial_quotes DROP COLUMN IF EXISTS accepted_signature, DROP COLUMN IF EXISTS accepted_by_name;
ALTER TABLE public.client_contacts DROP COLUMN IF EXISTS phone;
