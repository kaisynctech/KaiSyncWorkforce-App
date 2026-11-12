-- Quote Buyout (Phase A): each quote line says how it is supplied (outsource / service / from stock), and a quote
-- can ask suppliers for prices (an RFQ made from the quote, each supplier asked only for the items ticked for them),
-- who reply on a private link or by email. Choosing a reply puts that supplier's cost on the quote line.
-- Adds columns only; nothing existing changes. Rollback:
--   ALTER TABLE public.commercial_quote_lines DROP COLUMN supply_mode, DROP COLUMN supplier_id, DROP COLUMN chosen_response_line_id;
--   ALTER TABLE public.rfq_recipients DROP COLUMN line_ids, DROP COLUMN send_to, DROP COLUMN cc, DROP COLUMN prices_include_vat,
--     DROP COLUMN charges_vat, DROP COLUMN reply_token, DROP COLUMN reply_attachment_path, DROP COLUMN replied_online;
--   ALTER TABLE public.rfqs DROP COLUMN is_buyout;

ALTER TABLE public.commercial_quote_lines
  ADD COLUMN IF NOT EXISTS supply_mode text CHECK (supply_mode IN ('outsource', 'service', 'stock')),
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chosen_response_line_id uuid REFERENCES public.rfq_response_lines(id) ON DELETE SET NULL;

ALTER TABLE public.rfq_recipients
  ADD COLUMN IF NOT EXISTS line_ids uuid[],                 -- the items this supplier is asked for (null = all)
  ADD COLUMN IF NOT EXISTS send_to text,                    -- email it goes to (defaults to the supplier's email)
  ADD COLUMN IF NOT EXISTS cc text[],
  ADD COLUMN IF NOT EXISTS prices_include_vat text CHECK (prices_include_vat IN ('excl', 'incl', 'none')),
  ADD COLUMN IF NOT EXISTS charges_vat boolean,             -- for the purchase order: does this supplier add VAT
  ADD COLUMN IF NOT EXISTS reply_token text UNIQUE CHECK (reply_token IS NULL OR length(reply_token) >= 32),
  ADD COLUMN IF NOT EXISTS reply_attachment_path text,      -- the supplier's own quote (PDF), if they attached it
  ADD COLUMN IF NOT EXISTS replied_online boolean NOT NULL DEFAULT false;

ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS is_buyout boolean NOT NULL DEFAULT false;  -- made from a quote's Buyout tab

CREATE INDEX IF NOT EXISTS rfqs_quote_buyout_idx ON public.rfqs (quote_id) WHERE is_buyout;
