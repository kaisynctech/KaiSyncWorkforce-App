-- Undo for 20261125090000: staff with quotes.edit can delete quotes again (as before).
CREATE POLICY quotes_delete ON public.commercial_quotes FOR DELETE
  USING ((company_id = ANY (user_company_ids())) AND user_has_permission(company_id, 'quotes.edit'::text));
