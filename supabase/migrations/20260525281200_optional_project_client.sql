-- Projects may be internal (no client) — e.g. own business work not tied to a customer.

ALTER TABLE public.client_deals
  ALTER COLUMN client_id DROP NOT NULL;
