-- Quotations are business records: once a quote number exists it is never deleted from the app. A quote the
-- client doesn't want is marked Declined (it keeps its number). This removes the one rule that let staff delete
-- quotes; nothing else changes (the server and the database owner can still remove data if ever needed).
DROP POLICY IF EXISTS quotes_delete ON public.commercial_quotes;
