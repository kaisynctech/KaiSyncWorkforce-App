-- Portal / linked-company invoice PDF: include the invoice's currency (it was always printed in rand).
-- Rollback: not needed (adds one field to the returned JSON).
DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._cpc_get_invoice(uuid,uuid)'::regprocedure);
  IF position('''currency'', i.currency' IN d) > 0 THEN RETURN; END IF;
  IF position('''balance_due'', i.balance_due,' IN d) = 0 THEN RAISE EXCEPTION 'Portal invoice function has changed — not patched'; END IF;
  EXECUTE replace(d, '''balance_due'', i.balance_due,', '''balance_due'', i.balance_due, ''currency'', i.currency,');
END $patch$;
