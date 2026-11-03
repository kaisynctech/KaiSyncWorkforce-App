-- Back from PayFast: the Billing screen asks whether PayFast has confirmed this payment yet.
-- Answers only for people who may manage the company's billing.
CREATE OR REPLACE FUNCTION public.billing_checkout_status(p_checkout_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.status FROM public.billing_checkouts c
   WHERE c.id = p_checkout_id AND public.billing_can_manage(c.company_id)
$$;
REVOKE ALL ON FUNCTION public.billing_checkout_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_checkout_status(uuid) TO authenticated;
