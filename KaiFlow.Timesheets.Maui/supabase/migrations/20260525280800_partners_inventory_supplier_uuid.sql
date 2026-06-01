-- Partner kinds on contractors (job contractors vs inventory suppliers) + inventory supplier link (uuid).

ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS partner_kind text NOT NULL DEFAULT 'contractor';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contractors_partner_kind_chk'
  ) THEN
    ALTER TABLE public.contractors
      ADD CONSTRAINT contractors_partner_kind_chk
      CHECK (partner_kind IN ('contractor', 'supplier', 'both'));
  END IF;
END $$;

UPDATE public.contractors SET partner_kind = 'contractor'
WHERE partner_kind IS NULL OR trim(partner_kind) = '';

-- Replace legacy bigint supplier link with uuid (uuid contractors schema).
ALTER TABLE public.inventory_items DROP COLUMN IF EXISTS supplier_contractor_id;

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS supplier_contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_items_supplier_contractor
  ON public.inventory_items(supplier_contractor_id);
